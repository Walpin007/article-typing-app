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

  const blocks = doc.querySelectorAll(
    "p, h1, h2, h3, h4, blockquote, li"
  );

  const paragraphs = Array.from(blocks)
    .map((el) => el.textContent.trim())
    .filter(Boolean);

  if (paragraphs.length > 0) {
    return paragraphs.join("\n\n");
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
