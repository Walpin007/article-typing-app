import { useEffect, useMemo, useRef, useState } from "react";
import "./index.css";

const MAX_ROUNDS = 3;

/**
 * 비교용 정규화 함수
 * 화면에 보이는 원문은 그대로 유지하고,
 * 정확도/오타/완료 판단할 때만 문자 모양 차이를 흡수합니다.
 */
const normalizeForCompare = (value = "") => {
  return value
    // 쌍따옴표류 통일
    .replace(/[“”„‟]/g, '"')

    // 홑따옴표류 통일
    .replace(/[‘’‚‛]/g, "'")

    // 백틱/악센트/프라임 기호도 홑따옴표로 통일
    .replace(/[`´′]/g, "'")

    // 긴 대시류 통일
    .replace(/[–—―]/g, "-")

    // 말줄임표 통일
    .replace(/…/g, "...")

    // 특수 공백을 일반 공백으로 통일
    .replace(/\u00A0/g, " ");
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
  const leftRef = useRef(null);
  const typingRef = useRef(null);

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

    return Number(((ok / normalizedInput.length) * 100).toFixed(1));
  }, [normalizedInput, normalizedText]);

  /**
   * 오타 여부
   * textarea는 글자별 색상 지정이 어려우므로,
   * 오타가 하나라도 있으면 입력창 전체 색상을 빨간색으로 바꿉니다.
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
   * 따옴표/대시/말줄임표 등은 정규화 기준으로 완료 처리합니다.
   */
  const isFinished = useMemo(() => {
    const a = normalizedInput.trim();
    const b = normalizedText.trim();

    return Boolean(a && b && a === b);
  }, [normalizedInput, normalizedText]);

  /**
   * Search
   */
  const doSearch = async () => {
    if (!query.trim() || loading) return;

    setLoading(true);
    setHasSearched(false);
    setOptions([]);
    setSelectedIdx("");

    try {
      const response = await fetch(
        `/api/search-mixed?q=${encodeURIComponent(query.trim())}`
      );

      const data = await response.json();
      const items = Array.isArray(data.items) ? data.items : [];

      const opts = items.slice(0, 10).map((item, index) => ({
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
      console.error("검색 오류:", error);
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
        `/api/extract?url=${encodeURIComponent(selected.link)}`
      );

      const data = await response.json();

      const textLength =
        typeof data?.textLength === "number"
          ? data.textLength
          : data?.text?.length || 0;

      setArticle({
        title: selected.title || data?.title || "",
        source: `${
          selected.sourceType === "google" ? "Google" : "Naver"
        }/${(data?.source || selected.displayLink || "").replace(/^www\./, "")}`,
        content: data?.text || "",
        plain: data?.plain || "",
        pubDate: selected.pubDate || data?.pubDate || "",
        textLength,
      });

      setViewMode(data?.mode === "plain" ? "plain" : "clean");
      setEditMode(false);
      setDraft("");
      setRound(1);
      setTyped(["", "", ""]);
      setPaused(false);

      if (leftRef.current) {
        leftRef.current.scrollTop = 0;
      }

      requestAnimationFrame(syncHeaderHeights);
    } catch (error) {
      console.error("기사 본문 추출 오류:", error);
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
   * Header height sync
   */
  const syncHeaderHeights = () => {
    const leftHeader = headerLeftRef.current;
    const rightHeader = headerRightRef.current;

    if (!leftHeader || !rightHeader) return;

    leftHeader.style.minHeight = "";
    rightHeader.style.minHeight = "";

    const leftHeight = leftHeader.getBoundingClientRect().height;
    const rightHeight = rightHeader.getBoundingClientRect().height;
    const maxHeight = Math.max(leftHeight, rightHeight);

    leftHeader.style.minHeight = `${maxHeight}px`;
    rightHeader.style.minHeight = `${maxHeight}px`;
  };

  useEffect(() => {
    requestAnimationFrame(syncHeaderHeights);
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
      requestAnimationFrame(syncHeaderHeights);
    };

    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <div className="container">
      {/* 상단 상태 바 */}
      <div className="status">
        <div className="left">필사 {round}회차</div>
        <div className="center">
          글자 수: {input.length} / {text.length}
        </div>
        <div className="right">정확도: {accuracy}%</div>
      </div>

      {/* 검색 영역 */}
      <div className="toolbar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !loading) {
              event.preventDefault();
              doSearch();
            }
          }}
          disabled={loading}
          placeholder="키워드를 입력하세요 (예: 반도체, 금리, 전기차)"
          style={{ flex: 1, minWidth: 220 }}
        />

        <button onClick={doSearch} disabled={loading}>
          {loading ? "검색 중…" : "검색"}
        </button>

        {/* 테마 토글 */}
        <div className="themeToggle" title="테마 전환">
          <span style={{ opacity: 0.85 }}>
            {theme === "dark" ? "다크" : "라이트"}
          </span>

          <div
            className={`switch ${theme === "dark" ? "on" : ""}`}
            role="switch"
            aria-checked={theme === "dark"}
            onClick={toggleTheme}
          >
            <div className="knob" />
          </div>
        </div>
      </div>

      {/* 기사 선택 영역 */}
      {options.length > 0 && (
        <div className="resultsBar">
          <label htmlFor="articleSelect">
            기사 선택(최대 {Math.min(10, options.length)}개):
          </label>

          <select
            id="articleSelect"
            className="articleSelect"
            value={selectedIdx}
            onChange={(event) => loadSelectedArticle(event.target.value)}
          >
            <option value="" disabled>
              — 선택하세요 —
            </option>

            {options.map((option) => (
              <option key={option.idx} value={option.idx}>
                [{option.sourceType === "google" ? "Google" : "Naver"}]{" "}
                {option.title}
                {article.title === option.title && article.textLength
                  ? ` · ${article.textLength.toLocaleString()}자`
                  : ""}
              </option>
            ))}
          </select>

          <select
            className="viewModeSelect"
            value={viewMode}
            onChange={(event) => {
              setViewMode(event.target.value);
              setEditMode(false);
              setDraft("");
            }}
            disabled={!article.content && !article.plain}
          >
            <option value="clean">정리본(클린)</option>
            <option value="plain">원문텍스트(라이트)</option>
          </select>

          {!editMode ? (
            <button
              onClick={() => {
                const base =
                  (viewMode === "clean" ? article.content : article.plain) ||
                  "";

                setDraft(base);
                setEditMode(true);
              }}
              disabled={!article.content && !article.plain}
            >
              편집 모드
            </button>
          ) : (
            <>
              <button
                className="btnApply"
                onClick={() => {
                  if (viewMode === "clean") {
                    setArticle((prev) => ({
                      ...prev,
                      content: draft,
                      textLength: draft.length,
                    }));
                  } else {
                    setArticle((prev) => ({
                      ...prev,
                      plain: draft,
                      textLength: draft.length,
                    }));
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

      {hasSearched && !loading && options.length === 0 && (
        <div className="loadingRow" style={{ paddingTop: 0 }}>
          <span style={{ opacity: 0.85 }}>
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
          <header ref={headerLeftRef}>
            {article.title || "기사 원문"}{" "}
            <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
              · 출처: {article.source || "-"}
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
            </span>
          </header>

          <div className="scroll">
            <div ref={leftRef} className="articleView mono">
              {editMode ? (
                <textarea
                  className="editorInput mono"
                  spellCheck="false"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="여기서 직접 원문을 고칠 수 있어요."
                />
              ) : (
                <div className="articleText">
                  {article.content || article.plain
                    ? viewMode === "clean"
                      ? article.content
                      : article.plain
                    : ""}
                </div>
              )}

              <div className="footer-gap-3" />
            </div>
          </div>

          <div className="info">
            기사 출처와 날짜를 확인한 뒤 필사를 시작하세요.
          </div>
        </div>

        {/* 오른쪽: 필사 입력 */}
        <div className="pane">
          <header ref={headerRightRef}>필사 입력</header>

          <div className="scroll">
            <div className="typingBox">
              <textarea
                ref={typingRef}
                className={`typingInput ${hasError ? "error" : ""}`}
                spellCheck="false"
                value={input}
                onChange={onChangeTyping}
                disabled={
                  paused ||
                  round > MAX_ROUNDS ||
                  !(article.content || article.plain)
                }
                placeholder={
                  text.length ? "" : "선택한 기사 원문을 그대로 타이핑하세요."
                }
              />

            </div>
          </div>

          <div className="info">
            {!paused && isFinished && (
              <button onClick={() => setPaused(true)}>
                이 회차 완료
              </button>
            )}

            {paused && round < MAX_ROUNDS && (
              <span className="actions" style={{ marginLeft: 8 }}>
                <span>복기 후 </span>
                <button
                  onClick={() => {
                    setPaused(false);
                    setRound((prev) => prev + 1);
                  }}
                >
                  다음 회차
                </button>
              </span>
            )}

            {paused && round === MAX_ROUNDS && (
              <span>3회차 완료! 워드 저장 기능은 다음 단계에서 연결하면 됩니다.</span>
            )}
          </div>
        </div>
      </div>

      <footer className="footer">
        © 2025 Park Hyung-jo. All rights reserved.
      </footer>
    </div>
  );
}
