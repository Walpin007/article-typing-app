import { Link } from "react-router-dom";
import "./index.css";

export default function LoginPage() {
  return (
    <div className="loginPage">
      <div className="loginCard">
        <div className="loginLogo">
          기사 필사
        </div>

        <h1 className="loginTitle">
          필사 기록을 안전하게 저장해보세요.
        </h1>

        <p className="loginDescription">
          로그인하면 필사 기록과 누적 데이터를
          여러 기기에서 이어서 사용할 수 있습니다.
        </p>

        <button
          className="googleLoginButton"
          type="button"
          onClick={() => {
            // 추후 Supabase Google 로그인 연결
          }}
        >
          Google로 계속하기
        </button>

        <div className="loginDivider">
          <span />
          <p>또는</p>
          <span />
        </div>

        <div className="emailLogin">
          <label htmlFor="loginEmail">
            이메일
          </label>

          <input
            id="loginEmail"
            type="email"
            placeholder="example@email.com"
          />

          <button
            type="button"
            onClick={() => {
              // 추후 Supabase 이메일 로그인 연결
            }}
          >
            이메일로 계속하기
          </button>
        </div>

        <Link
          to="/"
          className="backToTyping"
        >
          ← 필사로 돌아가기
        </Link>
      </div>
    </div>
  );
}