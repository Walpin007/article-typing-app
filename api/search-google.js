// api/search-google.js
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

export const config = { runtime: "nodejs" };

// 한국 주요 뉴스 도메인 화이트리스트
const NEWS_DOMAINS = [
  "yna.co.kr","yonhapnews.co.kr","joongang.co.kr","joins.com","chosun.com","donga.com",
  "hani.co.kr","khan.co.kr","hankookilbo.com","mk.co.kr","sedaily.com","edaily.co.kr",
  "biz.chosun.com","heraldcorp.com","news.jtbc.co.kr","mbn.co.kr","ytn.co.kr",
  "news.kbs.co.kr","imnews.imbc.com","news.sbs.co.kr","hankyung.com","wowtv.co.kr",
  "ohmynews.com","pressian.com","sisain.co.kr","kyunghyang.com","news.mt.co.kr","moneys.co.kr"
];

function isNewsLink(urlStr) {
  try {
    const host = new URL(urlStr).hostname.replace(/^www\./, "");
    return NEWS_DOMAINS.some(dom => host === dom || host.endsWith("." + dom));
  } catch { return false; }
}

function abortableFetch(url, opts = {}, ms = 8000) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(id));
}

export default async function handler(req, res) {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: "Missing query ?q=" });

    const key = process.env.GOOGLE_API_KEY;
    const cx  = process.env.GOOGLE_CSE_CX;
    if (!key || !cx) return res.status(500).json({ error: "Missing GOOGLE env vars" });

    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", key);
    url.searchParams.set("cx", cx);
    url.searchParams.set("q", q);
    url.searchParams.set("num", "10");         // 여유로 받아서 필터 후 3개만
    url.searchParams.set("hl", "ko");
    url.searchParams.set("gl", "kr");
    url.searchParams.set("safe", "active");
    url.searchParams.set("fields", "items(title,link,snippet,displayLink)");

    const r = await abortableFetch(url, { headers: { Accept: "application/json" } }, 8000);
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ googleError: data });

    const items = (data.items || [])
      .filter(it => isNewsLink(it.link))
      .slice(0, 5) // ✅ 구글 5개만
      .map(it => ({
        sourceType: "google",
        title: it.title,
        snippet: it.snippet,
        link: it.link,
        displayLink: it.displayLink
      }));

    res.status(200).json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}