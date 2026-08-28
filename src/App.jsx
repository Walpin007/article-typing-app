import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
} from "docx";
import { saveAs } from "file-saver";

import { supabase } from "./lib/supabaseClient";
import "./index.css";


/* =============== CONSTANTS =============== */

const MAX_ROUNDS = 3;
const SHOW_SCROLL_DEBUG = false;


/* =============== UTILITIES =============== */

/**
 * 화면의 원문은 변경하지 않고
 * 정확도·오타·완료 판단 시 문자 모양 차이만 흡수합니다.
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

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );
  } catch {
    return false;
  }
};


/* =============== APP =============== */

export default function App() {
  /* ---------- Theme ---------- */

  const getInitTheme = () => {
    const saved = localStorage.getItem("theme");

    if (saved === "light" || saved === "dark") {
      return saved;
    }

    return window.matchMedia &&
      window.matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches
      ? "dark"
      : "light";
  };

  const [theme, setTheme] = useState(getInitTheme);

  const toggleTheme = () => {
    setTheme((prev) =>
      prev === "dark" ? "light" : "dark"
    );
  };


  /* ---------- Auth ---------- */

  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("로그아웃 오류:", error);
      return;
    }

    setUser(null);
  };


  /* ---------- Typing ---------- */

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

  const [
    articleScrollProgress,
    setArticleScrollProgress,
  ] = useState(0);


  /* ---------- Summary ---------- */

  const [summary, setSummary] = useState("");
  const [summaryVisible, setSummaryVisible] =
    useState(false);

  // 요약창 등장 직전의 원문/필사 영역 높이
  const [lockedGridHeight, setLockedGridHeight] =
    useState(null);


  /* ---------- Monthly stats ---------- */

  const [monthlyStats, setMonthlyStats] = useState({
    month: new Date().getMonth() + 1,
    totalTypedChars: 0,
    completedArticles: 0,
    summaryCount: 0,
  });


  /* ---------- Search ---------- */

  const [query, setQuery] = useState("");
  const [options, setOptions] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingArticle, setLoadingArticle] =
    useState(false);


  /* ---------- Article ---------- */

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


  /* ---------- Refs ---------- */

  const headerLeftRef = useRef(null);
  const headerRightRef = useRef(null);

  // 실제 원문 스크롤 컨테이너
  const leftRef = useRef(null);

  const typingRef = useRef(null);

  // 마지막으로 자동 스크롤한 문단
  const lastAutoScrolledParagraphRef = useRef(-1);

  const gridRef = useRef(null);
  const summaryRef = useRef(null);

  // 같은 기사에서 Word 저장을 여러 번 눌러도
  // DB 기록은 한 번만 저장
  const trainingSavedRef = useRef(false);


  /* =============== DERIVED VALUES =============== */

  const text =
    (editMode
      ? draft
      : viewMode === "clean"
        ? article.content
        : article.plain) || "";

  const input = typed[round - 1] || "";

  const normalizedInput = useMemo(
    () => normalizeForCompare(input),
    [input]
  );

  const normalizedText = useMemo(
    () => normalizeForCompare(text),
    [text]
  );


  /* =============== ARTICLE SEGMENTS =============== */

  /**
   * 원문을 문단과 줄바꿈 구간으로 나눕니다.
   * 줄바꿈 1개 이상을 문단 경계로 인식하되
   * 실제 표시되는 줄바꿈은 그대로 유지합니다.
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
   * 현재 필사 중인 문단을 계산합니다.
   * 문단 사이 줄바꿈 입력 중에는 직전 문단을 유지합니다.
   */
  const currentParagraphIndex = useMemo(() => {
    if (!normalizedInput.length) {
      return 0;
    }

    const position = normalizedInput.length;

    let previousParagraphIndex = 0;

    for (const segment of articleSegments) {
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


  /* =============== TYPING CALCULATIONS =============== */

  const accuracy = useMemo(() => {
    if (!normalizedInput.length) {
      return 100;
    }

    let correctCount = 0;

    for (
      let i = 0;
      i < normalizedInput.length;
      i++
    ) {
      if (
        normalizedInput[i] === normalizedText[i]
      ) {
        correctCount += 1;
      }
    }

    return Number(
      (
        (correctCount / normalizedInput.length) *
        100
      ).toFixed(1)
    );
  }, [normalizedInput, normalizedText]);


  /**
   * textarea는 글자별 색상 지정이 어려우므로
   * 오타가 하나라도 있으면 입력창 전체를 빨간색 처리합니다.
   */
  const hasError = useMemo(() => {
    for (
      let i = 0;
      i < normalizedInput.length;
      i++
    ) {
      if (
        normalizedInput[i] !== normalizedText[i]
      ) {
        return true;
      }
    }

    return false;
  }, [normalizedInput, normalizedText]);


  const isFinished = useMemo(() => {
    const typedText = normalizedInput.trim();
    const originalText = normalizedText.trim();

    return Boolean(
      typedText &&
      originalText &&
      typedText === originalText
    );
  }, [normalizedInput, normalizedText]);


  /* =============== LAYOUT HELPERS =============== */

  const syncHeaderHeights = () => {
    const leftHeader = headerLeftRef.current;
    const rightHeader = headerRightRef.current;

    if (!leftHeader || !rightHeader) {
      return;
    }

    leftHeader.style.minHeight = "";
    rightHeader.style.minHeight = "";

    const leftHeight =
      leftHeader.getBoundingClientRect().height;

    const rightHeight =
      rightHeader.getBoundingClientRect().height;

    const maxHeight = Math.max(
      leftHeight,
      rightHeight
    );

    leftHeader.style.minHeight = `${maxHeight}px`;
    rightHeader.style.minHeight = `${maxHeight}px`;
  };


  /**
   * 새 기사 로드 시 필사 세션 상태를 초기화합니다.
   */
  const resetTrainingSession = () => {
    setEditMode(false);
    setDraft("");

    setRound(1);
    setTyped(["", "", ""]);
    setPaused(false);
    setCountdown(null);

    setSummary("");
    setSummaryVisible(false);
    setLockedGridHeight(null);

    trainingSavedRef.current = false;
    lastAutoScrolledParagraphRef.current = -1;

    if (leftRef.current) {
      leftRef.current.scrollTop = 0;
    }

    requestAnimationFrame(syncHeaderHeights);
  };


  /* =============== SUPABASE =============== */

  const loadMonthlyStatsFromSupabase = async () => {
    if (!user) return;

    const now = new Date();

    const year = now.getFullYear();
    const monthNumber = now.getMonth() + 1;

    const month = String(monthNumber).padStart(
      2,
      "0"
    );

    const startDate = `${year}-${month}-01`;

    const nextMonthDate = new Date(
      year,
      now.getMonth() + 1,
      1
    );

    const nextYear = nextMonthDate.getFullYear();

    const nextMonth = String(
      nextMonthDate.getMonth() + 1
    ).padStart(2, "0");

    const endDate =
      `${nextYear}-${nextMonth}-01`;

    const { data, error } = await supabase
      .from("training_history")
      .select("typed_chars, summary_written")
      .gte("completed_date", startDate)
      .lt("completed_date", endDate);

    if (error) {
      console.error(
        "월간 필사 기록 조회 오류:",
        error
      );

      return;
    }

    const history = Array.isArray(data)
      ? data
      : [];

    setMonthlyStats({
      month: monthNumber,

      totalTypedChars: history.reduce(
        (sum, item) =>
          sum + (item.typed_chars || 0),
        0
      ),

      completedArticles: history.length,

      summaryCount: history.filter(
        (item) => item.summary_written
      ).length,
    });
  };


  const saveTrainingStatsToSupabase = async () => {
    if (!user) {
      alert(
        "DB 저장 실패: 로그인 사용자 정보를 찾을 수 없습니다."
      );

      return {
        success: false,
        reason: "not_logged_in",
      };
    }

    const now = new Date();

    const yyyy = now.getFullYear();

    const mm = String(
      now.getMonth() + 1
    ).padStart(2, "0");

    const dd = String(
      now.getDate()
    ).padStart(2, "0");

    const completedDate =
      `${yyyy}-${mm}-${dd}`;

    const typedChars = typed.reduce(
      (sum, roundText) =>
        sum + roundText.length,
      0
    );

    const record = {
      user_id: user.id,

      completed_date: completedDate,
      completed_at: now.toISOString(),

      title: article.title || "",
      source: article.source || "",

      article_chars: text.length,
      typed_chars: typedChars,

      rounds: MAX_ROUNDS,

      summary_written:
        Boolean(summary.trim()),

      summary_chars:
        summary.trim().length,
    };

    const { error } = await supabase
      .from("training_history")
      .insert(record);

    if (error) {
      console.error(
        "Supabase 필사 기록 저장 오류:",
        error
      );

      alert(
        `DB 저장 실패\n\n` +
        `message: ${error.message}\n` +
        `code: ${error.code || "-"}\n` +
        `details: ${error.details || "-"}\n` +
        `hint: ${error.hint || "-"}`
      );

      return {
        success: false,
        reason: "database_error",
        error,
      };
    }

    return {
      success: true,
    };
  };


  /* =============== SEARCH / ARTICLE =============== */

  const doSearch = async () => {
    const keyword = query.trim();

    if (!keyword || loading) {
      return;
    }

    setLoading(true);
    setHasSearched(false);
    setOptions([]);
    setSelectedIdx("");

    try {
      /**
       * URL을 입력한 경우 검색 결과를 거치지 않고
       * 바로 기사 본문을 추출합니다.
       */
      if (isValidUrl(keyword)) {
        const response = await fetch(
          `/api/extract?url=${encodeURIComponent(
            keyword
          )}`
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data?.error ||
            "기사 본문 추출 실패"
          );
        }

        const textLength =
          typeof data?.textLength === "number"
            ? data.textLength
            : data?.text?.length || 0;

        const directOption = {
          idx: 0,
          sourceType: "direct",
          title:
            data?.title ||
            "직접 입력한 기사",
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

        resetTrainingSession();

        return;
      }

      const response = await fetch(
        `/api/search-mixed?q=${encodeURIComponent(
          keyword
        )}`
      );

      const data = await response.json();

      const items = Array.isArray(data.items)
        ? data.items
        : [];

      const searchOptions = items
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

      setOptions(searchOptions);
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


  const loadSelectedArticle = async (idxStr) => {
    setSelectedIdx(idxStr);

    const idx = Number(idxStr);

    if (Number.isNaN(idx)) {
      return;
    }

    const selected = options[idx];

    if (!selected) {
      return;
    }

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

      resetTrainingSession();
    } catch (error) {
      console.error(
        "기사 본문 추출 오류:",
        error
      );
    } finally {
      setLoadingArticle(false);
    }
  };


  /* =============== TYPING ACTIONS =============== */

  const onChangeTyping = (event) => {
    const value = event.target.value;

    setTyped((prev) => {
      const next = [...prev];

      next[round - 1] = value;

      return next;
    });
  };


  const completeRoundAndCopy = async () => {
    try {
      await navigator.clipboard.writeText(input);
    } catch (error) {
      console.error("복사 실패:", error);
    }

    /**
     * 3회차 완료 시 현재 필사 영역 높이를 고정한 뒤
     * 아래에 요약 영역을 표시합니다.
     */
    if (round === MAX_ROUNDS) {
      if (gridRef.current) {
        const currentHeight =
          gridRef.current.getBoundingClientRect()
            .height;

        setLockedGridHeight(currentHeight);
      }

      setSummaryVisible(true);
    }

    setPaused(true);
  };


  /* =============== WORD EXPORT =============== */

  const downloadWordFile = async () => {
    /**
     * Word 저장 버튼을 실제로 눌렀을 때만
     * 훈련 완료 기록을 Supabase에 저장합니다.
     */
    if (!trainingSavedRef.current) {
      if (!user) {
        alert(
          "필사 기록을 저장하려면 로그인이 필요합니다."
        );
      } else {
        const result =
          await saveTrainingStatsToSupabase();

        if (result.success) {
          trainingSavedRef.current = true;

          await loadMonthlyStatsFromSupabase();
        } else {
          console.error(
            "서버 기록 저장에 실패했습니다."
          );
        }
      }
    }

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
              text:
                `출처: ${
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

            new Paragraph({
              text: "",
            }),

            new Paragraph({
              text:
                "[내 문장으로 정리하기]",
              heading:
                HeadingLevel.HEADING_2,
            }),

            ...(summary.trim()
              ? summary
                  .split(/\n+/)
                  .filter((paragraph) =>
                    paragraph.trim()
                  )
                  .map(
                    (paragraph) =>
                      new Paragraph({
                        text: paragraph,
                      })
                  )
              : [
                  new Paragraph({
                    text:
                      "(작성하지 않음)",
                  }),
                ]),
          ],
        },
      ],
    });

    const blob = await Packer.toBlob(doc);

    const now = new Date();

    const yy = String(
      now.getFullYear()
    ).slice(2);

    const mm = String(
      now.getMonth() + 1
    ).padStart(2, "0");

    const dd = String(
      now.getDate()
    ).padStart(2, "0");

    const safeTitle = (
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


  /* =============== ARTICLE PROGRESS =============== */

  const updateArticleProgress = () => {
    const element = leftRef.current;

    if (!element) {
      setArticleScrollProgress(0);
      return;
    }

    const footerGap =
      element.querySelector(".footer-gap-3");

    const footerGapHeight =
      footerGap?.offsetHeight || 0;

    const articleHeight =
      element.scrollHeight -
      footerGapHeight;

    const visibleBottom =
      element.scrollTop +
      element.clientHeight;

    if (articleHeight <= 0) {
      setArticleScrollProgress(0);
      return;
    }

    const progress =
      (visibleBottom / articleHeight) * 100;

    setArticleScrollProgress(
      Math.min(
        100,
        Math.max(0, progress)
      )
    );
  };


  const handleArticleScroll = () => {
    updateArticleProgress();
  };


  /* =============== EFFECTS =============== */

  // Theme
  useEffect(() => {
    document.documentElement.setAttribute(
      "data-theme",
      theme
    );

    localStorage.setItem("theme", theme);
  }, [theme]);


  // Auth session
  useEffect(() => {
    let mounted = true;

    const loadSession = async () => {
      const {
        data: { session },
      } =
        await supabase.auth.getSession();

      if (!mounted) {
        return;
      }

      setUser(session?.user ?? null);
      setAuthLoading(false);
    };

    loadSession();

    const {
      data: { subscription },
    } =
      supabase.auth.onAuthStateChange(
        (_event, session) => {
          setUser(session?.user ?? null);
          setAuthLoading(false);
        }
      );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);


  // 로그인 상태에 따라 월간 통계 로드
  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (user) {
      loadMonthlyStatsFromSupabase();
    } else {
      setMonthlyStats({
        month: new Date().getMonth() + 1,
        totalTypedChars: 0,
        completedArticles: 0,
        summaryCount: 0,
      });
    }
  }, [user, authLoading]);


  // 새 기사 또는 새 회차 시작 시 원문 스크롤 초기화
  useEffect(() => {
    lastAutoScrolledParagraphRef.current = -1;

    if (leftRef.current) {
      leftRef.current.scrollTop = 0;
    }
  }, [round, text]);


  /**
   * 현재 필사 문단이 화면 아래 70% 지점에 도달하거나
   * 화면 위쪽으로 벗어나면 약 20% 위치로 이동합니다.
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

    if (currentParagraphIndex < 0) {
      return;
    }

    if (editMode) {
      return;
    }

    const target =
      scrollContainer.querySelector(
        `[data-paragraph-index="${currentParagraphIndex}"]`
      );

    if (!target) {
      setScrollDebug({
        paragraph: currentParagraphIndex,
        targetFound: false,
        relativeTop: 0,
        visibleHeight:
          scrollContainer.clientHeight,
        triggerPoint:
          scrollContainer.clientHeight * 0.7,
        scrollTop:
          scrollContainer.scrollTop,
        scrollHeight:
          scrollContainer.scrollHeight,
        executed: false,
      });

      return;
    }

    const containerRect =
      scrollContainer.getBoundingClientRect();

    const targetRect =
      target.getBoundingClientRect();

    const relativeTop =
      targetRect.top -
      containerRect.top;

    const visibleHeight =
      scrollContainer.clientHeight;

    if (!visibleHeight) {
      return;
    }

    const triggerPoint =
      visibleHeight * 0.7;

    const targetPoint =
      visibleHeight * 0.2;

    const shouldScrollDown =
      relativeTop >= triggerPoint;

    const shouldRecoverUp =
      relativeTop < 0;

    const shouldScroll =
      shouldScrollDown ||
      shouldRecoverUp;

    setScrollDebug({
      paragraph: currentParagraphIndex,
      targetFound: true,
      relativeTop:
        Math.round(relativeTop),
      visibleHeight:
        Math.round(visibleHeight),
      triggerPoint:
        Math.round(triggerPoint),
      scrollTop:
        Math.round(
          scrollContainer.scrollTop
        ),
      scrollHeight:
        Math.round(
          scrollContainer.scrollHeight
        ),
      executed: shouldScroll,
    });

    // 같은 문단에서 반복 자동 스크롤하지 않음
    if (
      lastAutoScrolledParagraphRef.current ===
      currentParagraphIndex
    ) {
      return;
    }

    if (!shouldScroll) {
      return;
    }

    const scrollAmount =
      relativeTop - targetPoint;

    const maxScrollTop =
      scrollContainer.scrollHeight -
      scrollContainer.clientHeight;

    const nextScrollTop = Math.min(
      Math.max(
        0,
        scrollContainer.scrollTop +
          scrollAmount
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


  // 필사 완료 시 3초 카운트다운 시작
  useEffect(() => {
    if (
      isFinished &&
      !paused &&
      countdown === null &&
      round <= MAX_ROUNDS
    ) {
      setCountdown(3);
    }
  }, [
    isFinished,
    paused,
    countdown,
    round,
  ]);


  // 완료 카운트다운
  useEffect(() => {
    if (countdown === null) {
      return;
    }

    if (countdown <= 0) {
      completeRoundAndCopy();
      setCountdown(null);

      return;
    }

    const timer = setTimeout(() => {
      setCountdown(
        (prev) => prev - 1
      );
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown]);


  // 좌우 헤더 높이 동기화
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


  // 화면 크기 변경 시 헤더 높이 재계산
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


  // 요약 영역이 열리면 화면 아래쪽에 자연스럽게 노출
  useEffect(() => {
    if (!summaryVisible) {
      return;
    }

    if (!summaryRef.current) {
      return;
    }

    const timer = setTimeout(() => {
      const rect =
        summaryRef.current.getBoundingClientRect();

      const targetViewportY =
        window.innerHeight * 0.62;

      const scrollAmount =
        rect.top - targetViewportY;

      window.scrollBy({
        top: scrollAmount,
        behavior: "smooth",
      });
    }, 150);

    return () => clearTimeout(timer);
  }, [summaryVisible]);


  /**
   * 현재 화면에 노출된 기사 영역을 기준으로
   * 원문 진행률을 계산합니다.
   */
  useEffect(() => {
    if (!text) {
      setArticleScrollProgress(0);
      return;
    }

    const frame =
      requestAnimationFrame(() => {
        updateArticleProgress();
      });

    return () =>
      cancelAnimationFrame(frame);
  }, [text, viewMode, editMode]);


  /* =============== RENDER =============== */

  return (
    <div
      className={`container ${
        summaryVisible
          ? "summaryOpen"
          : ""
      }`}
    >
      {/* 상단 상태 / 검색 */}
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

          {!authLoading && (
            <>
              {user ? (
                <div className="userMenu">
                  <button
                    type="button"
                    className="userMenuButton"
                    onClick={() =>
                      setUserMenuOpen(
                        (prev) => !prev
                      )
                    }
                    aria-expanded={
                      userMenuOpen
                    }
                  >
                    <span className="userName">
                      {user.user_metadata
                        ?.name ||
                        user.user_metadata
                          ?.full_name ||
                        user.email}
                    </span>

                    <span className="userMenuArrow">
                      ▾
                    </span>
                  </button>

                  {userMenuOpen && (
                    <div className="userDropdown">
                      <button
                        type="button"
                        className="userDropdownItem"
                        onClick={async () => {
                          setUserMenuOpen(
                            false
                          );

                          await handleLogout();
                        }}
                      >
                        로그아웃
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  to="/login"
                  className="loginButton"
                >
                  로그인
                </Link>
              )}
            </>
          )}
        </div>
      </div>


      {/* 기사 선택 */}
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

            {options.map((option) => (
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
            ))}
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
                    viewMode === "clean"
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
                    viewMode === "clean"
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


      {/* 검색 / 기사 로딩 */}
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
              뉴스 결과가 없습니다. 검색어를 바꾸거나 더
              구체적으로 입력해 보세요.
            </span>
          </div>
        )}

      {loadingArticle && (
        <div className="loadingRow">
          <span className="spinner" />
          선택한 기사 본문을 정리 중…
        </div>
      )}


      {/* 원문 / 필사 */}
      <div
        ref={gridRef}
        className="grid"
        style={
          summaryVisible &&
          lockedGridHeight
            ? {
                flex: "0 0 auto",
                height:
                  `${lockedGridHeight}px`,
                minHeight:
                  `${lockedGridHeight}px`,
              }
            : undefined
        }
      >
        {/* 기사 원문 */}
        <div className="pane">
          <header
            ref={headerLeftRef}
            className="articleHeader"
          >
            <div className="articleHeaderTitle">
              {article.title ||
                "기사 원문"}
            </div>

            <div className="articleHeaderMeta">
              출처:{" "}
              {article.source || "-"}

              {article.pubDate && (
                <>
                  {" "}
                  · 날짜:{" "}
                  {new Date(
                    article.pubDate
                  ).toLocaleDateString(
                    "ko-KR",
                    {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                    }
                  )}
                </>
              )}
            </div>
          </header>

          <div className="scroll">
            <div
              ref={leftRef}
              className={`articleView ${
                editMode
                  ? "editing"
                  : ""
              }`}
              onScroll={
                handleArticleScroll
              }
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
                    (segment, index) => {
                      if (
                        segment.isSeparator
                      ) {
                        return (
                          <span
                            key={`separator-${index}`}
                          >
                            {segment.text}
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

              {!editMode && (
                <div className="footer-gap-3" />
              )}
            </div>
          </div>

          <div className="info articleInfo">
            <div className="articleProgress">
              <div
                className="articleProgressBar"
                style={{
                  width:
                    `${articleScrollProgress}%`,
                }}
              />
            </div>

            <span>
              기사 출처와 날짜를 확인한 뒤 필사를
              시작하세요.
            </span>
          </div>
        </div>


        {/* 필사 입력 */}
        <div className="pane">
          <header
            ref={headerRightRef}
            className="typingHeader"
          >
            <div className="typingHeaderTitle">
              필사 입력
            </div>

            <div className="typingHeaderMeta">
              {Math.min(
                round,
                MAX_ROUNDS
              )}
              회차 · 정확도 {accuracy}%
            </div>
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
                  round > MAX_ROUNDS ||
                  !(
                    article.content ||
                    article.plain
                  )
                }
                placeholder={
                  text.length
                    ? "이곳을 클릭하고 필사를 시작하세요"
                    : "기사를 선택하면 필사를 시작할 수 있습니다"
                }
              />
            </div>
          </div>

          <div className="info">
            {countdown !== null &&
              !paused && (
                <span className="countdownText">
                  필사가 완료되었습니다.{" "}
                  {countdown}초 뒤 복기 화면으로
                  이동합니다...
                </span>
              )}

            {paused &&
              round < MAX_ROUNDS && (
                <span
                  className="actions"
                  style={{
                    marginLeft: 8,
                  }}
                >
                  <span>
                    필사 내용이 복사되었습니다. 복기 후{" "}
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
              round === MAX_ROUNDS && (
                <span className="actions">
                  <span>
                    3회차 완료! 아래에서 기사를 직접
                    요약해 보세요.
                  </span>
                </span>
              )}
          </div>
        </div>
      </div>


      {/* 내 문장으로 정리하기 */}
      {summaryVisible && (
        <section
          ref={summaryRef}
          className="summaryPanel"
        >
          <div className="summaryHeader">
            <div className="summaryTitle">
              내 문장으로 정리하기
            </div>

            <button
              className="summaryWordButton"
              onClick={downloadWordFile}
              title="워드 파일로 저장"
            >
              워드 저장
            </button>
          </div>

          <textarea
            className="summaryInput"
            value={summary}
            onChange={(event) =>
              setSummary(
                event.target.value
              )
            }
            spellCheck="false"
            placeholder="읽은 내용을 정리하고, 하고 싶은 이야기가 있다면 이어서 써보세요. (워드 저장 버튼으로 Skip 가능)"
          />
        </section>
      )}


      {/* 월간 기록 */}
      <div className="monthlyReward">
        {monthlyStats.month}월 누적 필사{" "}
        {monthlyStats.totalTypedChars.toLocaleString()}
        자 · 기사{" "}
        {monthlyStats.completedArticles.toLocaleString()}
        개 · 내 문장{" "}
        {monthlyStats.summaryCount.toLocaleString()}
        개
      </div>


      {/* Footer */}
      <footer className="footer">
        © 2025 Park Hyung-jo. All rights reserved.
      </footer>


      {/* 개발용 스크롤 디버그 */}
      {SHOW_SCROLL_DEBUG && (
        <div className="scrollDebug">
          <strong>
            SCROLL DEBUG
          </strong>

          <div>
            현재 문단:{" "}
            {scrollDebug.paragraph}
          </div>

          <div>
            문단 DOM:{" "}
            {scrollDebug.targetFound
              ? "FOUND"
              : "NOT FOUND"}
          </div>

          <div>
            문단 위치:{" "}
            {scrollDebug.relativeTop}px
          </div>

          <div>
            화면 높이:{" "}
            {scrollDebug.visibleHeight}px
          </div>

          <div>
            작동 기준:{" "}
            {scrollDebug.triggerPoint}px
          </div>

          <div>
            현재 scrollTop:{" "}
            {scrollDebug.scrollTop}px
          </div>

          <div>
            전체 높이:{" "}
            {scrollDebug.scrollHeight}px
          </div>

          <div>
            스크롤 조건:{" "}
            {scrollDebug.executed
              ? "YES"
              : "NO"}
          </div>
        </div>
      )}
    </div>
  );
}