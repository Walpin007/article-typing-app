import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export const config = { runtime: "nodejs" };

function cleanText(s = "") {
  return s
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "")

    // 줄 내부의 탭/여러 공백만 정리
    .replace(/[ \t]{2,}/g, " ")

    // 문장 끝 뒤에 공백 없이 다음 문장이 붙은 경우 보정
    // 예: "했다.중국은" → "했다.\n\n중국은"
    // 예: "했다.”중국은" → "했다.”\n\n중국은"
    // 단, 소수점(예: 3.5, 1.2배)은 제외
    .replace(/(?<!\d)([.!?。！？][”’"')\]]?)(?=[가-힣A-Z“‘])/g, "$1\n\n")

    // 줄 앞뒤 공백 정리
    .split("\n")
    .map((line) => line.trim())
    .join("\n")

    // 엔터가 3개 이상이면 2개까지만 유지
    // 즉, 문단 구분은 살리고 과한 빈 줄은 줄임
    .replace(/\n{3,}/g, "\n\n")

    .trim();
}

function extractParagraphText(articleContent = "") {
  const dom = new JSDOM(articleContent);
  const doc = dom.window.document;

  // 불필요 요소 및 캡션성 요소 제거
  doc.querySelectorAll(
    [
      "script",
      "style",
      "noscript",
      "iframe",
      "figure",
      "figcaption",

      // 네이버 뉴스 이미지/캡션 영역
      ".end_photo_org",
      ".img_desc",
      ".media_end_photo_caption",
      ".media_end_photo_caption_text",
      ".media_end_photo_caption_bold",
      ".media_end_photo_org",
      ".caption",
      ".image-caption",

      // 요약/부가 영역
      ".media_end_head_autosummary",
      ".media_end_head_journalist",
      ".media_end_head_info",
    ].join(",")
  ).forEach((el) => el.remove());

  // br 태그는 줄바꿈으로 변환
  doc.querySelectorAll("br").forEach((br) => {
    br.replaceWith("\n");
  });

  // 블록 요소 뒤에는 문단 구분용 줄바꿈 추가
  doc.querySelectorAll("p, div, section, article, blockquote, li").forEach((el) => {
    el.append("\n\n");
  });

  const text = doc.body.textContent || "";

  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      // 일반적인 사진 캡션/출처성 문장 제거
      if (/사진\s*[:=]/.test(line)) return false;
      if (/^\[.*사진.*\]/.test(line)) return false;
      if (/연합뉴스|AP|AFP|EPA|로이터|뉴스1|뉴시스|게티이미지|게티이미지코리아|Getty Images/i.test(line) && line.length < 160) {
        return false;
      }

      return true;
    })
    .join("\n\n");
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

    // 네이버 뉴스 본문 영역을 우선 사용
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
