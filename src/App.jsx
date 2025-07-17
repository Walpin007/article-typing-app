import React, { useState, useRef } from "react";
import article from "./article";
import "./style.css";

function App() {
  const [input, setInput] = useState("");
  const [step] = useState(1);
  const leftRef = useRef();
  const rightRef = useRef();

  const handleInput = (e) => {
    setInput(e.target.value);
    if (rightRef.current && leftRef.current) {
      leftRef.current.scrollTop = rightRef.current.scrollTop;
    }
  };

  const correctCount = input.split("").filter((c, i) => c === article.content[i]).length;

  return (
    <div>
      <div className="status-bar">
        <span>필사 {step}회차</span>
        <span>글자 수: {input.length} / {article.content.length}</span>
        <span>정확도: {(correctCount / article.content.length * 100).toFixed(1)}%</span>
      </div>
      <div className="dual-pane">
        <pre className="article-text" ref={leftRef}>{article.content}</pre>
        <textarea
          ref={rightRef}
          className="typing-area"
          value={input}
          onChange={handleInput}
          spellCheck="false"
        />
      </div>
    </div>
  );
}

export default App;
