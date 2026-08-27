import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import "./index.css";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleGoogleLogin = async () => {
    if (loading) return;

    setLoading(true);
    setErrorMessage("");

    try {
      const { error } =
        await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${window.location.origin}/`,
          },
        });

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error("Google 로그인 오류:", error);

      setErrorMessage(
        "Google 로그인 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요."
      );

      setLoading(false);
    }
  };

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
          onClick={handleGoogleLogin}
          disabled={loading}
        >
          {loading
            ? "Google 로그인 중..."
            : "Google로 계속하기"}
        </button>

        {errorMessage && (
          <p className="loginError">
            {errorMessage}
          </p>
        )}

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