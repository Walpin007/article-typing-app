import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "Missing ?url=" });

    const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!resp.ok) return res.status(400).json({ error: `Fetch failed: ${resp.status}` });
    const html = await resp.text();

    const dom = new JSDOM(html, { url, contentType: "text/html" });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (!article?.textContent) return res.status(422).json({ error: "Could not extract article text" });

    const full = article.textContent.trim();
    const fullLength = full.length;

  res.status(200).json({
  title: article.title || "",
  text: full,             // ✅ 전체 본문 전달
  textLength: fullLength, // 참고용으로 길이는 남겨둬도 됨
  source: new URL(url).hostname,
  url,
});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
