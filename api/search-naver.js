// api/search-naver.js
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

export const config = { runtime: "nodejs" };

function abortableFetch(url, opts = {}, ms = 8000) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(id));
}

export default async function handler(req, res) {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: "Missing query ?q=" });

    const id = process.env.NAVER_CLIENT_ID;
    const secret = process.env.NAVER_CLIENT_SECRET;
    if (!id || !secret) return res.status(500).json({ error: "Missing NAVER env vars" });

    const url = new URL("https://openapi.naver.com/v1/search/news.json");
    url.searchParams.set("query", q);
    url.searchParams.set("display", "10");
    url.searchParams.set("start", "1");
    url.searchParams.set("sort", "date");

    const r = await abortableFetch(url, {
      headers: {
        "X-Naver-Client-Id": id,
        "X-Naver-Client-Secret": secret,
        "Accept": "application/json"
      }
    }, 8000);

    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ naverError: data });

    const items = (data.items || [])
      .slice(0, 5) // ✅ 네이버 5개만
      .map(it => {
        const link = it.link || it.originallink || "";
        let displayLink = "";
        try { displayLink = new URL(link).hostname.replace(/^www\./, ""); } catch {}
        return {
          sourceType: "naver",
          title: (it.title || "").replace(/<[^>]+>/g, ""),
          snippet: (it.description || "").replace(/<[^>]+>/g, ""),
          link,
          displayLink,
          pubDate: it.pubDate
        };
      });

    res.status(200).json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}