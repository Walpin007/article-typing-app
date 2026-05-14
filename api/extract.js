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

  // 캡션/불필요 요소 제거
  doc.querySelectorAll(
    "script, style, noscript, iframe, figure, figcaption, .caption, .image-caption"
  ).forEach((el) => el.remove());

  const blockSelector = [
    "p",
    "div",
    "section",
    "article",
    "h1",
    "h2",
    "h3",
    "h4",
    "blockquote",
    "li"
  ].join(",");

  const blocks = Array.from(doc.querySelectorAll(blockSelector));

  const paragraphs = blocks
    // 자식 안에 또 본문 블록이 있으면 부모는 제외해서 중복 방지
    .filter((el) => {
      return !Array.from(el.children).some((child) =>
        child.matches(blockSelector)
      );
    })
    .map((el) => el.textContent.trim())
    .filter(Boolean);

  // 연속 중복 제거
  const deduped = [];

  for (const paragraph of paragraphs) {
    if (deduped[deduped.length - 1] !== paragraph) {
      deduped.push(paragraph);
    }
  }

  if (deduped.length > 0) {
    return deduped.join("\n\n");
  }

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

    const rawText = extractParagraphText(article.content || article.textContent);
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
