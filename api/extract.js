import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export const config = { runtime: "nodejs" };

function cleanText(s = "") {
  return s
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "")

    // 줄 내부의 탭/여러 공백만 정리
    .replace(/[ \t]{2,}/g, " ")

    // 줄 앞뒤 공백 정리
    .split("\n")
    .map((line) => line.trim())
    .join("\n")

    // 엔터가 3개 이상이면 2개까지만 유지
    // 즉, 문단 구분은 살리고 과한 빈 줄은 줄임
    .replace(/\n{3,}/g, "\n\n")

    .trim();
}

export default async function handler(req, res) {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "Missing ?url=" });

    const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!resp.ok) {
      return res.status(400).json({ error: `Fetch failed: ${resp.status}` });
    }

    const html = await resp.text();

    const dom = new JSDOM(html, { url, contentType: "text/html" });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article?.textContent) {
      return res.status(422).json({ error: "Could not extract article text" });
    }

    const full = cleanText(article.textContent);
    const fullLength = full.length;

    res.status(200).json({
      title: article.title || "",
      text: full,
      textLength: fullLength,
      source: new URL(url).hostname,
      url,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
