import { useEffect, useMemo, useRef, useState } from "react";
import "./index.css";

const MAX_ROUNDS = 3;

export default function App() {
  /* ==== 필사 상태 ==== */
  const [round, setRound] = useState(1);
  const [typed, setTyped] = useState(["", "", ""]);
  const [paused, setPaused] = useState(false);

  /* ==== 검색/선택 상태 ==== */
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState([]);       // 검색 결과 (최대 10개)
  const [selectedIdx, setSelectedIdx] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingArticle, setLoadingArticle] = useState(false);

  /* ==== 기사 & 표시 ==== */
  const [article, setArticle] = useState({
    title: "",
    source: "",
    content: "",   // 정리본(clean)
    plain: "",     // 라이트(plain)
    pubDate: ""    // RFC/ISO 문자열(있을 때만)
  });
  const [viewMode, setViewMode] = useState("clean"); // 'clean' | 'plain'
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState("");

  // 헤더 높이 동기화 refs
  const headerLeftRef  = useRef(null);
  const headerRightRef = useRef(null);

  // 좌측 기사 스크롤 ref
  const leftRef = useRef(null);

  // 오른쪽 입력 textarea ref
  const typingRef = useRef(null);

  // 좌측 기준 텍스트
  const text = (editMode ? draft : (viewMode === "clean" ? article.content : article.plain)) || "";
  const input = typed[round - 1] || "";

  // 정확도
  const accuracy = useMemo(() => {
    if (!input.length) return 100;
    let ok = 0;
    for (let i = 0; i < input.length; i++) if (input[i] === text[i]) ok++;
    return Number(((ok / input.length) * 100).toFixed(1));
  }, [input, text]);

  /* ==== 검색 ==== */
  const doSearch = async () => {
    if (!query.trim() || loading) return;
    setLoading(true);
    setHasSearched(false);
    setOptions([]);
    setSelectedIdx("");

    try {
      const r = await fetch(`/api/search-mixed?q=${encodeURIComponent(query.trim())}`);
      const data = await r.json();
      const items = Array.isArray(data.items) ? data.items : [];
      const opts = items.map((it, i) => ({
        idx: i,
        sourceType: it.sourceType, // 'google' | 'naver'
        title: it.title,
        snippet: it.snippet,
        link: it.link,
        displayLink: it.displayLink,
        pubDate: it.pubDate
      }));
      setOptions(opts);
    } finally {
      setHasSearched(true);
      setLoading(false);
    }
  };

  /* ==== 기사 선택 & 로드 ==== */
  const loadSelectedArticle = async (idxStr) => {
    setSelectedIdx(idxStr);
    const idx = Number(idxStr);
    if (Number.isNaN(idx)) return;
    const opt = options[idx];
    if (!opt) return;

    setLoadingArticle(true);
    try {
      const er = await fetch(`/api/extract?url=${encodeURIComponent(opt.link)}`);
      const ed = await er.json();

      setArticle({
        title: opt.title,
        source: `${opt.sourceType === "google" ? "Google" : "Naver"}/${(ed?.source || opt.displayLink || "").replace(/^www\./, "")}`,
        content: ed?.text || "",
        plain: ed?.plain || "",
        pubDate: opt.pubDate || ""
      });
      setViewMode(ed?.mode === "plain" ? "plain" : "clean");
      setEditMode(false);
      setDraft("");
      setRound(1);
      setTyped(["", "", ""]);
      setPaused(false);

      // 좌측 스크롤 맨 위로
      leftRef.current && (leftRef.current.scrollTop = 0);

      // 헤더 높이 동기화
      requestAnimationFrame(syncHeaderHeights);
    } finally {
      setLoadingArticle(false);
    }
  };

  /* ==== 입력 ==== */
  const onChangeTyping = (e) => {
    const value = e.target.value;
    setTyped((prev) => { const a = [...prev]; a[round - 1] = value; return a; });
  };

  const isFinished = input.trim() && text.trim() && input.trim() === text.trim();

  /* ==== 헤더 높이 동기화 ==== */
  const syncHeaderHeights = () => {
    const L = headerLeftRef.current;
    const R = headerRightRef.current;
    if (!L || !R) return;

    L.style.minHeight = "";
    R.style.minHeight = "";

    const lh = L.getBoundingClientRect().height;
    const rh = R.getBoundingClientRect().height;
    const max = Math.max(lh, rh);

    L.style.minHeight = `${max}px`;
    R.style.minHeight = `${max}px`;
  };

  useEffect(() => {
    requestAnimationFrame(syncHeaderHeights);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article.title, article.source, article.pubDate, viewMode, editMode, selectedIdx]);

  useEffect(() => {
    const onResize = () => requestAnimationFrame(syncHeaderHeights);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ==== UI ==== */
  return (
    <div className="container">
      {/* 상단 상태 바 */}
      <div className="status">
        <div className="left">필사 {round}회차</div>
        <div className="center">글자 수: {input.length} / {text.length}</div>
        <div className="right">정확도: {accuracy}%</div>
      </div>

      {/* 검색줄 */}
      <div className="toolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !loading) { e.preventDefault(); doSearch(); } }}
          disabled={loading}
          placeholder="키워드를 입력하세요 (예: 반도체, 금리, 전기차)"
          style={{ flex: 1, minWidth: 220 }}
        />
        <button onClick={doSearch} disabled={loading}>
          {loading ? "검색 중…" : "검색"}
        </button>
      </div>

      {/* 검색 결과 컨트롤 */}
      {options.length > 0 && (
        <div className="resultsBar">
          <label className="small" htmlFor="articleSelect">
            기사 선택(최대 {Math.min(10, options.length)}개):
          </label>

          <select
            id="articleSelect"
            value={selectedIdx}
            onChange={(e) => loadSelectedArticle(e.target.value)}
          >
            <option value="" disabled>— 선택하세요 —</option>
            {options.map((o) => (
              <option key={o.idx} value={o.idx}>
                [{o.sourceType === "google" ? "Google" : "Naver"}] {o.title}
              </option>
            ))}
          </select>

          <select
            value={viewMode}
            onChange={(e) => { setViewMode(e.target.value); setEditMode(false); setDraft(""); }}
            disabled={!article.content && !article.plain}
            title="불러오기 방식"
          >
            <option value="clean">정리본(클린)</option>
            <option value="plain">원문텍스트(라이트)</option>
          </select>

          <button
            onClick={() => {
              if (!editMode) {
                const base = (viewMode === "clean" ? article.content : article.plain) || "";
                setDraft(base);
                setEditMode(true);
              } else {
                setEditMode(false);
                setDraft("");
              }
            }}
            disabled={!article.content && !article.plain}
          >
            {editMode ? "편집 취소" : "편집 모드"}
          </button>
          {editMode && (
            <>
              <button
                onClick={() => {
                  if (viewMode === "clean") {
                    setArticle((a) => ({ ...a, content: draft }));
                  } else {
                    setArticle((a) => ({ ...a, plain: draft }));
                  }
                  setEditMode(false);
                }}
              >
                적용
              </button>
              <button onClick={() => { setEditMode(false); setDraft(""); }}>
                취소
              </button>
            </>
          )}
        </div>
      )}

      {loading && (
        <div className="loadingRow"><span className="spinner" aria-hidden="true" />구글·네이버에서 기사 가져오는 중…</div>
      )}
      {hasSearched && !loading && options.length === 0 && (
        <div className="loadingRow" style={{ paddingTop: 0 }}>
          <span style={{ color: "#6b7280", fontStyle: "italic" }}>
            뉴스 결과가 없습니다. 검색어를 바꾸거나 더 구체적으로 입력해 보세요.
          </span>
        </div>
      )}
      {loadingArticle && (
        <div className="loadingRow"><span className="spinner" aria-hidden="true" />선택한 기사 본문을 정리 중…</div>
      )}

      {/* 좌/우 */}
      <div className="grid">
        {/* 왼쪽: 기사 */}
        <div className="pane">
          <header ref={headerLeftRef}>
            {article.title || "기사 원문"}{" "}
            <span style={{ color: "#6b7280", fontWeight: 400 }}>
              · 출처: {article.source || "-"}
              {article.pubDate && (
                <> · 날짜: {new Date(article.pubDate).toLocaleDateString("ko-KR", { year:"numeric", month:"2-digit", day:"2-digit" })}</>
              )}
            </span>
          </header>

          <div className="scroll">
            <div ref={leftRef} className="articleView mono">
              {(!article.content && !article.plain) && (
                <div className="articleText">(검색 후 드롭다운에서 기사를 선택하세요)</div>
              )}

              {editMode ? (
                <textarea
                  className="typingInput mono"
                  spellCheck="false"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="여기서 직접 원문을 고칠 수 있어요."
                  style={{ position: "static", color: "#111827", caretColor: "#111827", overflow: "auto" }}
                />
              ) : (
                <div className="articleText">
                  {(article.content || article.plain)
                    ? (viewMode === "clean" ? article.content : article.plain)
                    : ""}
                </div>
              )}
              <div className="footer-gap-3" />
            </div>
          </div>

          <div className="info">
            하단 3줄 여백 유지 · 좌우 스크롤 동기화(필요 시 적용)
          </div>
        </div>

        {/* 오른쪽: 필사 입력(오버레이 하이라이트) */}
        <div className="pane">
          <header ref={headerRightRef}>필사 입력</header>

          <div className="scroll">
            <div className="typingBox">
              {/* ✅ 오버레이: 안내/하이라이트 */}
              <div className="typingOverlay">
                {text.length === 0 ? (
                  <span style={{ color: "#9ca3af" }}>
                    (검색 후 드롭다운에서 기사를 선택하세요)
                  </span>
                ) : input.length === 0 ? (
                  <span style={{ color: "#9ca3af" }}>
                    선택한 기사 원문을 그대로 타이핑하세요.
                  </span>
                ) : (
                  {/*
                  text.split("").map((ch, i) => {
                    const t = input[i];
                    if (t == null) {
                      return <span key={i} style={{ color: "#9ca3af" }}>{ch}</span>;
                    }
                    if (t === ch) {
                      return <span key={i}>{ch}</span>;
                    }
                    return <span key={i} style={{ color: "red" }}>{ch}</span>;
                  })
                    */}
                )}
              </div>

              {/* ✅ 실제 입력(문자 투명, 커서만 보임) */}
              <textarea
                ref={typingRef}
                className="typingInput"
                spellCheck="false"
                value={input}
                onChange={onChangeTyping}
                disabled={paused || round > MAX_ROUNDS || !(article.content || article.plain)}
                placeholder=""
              />
              <div className="footer-gap-3" />
            </div>
          </div>

          <div className="info">
            {!paused && isFinished && (
              <button onClick={() => setPaused(true)}>이 회차 완료 (멈춤)</button>
            )}
            {paused && round < MAX_ROUNDS && (
              <span className="actions">
                <span>복기 후</span>
                <button onClick={() => { setPaused(false); setRound(r => r + 1); }}>
                  다음 회차
                </button>
              </span>
            )}
            {paused && round === MAX_ROUNDS && (
              <span>3회차 완료! (워드 저장은 다음 단계에서)</span>
            )}
          </div>
        </div>
      </div>

      {/* 푸터 */}
      <footer className="footer">
        © 2025 Park Hyung-jo. All rights reserved.
      </footer>
    </div>
  );
}
