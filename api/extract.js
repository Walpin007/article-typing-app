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
    const limited = fullLength > 1500 ? full.slice(0, 1500) : full;

    res.status(200).json({
      title: article.title || "",
      text: limited,          // UI 공급(최대 1500자)
      textLength: fullLength, // 길이 필터(1000~1500)용
      source: new URL(url).hostname,
      url,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
