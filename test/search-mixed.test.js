import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import handler from "../api/search-mixed.js";

const env = {
  GOOGLE_API_KEY: "google-canary_123456",
  GOOGLE_CSE_CX: "test-engine",
  NAVER_CLIENT_ID: "naver-id-canary",
  NAVER_CLIENT_SECRET: "naver/secret+canary"
};
const secrets = [env.GOOGLE_API_KEY, env.NAVER_CLIENT_ID, env.NAVER_CLIENT_SECRET];
const original = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));

beforeEach(() => Object.assign(process.env, env));
afterEach(() => {
  for (const [k, v] of Object.entries(original)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function providers(t, google, naver) {
  return t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input);
    if (url.hostname === "www.googleapis.com") return google(url, options);
    assert.equal(url.hostname, "openapi.naver.com");
    return naver(url, options);
  });
}

async function request(query = { q: "기사 검색" }) {
  const res = {
    status(code) { this.code = code; return this; },
    json(body) { this.body = JSON.parse(JSON.stringify(body)); }
  };
  await handler({ query }, res);
  for (const value of secrets) {
    for (const token of [value, encodeURIComponent(value)]) {
      assert.ok(!JSON.stringify(res.body).includes(token), "credential in response");
    }
  }
  return [res.code, res.body];
}

const link = "https://www.yna.co.kr/story";
const googleArticle = { title: "Google", link, snippet: "summary",
  pagemap: { metatags: [{ "article:published_time": "2026-08-20" }] } };
const naverArticle = { title: "<b>Naver</b>", description: "some <b>news</b>",
  link: "https://news.naver.com/new", pubDate: "2026-08-21" };
const ok = (...items) => Response.json({ items });
const bad = () => Response.json({ message: secrets.join(" "), nested: {
  url: "https://example.invalid/?key=" + env.GOOGLE_API_KEY
} }, { status: 403 });

test("mixed success preserves request options, filtering, dedupe, order and limit", async t => {
  const older = Array.from({ length: 8 }, (_, i) =>
    ({ ...naverArticle, link: naverArticle.link + i, pubDate: "2026-07-01" }));
  const undated = { ...googleArticle, link: link + "-undated", pagemap: {} };
  const fetch = providers(t, (url, opts) => {
    assert.deepEqual(Object.fromEntries(url.searchParams),
      { cx: env.GOOGLE_CSE_CX, q: "기사 검색", num: "10", sort: "date" });
    assert.equal(new Headers(opts.headers).get("x-goog-api-key"), env.GOOGLE_API_KEY);
    return ok(googleArticle, undated, { ...googleArticle, link: "https://example.org" });
  }, (url, opts) => {
    assert.deepEqual(Object.fromEntries(url.searchParams),
      { query: "기사 검색", display: "10", start: "1", sort: "date" });
    assert.equal(opts.headers["X-Naver-Client-Id"], env.NAVER_CLIENT_ID);
    assert.equal(opts.headers["X-Naver-Client-Secret"], env.NAVER_CLIENT_SECRET);
    return ok(naverArticle, { ...naverArticle, link: link + "/" }, ...older);
  });
  const [code, body] = await request();
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal(code, 200);
  assert.deepEqual(Object.keys(body), ["items"]);
  assert.deepEqual(body.items.map(i => i.link), [naverArticle.link, link, ...older.map(i => i.link)]);
  assert.deepEqual(body.items[0], { title: "Naver", snippet: "some news", sourceType: "naver",
    link: naverArticle.link, pubDate: naverArticle.pubDate, displayLink: "news.naver.com" });
  assert.equal(body.items[1].sourceType, "google");
});

for (const provider of ["google", "naver", "both"]) {
  test(provider + " HTTP error exposes only fixed errors and preserves partial results", async t => {
    providers(t, provider === "naver" ? () => ok(googleArticle) : bad,
      provider === "google" ? () => ok(naverArticle) : bad);
    const [code, { items, ...meta }] = await request();
    assert.equal(code, 200);
    assert.deepEqual(meta, {
      ...(provider !== "naver" && { googleError: "Google request failed" }),
      ...(provider !== "google" && { naverError: "Naver request failed" })
    });
    assert.deepEqual(items.map(i => i.sourceType),
      provider === "both" ? [] : [provider === "google" ? "naver" : "google"]);
  });
}

test("reflected credentials in successful article data are omitted before dedupe", async t => {
  providers(t, () => ok({ ...googleArticle, title: env.GOOGLE_API_KEY }),
    () => ok({ ...naverArticle, link }, { ...naverArticle,
      link: naverArticle.link + "?token=" + encodeURIComponent(env.NAVER_CLIENT_SECRET) }));
  const [code, body] = await request();
  assert.equal(code, 200);
  assert.deepEqual(body.items.map(i => [i.sourceType, i.link]), [["naver", link]]);
});

for (const provider of ["google", "naver"]) {
  test(provider + " fetch exception cannot expose its message", async t => {
    const fail = () => { throw new Error(secrets.join(" ")); };
    providers(t, provider === "google" ? fail : () => ok(), provider === "naver" ? fail : () => ok());
    assert.deepEqual(await request(), [500, { error: "Search failed" }]);
  });
}

test("missing query stays 400 and missing configuration makes no upstream request", async t => {
  const fetch = providers(t, assert.fail, assert.fail);
  assert.deepEqual(await request({}), [400, { error: "Missing query ?q=" }]);
  delete process.env.GOOGLE_CSE_CX;
  delete process.env.NAVER_CLIENT_ID;
  assert.deepEqual(await request(), [200, { items: [], googleError: "Missing GOOGLE env vars",
    naverError: "Missing NAVER env vars" }]);
  assert.equal(fetch.mock.callCount(), 0);
});

test("empty successful responses contain no debug URLs or provider metadata", async t => {
  providers(t, () => ok(), () => ok());
  assert.deepEqual(await request(), [200, { items: [] }]);
});

test("invalid Google JSON cannot expose parser details", async t => {
  providers(t, () => new Response(env.GOOGLE_API_KEY), () => ok());
  assert.deepEqual(await request(), [500, { error: "Search failed" }]);
});
