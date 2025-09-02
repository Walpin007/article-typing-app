// api/search-mixed.js
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

export const config = { runtime: "nodejs" };

/* ───── 유틸 ───── */
const NEWS_DOMAINS = [
  "yna.co.kr","yonhapnews.co.kr","joongang.co.kr","joins.com","chosun.com","donga.com",
  "hani.co.kr","khan.co.kr","hankookilbo.com","mk.co.kr","sedaily.com","edaily.co.kr",
  "biz.chosun.com","heraldcorp.com","news.jtbc.co.kr","mbn.co.kr","ytn.co.kr",
  "news.kbs.co.kr","imnews.imbc.com","news.sbs.co.kr","hankyung.com","wowtv.co.kr",
  "ohmynews.com","pressian.com","sisain.co.kr","kyunghyang.com","news.mt.co.kr","moneys.co.kr",
  "magazine.hankyung.com"
];

function isNewsLink(urlStr) {
  try {
    const host = new URL(urlStr).hostname.replace(/^www\./, "");
    return NEWS_DOMAINS.some(dom => host === dom || host.endsWith("." + dom));
  } catch { return false; }
}

function abortableFetch(url, opts = {}, ms = 12000) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(id));
}

function dedupeByLink(items) {
  const seen = new Set();
  return items.filter(it => {
    const key = (it.link || "").replace(/\/$/, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stripTags(s = "") {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function toDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/* ───── Google CSE (최신순) ───── */
function buildGoogleURL(q, key, cx) {
  const u = new URL("https://www.googleapis.com/customsearch/v1");
  u.searchParams.set("key", key);
  u.searchParams.set("cx", cx);
  u.searchParams.set("q", q);
  u.searchParams.set("num", "10");      // ⬅️ 10개 요청
  u.searchParams.set("sort", "date");   // 최신순
  // u.searchParams.set("dateRestrict", "d7"); // 최근 7일만 보고 싶으면 주석 해제
  // u.searchParams.set("gl", "kr");
  // u.searchParams.set("hl", "ko");
  // u.searchParams.set("lr", "lang_ko");
  return u;
}

function mapGoogleItems(items = []) {
  return items
    .filter(it => isNewsLink(it.link))
    .map(it => {
      let pubDate;
      try {
        const meta = it.pagemap?.metatags?.[0] || {};
        pubDate =
          meta["article:published_time"] ||
          meta["og:published_time"] ||
          meta["og:updated_time"] ||
          meta["article:modified_time"] ||
          meta["date"] ||
          meta["pubdate"];
      } catch {}
      return {
        sourceType: "google",
        title: it.title,
        snippet: it.snippet,
        link: it.link,
        displayLink: it.displayLink,
        pubDate
      };
    });
}

async function searchGoogle(q, key, cx) {
  if (!key || !cx) return { items: [], error: "Missing GOOGLE env vars" };
  const url = buildGoogleURL(q, key, cx).toString();

  const res = await abortableFetch(url, { headers: { Accept: "application/json" } }, 12000);
  const status = res.status;
  let data = null;
  try { data = await res.json(); } catch {}

  if (!res.ok) {
    return { items: [], error: data || { status, message: "Google request failed" }, debug: { status, url } };
  }

  // ⬅️ 10개까지 수용
  const items = mapGoogleItems(data.items || []).slice(0, 10);
  return { items, debug: { status, url, count: items.length } };
}

/* ───── Naver 뉴스 (최신순) ───── */
async function searchNaver(q, id, secret) {
  if (!id || !secret) return { items: [], error: "Missing NAVER env vars" };

  const u = new URL("https://openapi.naver.com/v1/search/news.json");
  u.searchParams.set("query", q);
  u.searchParams.set("display", "10"); // ⬅️ 10개 요청
  u.searchParams.set("start", "1");
  u.searchParams.set("sort", "date");  // 최신순

  const res = await abortableFetch(u, {
    headers: {
      "X-Naver-Client-Id": id,
      "X-Naver-Client-Secret": secret,
      "Accept": "application/json"
    }
  }, 12000);

  const status = res.status;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { items: [], error: data, debug: { status, url: u.toString() } };

  const items = (data.items || []).map(it => {
    const link = it.link || it.originallink || "";
    let displayLink = "";
    try { displayLink = new URL(link).hostname.replace(/^www\./, ""); } catch {}
    return {
      sourceType: "naver",
      title: stripTags(it.title || ""),
      snippet: stripTags(it.description || ""),
      link,
      displayLink,
      pubDate: it.pubDate // RFC822
    };
  }).slice(0, 10); // ⬅️ 10개로 유지

  return { items, debug: { status, url: u.toString(), count: items.length } };
}

/* ───── 핸들러 ───── */
export default async function handler(req, res) {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: "Missing query ?q=" });

    const [g, n] = await Promise.all([
      searchGoogle(q, process.env.GOOGLE_API_KEY, process.env.GOOGLE_CSE_CX),
      searchNaver(q, process.env.NAVER_CLIENT_ID, process.env.NAVER_CLIENT_SECRET)
    ]);

    // 합치기 → 중복 제거 → 날짜 기준 최신순 정렬 → 최대 10개
    let items = dedupeByLink([...(g.items || []), ...(n.items || [])]);

    items = items
      .map(it => {
        const d = toDate(it.pubDate);
        return { ...it, _ts: d ? d.getTime() : 0 };
      })
      .sort((a, b) => b._ts - a._ts)
      .slice(0, 10) // ⬅️ 최종 10개
      .map(({ _ts, ...rest }) => rest);

    const meta = {};
    if (g.error) meta.googleError = g.error;
    if (n.error) meta.naverError = n.error;
    if (g.debug) meta.googleDebug = g.debug;
    if (n.debug) meta.naverDebug = n.debug;

    return res.status(200).json({ items, ...meta });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}