import { useEffect, useMemo, useRef, useState } from "react";
import "./index.css";

import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
} from "docx";

import { saveAs } from "file-saver";

const MAX_ROUNDS = 3;


// 개발용 스크롤 디버그 화면
const SHOW_SCROLL_DEBUG = false;

/**
 * 비교용 정규화 함수
 * 화면에 보이는 원문은 그대로 유지하고,
 * 정확도/오타/완료 판단할 때만 문자 모양 차이를 흡수합니다.
 */
const normalizeForCompare = (value = "") => {
  return value
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u0060\u00B4\u2032]/g, "'")
    .replace(/[\uFF5E\u223C\u02DC]/g, "~")
    .replace(/[\u2013\u2014\u2015]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ");
};

const isValidUrl = (value = "") => {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export default function App() {
  /**
   * Theme
   */
  const getInitTheme = () => {
    const saved = localStorage.getItem("theme");

    if (saved === "light" || saved === "dark") {
      return saved;
    }

    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  };

  const [theme, setTheme] = useState(getInitTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  /**
   * Typing state
   */
  const [round, setRound] = useState(1);
  const [typed, setTyped] = useState(["", "", ""]);
  const [paused, setPaused] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [scrollDebug, setScrollDebug] = useState({
    paragraph: -1,
    targetFound: false,
    relativeTop: 0,
    visibleHeight: 0,
    triggerPoint: 0,
    scrollTop: 0,
    scrollHeight: 0,
    executed: false,
  });
  const [articleScrollProgress, setArticleScrollProgress] = useState(0);

  /**
   * Search state
   */
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingArticle, setLoadingArticle] = useState(false);

  /**
   * Article state
   */
  const [article, setArticle] = useState({
    title: "",
    source: "",
    content: "",
    plain: "",
    pubDate: "",
    textLength: 0,
  });

  const [viewMode, setViewMode] = useState("clean");
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState("");

  /**
   * Refs
   */
  const headerLeftRef = useRef(null);
  const headerRightRef = useRef(null);

  // 실제 원문 스크롤 컨테이너 (.articleView)
  const leftRef = useRef(null);

  const typingRef = useRef(null);

  // 마지막으로 자동 스크롤한 문단 번호
  const lastAutoScrolledParagraphRef = useRef(-1);

  /**
   * Current text / input
   */
  const text =
    (editMode
      ? draft
      : viewMode === "clean"
        ? article.content
        : article.plain) || "";

  const input = typed[round - 1] || "";

  /**
   * 비교용 정규화 텍스트
   */
  const normalizedInput = useMemo(() => {
    return normalizeForCompare(input);
  }, [input]);

  const normalizedText = useMemo(() => {
    return normalizeForCompare(text);
  }, [text]);

  /**
   * 원문을 문단과 줄바꿈 구간으로 나눕니다.
   *
   * 기사에 따라 문단 사이가
   * \n 하나 또는 \n\n으로 들어올 수 있으므로
   * 줄바꿈 1개 이상을 문단 경계로 인식합니다.
   *
   * 화면에 표시되는 줄바꿈 자체는 그대로 유지합니다.
   */
  const articleSegments = useMemo(() => {
    const segments = text.split(/(\r?\n+)/);

    let normalizedCursor = 0;
    let paragraphIndex = 0;

    return segments.map((segment) => {
      const isSeparator = /^\r?\n+$/.test(segment);

      const normalizedLength =
        normalizeForCompare(segment).length;

      const item = {
        text: segment,
        isSeparator,
        start: normalizedCursor,
        end: normalizedCursor + normalizedLength,
        paragraphIndex: null,
      };

      if (!isSeparator && segment.length > 0) {
        item.paragraphIndex = paragraphIndex;
        paragraphIndex += 1;
      }

      normalizedCursor += normalizedLength;

      return item;
    });
  }, [text]);

  /**
   * 현재 필사 중인 문단 계산
   *
   * 문단 사이 줄바꿈을 입력하고 있는 동안에는
   * 직전 문단을 현재 문단으로 유지합니다.
   */
  const currentParagraphIndex = useMemo(() => {
    if (!normalizedInput.length) {
      return 0;
    }

    const position = normalizedInput.length;

    let previousParagraphIndex = 0;

    for (const segment of articleSegments) {
      /**
       * 문단 사이 줄바꿈 영역에 입력 위치가 있는 경우
       * 다음 문단으로 넘어가기 전까지
       * 직전 문단을 유지합니다.
       */
      if (segment.isSeparator) {
        if (
          position > segment.start &&
          position < segment.end
        ) {
          return previousParagraphIndex;
        }

        continue;
      }

      if (segment.paragraphIndex === null) {
        continue;
      }

      previousParagraphIndex =
        segment.paragraphIndex;

      if (
        position >= segment.start &&
        position <= segment.end
      ) {
        return segment.paragraphIndex;
      }
    }

    return previousParagraphIndex;
  }, [normalizedInput, articleSegments]);

  /**
   * 새 기사 또는 새 회차 시작 시
   * 원문 스크롤을 처음으로 되돌리고
   * 자동 스크롤 기록도 초기화합니다.
   */
  useEffect(() => {
    lastAutoScrolledParagraphRef.current = -1;

    if (leftRef.current) {
      leftRef.current.scrollTop = 0;
    }
  }, [round, text]);

  /**
   * 현재 필사 중인 문단이
   * - 원문 화면 아래쪽 70% 지점까지 내려오거나
   * - 현재 화면 위쪽으로 완전히 벗어난 경우
   *
   * 해당 문단을 화면 약 20% 위치로 이동시킵니다.
   */
  useEffect(() => {
    const scrollContainer = leftRef.current;

    if (!scrollContainer) {
      setScrollDebug((prev) => ({
        ...prev,
        paragraph: currentParagraphIndex,
        targetFound: false,
        executed: false,
      }));

      return;
    }

    if (currentParagraphIndex < 0) return;
    if (editMode) return;

    const target = scrollContainer.querySelector(
      `[data-paragraph-index="${currentParagraphIndex}"]`
    );

    if (!target) {
      setScrollDebug({
        paragraph: currentParagraphIndex,
        targetFound: false,
        relativeTop: 0,
        visibleHeight: scrollContainer.clientHeight,
        triggerPoint: scrollContainer.clientHeight * 0.7,
        scrollTop: scrollContainer.scrollTop,
        scrollHeight: scrollContainer.scrollHeight,
        executed: false,
      });

      return;
    }

    const containerRect =
      scrollContainer.getBoundingClientRect();

    const targetRect =
      target.getBoundingClientRect();

    // 현재 문단의 시작점이 원문 프레임 내부에서 어디에 있는지 계산
    const relativeTop =
      targetRect.top - containerRect.top;

    const visibleHeight =
      scrollContainer.clientHeight;

    if (!visibleHeight) return;

    // 아래쪽 자동 스크롤 기준: 화면 높이의 70%
    const triggerPoint =
      visibleHeight * 0.7;

    // 스크롤 후 현재 문단이 위치할 목표 지점: 화면 높이의 20%
    const targetPoint =
      visibleHeight * 0.2;

    // 현재 문단이 너무 아래쪽에 있는 경우
    const shouldScrollDown =
      relativeTop >= triggerPoint;

    // 잘못된 스크롤 등으로 현재 문단이 화면 위로 벗어난 경우
    const shouldRecoverUp =
      relativeTop < 0;

    const shouldScroll =
      shouldScrollDown || shouldRecoverUp;

    setScrollDebug({
      paragraph: currentParagraphIndex,
      targetFound: true,
      relativeTop: Math.round(relativeTop),
      visibleHeight: Math.round(visibleHeight),
      triggerPoint: Math.round(triggerPoint),
      scrollTop: Math.round(scrollContainer.scrollTop),
      scrollHeight: Math.round(scrollContainer.scrollHeight),
      executed: shouldScroll,
    });

    /**
     * 같은 문단에서 이미 자동 스크롤한 경우
     * 매 글자 입력마다 반복 스크롤하지 않도록 중단
     */
    if (
      lastAutoScrolledParagraphRef.current ===
      currentParagraphIndex
    ) {
      return;
    }

    if (!shouldScroll) return;

    const scrollAmount =
      relativeTop - targetPoint;

    const maxScrollTop =
      scrollContainer.scrollHeight -
      scrollContainer.clientHeight;

    const nextScrollTop = Math.min(
      Math.max(
        0,
        scrollContainer.scrollTop + scrollAmount
      ),
      Math.max(0, maxScrollTop)
    );

    scrollContainer.scrollTo({
      top: nextScrollTop,
      behavior: "smooth",
    });

    lastAutoScrolledParagraphRef.current =
      currentParagraphIndex;
  }, [currentParagraphIndex, editMode]);

  /**
   * Accuracy
   */
  const accuracy = useMemo(() => {
    if (!normalizedInput.length) return 100;

    let ok = 0;

    for (let i = 0; i < normalizedInput.length; i++) {
      if (normalizedInput[i] === normalizedText[i]) {
        ok++;
      }
    }

    return Number(
      ((ok / normalizedInput.length) * 100).toFixed(1)
    );
  }, [normalizedInput, normalizedText]);

  /**
   * 오타 여부
   *
   * textarea는 글자별 색상 지정이 어려우므로
   * 오타가 하나라도 있으면 입력창 전체를 빨간색 처리합니다.
   */
  const hasError = useMemo(() => {
    for (let i = 0; i < normalizedInput.length; i++) {
      if (normalizedInput[i] !== normalizedText[i]) {
        return true;
      }
    }

    return false;
  }, [normalizedInput, normalizedText]);

  /**
   * 완료 여부
   */
  const isFinished = useMemo(() => {
    const a = normalizedInput.trim();
    const b = normalizedText.trim();

    return Boolean(a && b && a === b);
  }, [normalizedInput, normalizedText]);

  useEffect(() => {
    if (
      isFinished &&
      !paused &&
      countdown === null &&
      round <= MAX_ROUNDS
    ) {
      setCountdown(3);
    }
  }, [isFinished, paused, countdown, round]);

  useEffect(() => {
    if (countdown === null) return;

    if (countdown <= 0) {
      completeRoundAndCopy();
      setCountdown(null);
      return;
    }

    const timer = setTimeout(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown]);

  /**
   * Search
   */
  const doSearch = async () => {
    const keyword = query.trim();

    if (!keyword || loading) return;

    setLoading(true);
    setHasSearched(false);
    setOptions([]);
    setSelectedIdx("");

    try {
      /**
       * 검색창에 URL을 넣은 경우
       * 검색 결과 없이 바로 기사 추출
       */
      if (isValidUrl(keyword)) {
        const response = await fetch(
          `/api/extract?url=${encodeURIComponent(keyword)}`
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data?.error || "기사 본문 추출 실패"
          );
        }

        const textLength =
          typeof data?.textLength === "number"
            ? data.textLength
            : data?.text?.length || 0;

        const directOption = {
          idx: 0,
          sourceType: "direct",
          title: data?.title || "직접 입력한 기사",
          snippet: "",
          link: keyword,
          displayLink:
            data?.source ||
            new URL(keyword).hostname,
          pubDate: data?.pubDate || "",
        };

        setOptions([directOption]);
        setSelectedIdx("0");

        setArticle({
          title: directOption.title,

          source: `Direct/${(
            data?.source ||
            directOption.displayLink ||
            ""
          ).replace(/^www\./, "")}`,

          content: data?.text || "",
          plain: data?.plain || "",
          pubDate: data?.pubDate || "",
          textLength,
        });

        setViewMode(
          data?.mode === "plain"
            ? "plain"
            : "clean"
        );

        setEditMode(false);
        setDraft("");
        setRound(1);
        setTyped(["", "", ""]);
        setPaused(false);
        setCountdown(null);

        lastAutoScrolledParagraphRef.current = -1;

        if (leftRef.current) {
          leftRef.current.scrollTop = 0;
        }

        requestAnimationFrame(syncHeaderHeights);

        return;
      }

      /**
       * 기존 키워드 검색
       */
      const response = await fetch(
        `/api/search-mixed?q=${encodeURIComponent(keyword)}`
      );

      const data = await response.json();

      const items =
        Array.isArray(data.items)
          ? data.items
          : [];

      const opts = items
        .slice(0, 10)
        .map((item, index) => ({
          idx: index,
          sourceType: item.sourceType,
          title: item.title,
          snippet: item.snippet,
          link: item.link,
          displayLink: item.displayLink,
          pubDate: item.pubDate,
        }));

      setOptions(opts);
    } catch (error) {
      console.error(
        "검색/기사 추출 오류:",
        error
      );

      setOptions([]);
    } finally {
      setHasSearched(true);
      setLoading(false);
    }
  };

  /**
   * Load selected article
   */
  const loadSelectedArticle = async (idxStr) => {
    setSelectedIdx(idxStr);

    const idx = Number(idxStr);

    if (Number.isNaN(idx)) return;

    const selected = options[idx];

    if (!selected) return;

    setLoadingArticle(true);

    try {
      const response = await fetch(
        `/api/extract?url=${encodeURIComponent(
          selected.link
        )}`
      );

      const data = await response.json();

      const textLength =
        typeof data?.textLength === "number"
          ? data.textLength
          : data?.text?.length || 0;

      setArticle({
        title:
          selected.title ||
          data?.title ||
          "",

        source: `${
          selected.sourceType === "google"
            ? "Google"
            : "Naver"
        }/${(
          data?.source ||
          selected.displayLink ||
          ""
        ).replace(/^www\./, "")}`,

        content: data?.text || "",
        plain: data?.plain || "",
        pubDate:
          selected.pubDate ||
          data?.pubDate ||
          "",
        textLength,
      });

      setViewMode(
        data?.mode === "plain"
          ? "plain"
          : "clean"
      );

      setEditMode(false);
      setDraft("");
      setRound(1);
      setTyped(["", "", ""]);
      setPaused(false);
      setCountdown(null);

      lastAutoScrolledParagraphRef.current = -1;

      if (leftRef.current) {
        leftRef.current.scrollTop = 0;
      }

      requestAnimationFrame(syncHeaderHeights);
    } catch (error) {
      console.error(
        "기사 본문 추출 오류:",
        error
      );
    } finally {
      setLoadingArticle(false);
    }
  };

  /**
   * Typing change
   */
  const onChangeTyping = (event) => {
    const value = event.target.value;

    setTyped((prev) => {
      const next = [...prev];

      next[round - 1] = value;

      return next;
    });
  };

  /**
   * 회차 완료
   */
  const completeRoundAndCopy = async () => {
    try {
      await navigator.clipboard.writeText(input);
    } catch (error) {
      console.error("복사 실패:", error);
    }

    setPaused(true);
  };

  /**
   * Word 저장
   */
  const downloadWordFile = async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text:
                article.title ||
                "기사 필사",
              heading:
                HeadingLevel.HEADING_1,
            }),

            new Paragraph({
              text: `출처: ${
                article.source || "-"
              }`,
            }),

            new Paragraph({
              text: article.pubDate
                ? `날짜: ${article.pubDate}`
                : "",
            }),

            new Paragraph({
              text: "",
            }),

            new Paragraph({
              text: "[원문]",
              heading:
                HeadingLevel.HEADING_2,
            }),

            ...(text || "")
              .split("\n\n")
              .filter(Boolean)
              .map(
                (paragraph) =>
                  new Paragraph({
                    text: paragraph,
                  })
              ),

            new Paragraph({
              text: "",
            }),

            new Paragraph({
              text: "[1회차 필사]",
              heading:
                HeadingLevel.HEADING_2,
            }),

            ...(typed[0] || "")
              .split("\n\n")
              .filter(Boolean)
              .map(
                (paragraph) =>
                  new Paragraph({
                    text: paragraph,
                  })
              ),

            new Paragraph({
              text: "",
            }),

            new Paragraph({
              text: "[2회차 필사]",
              heading:
                HeadingLevel.HEADING_2,
            }),

            ...(typed[1] || "")
              .split("\n\n")
              .filter(Boolean)
              .map(
                (paragraph) =>
                  new Paragraph({
                    text: paragraph,
                  })
              ),

            new Paragraph({
              text: "",
            }),

            new Paragraph({
              text: "[3회차 필사]",
              heading:
                HeadingLevel.HEADING_2,
            }),

            ...(typed[2] || "")
              .split("\n\n")
              .filter(Boolean)
              .map(
                (paragraph) =>
                  new Paragraph({
                    text: paragraph,
                  })
              ),
          ],
        },
      ],
    });

    const blob =
      await Packer.toBlob(doc);

    const now = new Date();

    const yy =
      String(now.getFullYear()).slice(2);

    const mm =
      String(now.getMonth() + 1).padStart(
        2,
        "0"
      );

    const dd =
      String(now.getDate()).padStart(
        2,
        "0"
      );

    const safeTitle =
      (
        article.title ||
        "기사필사"
      )
        .replace(/[\\/:*?"<>|]/g, "")
        .trim()
        .slice(0, 40);

    const fileName =
      `${yy}${mm}${dd}필사_${safeTitle}.docx`;

    saveAs(blob, fileName);
  };

  /**
   * Header height sync
   */
  const syncHeaderHeights = () => {
    const leftHeader =
      headerLeftRef.current;

    const rightHeader =
      headerRightRef.current;

    if (!leftHeader || !rightHeader) {
      return;
    }

    leftHeader.style.minHeight = "";
    rightHeader.style.minHeight = "";

    const leftHeight =
      leftHeader.getBoundingClientRect().height;

    const rightHeight =
      rightHeader.getBoundingClientRect().height;

    const maxHeight =
      Math.max(
        leftHeight,
        rightHeight
      );

    leftHeader.style.minHeight =
      `${maxHeight}px`;

    rightHeader.style.minHeight =
      `${maxHeight}px`;
  };

  useEffect(() => {
    requestAnimationFrame(
      syncHeaderHeights
    );
  }, [
    article.title,
    article.source,
    article.pubDate,
    viewMode,
    editMode,
    selectedIdx,
  ]);

  useEffect(() => {
    const onResize = () => {
      requestAnimationFrame(
        syncHeaderHeights
      );
    };

    window.addEventListener(
      "resize",
      onResize
    );

    return () => {
      window.removeEventListener(
        "resize",
        onResize
      );
    };
  }, []);

  /**
   * 원문 노출 진행률
   *
   * 현재까지 화면에 노출된 기사 영역을 기준으로 계산합니다.
   * 따라서 처음 로드했을 때도 화면에 보이는 만큼 진행률이 표시됩니다.
   */
  const updateArticleProgress = () => {
    const el = leftRef.current;

    if (!el) {
      setArticleScrollProgress(0);
      return;
    }

    const footerGap =
      el.querySelector(".footer-gap-3");

    const footerGapHeight =
      footerGap?.offsetHeight || 0;

    // 실제 기사 영역 높이
    const articleHeight =
      el.scrollHeight - footerGapHeight;

    // 현재 화면에서 어디까지 노출됐는지
    const visibleBottom =
      el.scrollTop + el.clientHeight;

    if (articleHeight <= 0) {
      setArticleScrollProgress(0);
      return;
    }

    const progress =
      (visibleBottom / articleHeight) * 100;

    setArticleScrollProgress(
      Math.min(100, Math.max(0, progress))
    );
  };

  const handleArticleScroll = () => {
    updateArticleProgress();
  };
  
  useEffect(() => {
  if (!text) {
    setArticleScrollProgress(0);
    return;
  }

  const frame = requestAnimationFrame(() => {
    updateArticleProgress();
  });

  return () => cancelAnimationFrame(frame);
}, [text, viewMode, editMode]);

  return (
    <div className="container">
      {/* 상단 상태/검색 바 */}
      <div className="status">
        <div className="left appTitle">
          기사 필사
        </div>

        <div className="center topSearch">
          <input
            value={query}
            onChange={(event) =>
              setQuery(event.target.value)
            }
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !loading
              ) {
                event.preventDefault();
                doSearch();
              }
            }}
            disabled={loading}
            placeholder="키워드 또는 기사 링크를 입력하세요"
          />

          <button
            onClick={doSearch}
            disabled={loading}
          >
            {loading
              ? "검색 중…"
              : "검색"}
          </button>
        </div>

        <div className="right topRight">
          <span>
            정확도: {accuracy}%
          </span>

          <div
            className="themeToggle"
            title="테마 전환"
          >
            <span
              style={{
                opacity: 0.85,
              }}
            >
              {theme === "dark"
                ? "다크"
                : "라이트"}
            </span>

            <div
              className={`switch ${
                theme === "dark"
                  ? "on"
                  : ""
              }`}
              role="switch"
              aria-checked={
                theme === "dark"
              }
              onClick={toggleTheme}
            >
              <div className="knob" />
            </div>
          </div>
        </div>
      </div>

      {/* 기사 선택 영역 */}
      {options.length > 0 && (
        <div className="resultsBar">
          <label htmlFor="articleSelect">
            기사 선택
          </label>

          <select
            id="articleSelect"
            className="articleSelect"
            value={selectedIdx}
            onChange={(event) =>
              loadSelectedArticle(
                event.target.value
              )
            }
          >
            <option
              value=""
              disabled
            >
              -- 선택하세요 --
            </option>

            {options.map(
              (option) => (
                <option
                  key={option.idx}
                  value={option.idx}
                >
                  [
                  {option.sourceType ===
                  "google"
                    ? "Google"
                    : option.sourceType ===
                        "naver"
                      ? "Naver"
                      : "Direct"}
                  ]{" "}
                  {option.title}

                  {article.title ===
                    option.title &&
                  article.textLength
                    ? ` · ${article.textLength.toLocaleString()}자`
                    : ""}
                </option>
              )
            )}
          </select>

          <select
            className="viewModeSelect"
            value={viewMode}
            onChange={(event) => {
              setViewMode(
                event.target.value
              );

              setEditMode(false);
              setDraft("");
            }}
            disabled={
              !article.content &&
              !article.plain
            }
          >
            <option value="clean">
              정리본(클린)
            </option>

            <option value="plain">
              원문텍스트(라이트)
            </option>
          </select>

          {!editMode ? (
            <button
              onClick={() => {
                const base =
                  (
                    viewMode ===
                    "clean"
                      ? article.content
                      : article.plain
                  ) || "";

                setDraft(base);
                setEditMode(true);
              }}
              disabled={
                !article.content &&
                !article.plain
              }
            >
              편집 모드
            </button>
          ) : (
            <>
              <button
                className="btnApply"
                onClick={() => {
                  if (
                    viewMode ===
                    "clean"
                  ) {
                    setArticle(
                      (prev) => ({
                        ...prev,
                        content: draft,
                        textLength:
                          draft.length,
                      })
                    );
                  } else {
                    setArticle(
                      (prev) => ({
                        ...prev,
                        plain: draft,
                        textLength:
                          draft.length,
                      })
                    );
                  }

                  setEditMode(false);
                }}
              >
                적용
              </button>

              <button
                className="btnCancel"
                onClick={() => {
                  setEditMode(false);
                  setDraft("");
                }}
              >
                취소
              </button>
            </>
          )}
        </div>
      )}

      {/* 로딩 / 결과 없음 */}
      {loading && (
        <div className="loadingRow">
          <span className="spinner" />
          구글·네이버에서 기사 가져오는 중…
        </div>
      )}

      {hasSearched &&
        !loading &&
        options.length === 0 && (
          <div
            className="loadingRow"
            style={{
              paddingTop: 0,
            }}
          >
            <span
              style={{
                opacity: 0.85,
              }}
            >
              뉴스 결과가 없습니다. 검색어를 바꾸거나 더 구체적으로 입력해 보세요.
            </span>
          </div>
        )}

      {loadingArticle && (
        <div className="loadingRow">
          <span className="spinner" />
          선택한 기사 본문을 정리 중…
        </div>
      )}

      {/* 본문 영역 */}
      <div className="grid">
        {/* 왼쪽: 기사 원문 */}
        <div className="pane">
          <header ref={headerLeftRef} className="articleHeader">
            <div className="articleHeaderTitle">
              {article.title || "기사 원문"}
            </div>

            <div className="articleHeaderMeta">
              출처: {article.source || "-"}
              {article.pubDate && (
                <>
                  {" "}
                  · 날짜:{" "}
                  {new Date(article.pubDate).toLocaleDateString("ko-KR", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                  })}
                </>
              )}
            </div>
          </header>

          <div className="scroll">
            <div
              ref={leftRef}
              className={`articleView ${editMode ? "editing" : ""}`}
              onScroll={handleArticleScroll}
            >
              {editMode ? (
                <textarea
                  className="editorInput"
                  spellCheck="false"
                  value={draft}
                  onChange={(event) =>
                    setDraft(
                      event.target.value
                    )
                  }
                  placeholder="여기서 직접 원문을 고칠 수 있어요."
                />
              ) : (
                <div className="articleText">
                  {articleSegments.map(
                    (
                      segment,
                      index
                    ) => {
                      /**
                       * 문단 사이 실제 줄바꿈은
                       * 기존 문자 그대로 출력
                       */
                      if (
                        segment.isSeparator
                      ) {
                        return (
                          <span
                            key={`separator-${index}`}
                          >
                            {
                              segment.text
                            }
                          </span>
                        );
                      }

                      return (
                        <span
                          key={`paragraph-${index}`}
                          data-paragraph-index={
                            segment.paragraphIndex ??
                            undefined
                          }
                        >
                          {segment.text}
                        </span>
                      );
                    }
                  )}
                </div>
              )}

      {!editMode && <div className="footer-gap-3" />}
            </div>
          </div>
          
          <div className="info articleInfo">
            <div className="articleProgress">
              <div
                className="articleProgressBar"
                style={{
                  width: `${articleScrollProgress}%`,
                }}
              />
            </div>

            <span>
              기사 출처와 날짜를 확인한 뒤 필사를 시작하세요.
            </span>
          </div>
        </div>
                
        {/* 오른쪽: 필사 입력 */}
        <div className="pane">
          <header ref={headerRightRef}>
            필사 입력
          </header>

          <div className="scroll">
            <div className="typingBox">
              <textarea
                ref={typingRef}
                className={`typingInput ${
                  hasError
                    ? "error"
                    : ""
                }`}
                spellCheck="false"
                value={input}
                onChange={onChangeTyping}
                disabled={
                  paused ||
                  round >
                    MAX_ROUNDS ||
                  !(
                    article.content ||
                    article.plain
                  )
                }
                placeholder={
                  text.length
                    ? ""
                    : "선택한 기사 원문을 그대로 타이핑하세요."
                }
              />
            </div>
          </div>

          <div className="info">
            {countdown !== null &&
              !paused && (
                <span className="countdownText">
                  필사가 완료되었습니다.{" "}
                  {countdown}초 뒤 복기
                  화면으로 이동합니다...
                </span>
              )}

            {paused &&
              round <
                MAX_ROUNDS && (
                <span
                  className="actions"
                  style={{
                    marginLeft: 8,
                  }}
                >
                  <span>
                    필사 내용이
                    복사되었습니다.
                    복기 후{" "}
                  </span>

                  <button
                    onClick={() => {
                      setCountdown(null);
                      setPaused(false);

                      setRound(
                        (prev) =>
                          prev + 1
                      );
                    }}
                  >
                    다음 회차
                  </button>
                </span>
              )}

            {paused &&
              round ===
                MAX_ROUNDS && (
                <span className="actions">
                  <span>
                    3회차 완료!
                  </span>

                  <button
                    className="btnApply"
                    onClick={
                      downloadWordFile
                    }
                  >
                    워드 저장
                  </button>
                </span>
              )}
          </div>
        </div>
      </div>

      <footer className="footer">
        © 2025 Park Hyung-jo. All rights reserved.
      </footer>

    {SHOW_SCROLL_DEBUG && (
      <div className="scrollDebug">
        <strong>SCROLL DEBUG</strong>

        <div>
          현재 문단: {scrollDebug.paragraph}
        </div>

        <div>
          문단 DOM: {scrollDebug.targetFound ? "FOUND" : "NOT FOUND"}
        </div>

        <div>
          문단 위치: {scrollDebug.relativeTop}px
        </div>

        <div>
          화면 높이: {scrollDebug.visibleHeight}px
        </div>

        <div>
          작동 기준: {scrollDebug.triggerPoint}px
        </div>

        <div>
          현재 scrollTop: {scrollDebug.scrollTop}px
        </div>

        <div>
          전체 높이: {scrollDebug.scrollHeight}px
        </div>

        <div>
          스크롤 조건: {scrollDebug.executed ? "YES" : "NO"}
        </div>
      </div>
   )} 

    </div>
  );
}