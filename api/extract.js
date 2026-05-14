import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export const config = { runtime: "nodejs" };

function cleanText(s = "") {
  return s
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractParagraphText(articleContent = "") {
  const dom = new JSDOM(articleContent);
  const doc = dom.window.document;

  // 불필요 요소 제거
  doc.querySelectorAll(
    "script, style, noscript, iframe, figure, figcaption, .caption, .image-caption, .end_photo_org, .media_end_head_autosummary"
  ).forEach((el) => el.remove());

  // br은 줄바꿈으로 변환
  doc.querySelectorAll("br").forEach((br) => {
    br.replaceWith("\n");
  });

  // 블록 요소 뒤에는 문단 구분용 줄바꿈 추가
  doc.querySelectorAll("p, div, section, article, blockquote, li").forEach((el) => {
    el.append("\n\n");
  });

  return doc.body.textContent || "";
}

export default async function handler(req, res) {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "Missing ?url=" });

    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

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

    // ✅ 네이버 뉴스 본문 영역을 우선 사용
    const naverArticle = dom.window.document.querySelector("#dic_area");

    const rawText = naverArticle
      ? extractParagraphText(naverArticle.innerHTML)
      : extractParagraphText(article.content || article.textContent);

    const full = cleanText(rawText);
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
