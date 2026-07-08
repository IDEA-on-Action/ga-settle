import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// 서버 OTP_EMAIL_DOMAIN(F-027)과 일치. 이 도메인 계정은 비밀번호 대신 이메일 OTP로만 로그인한다.
// 서버가 최종 판정(비번 403 {otp:true})하므로, 드리프트 시에도 아래 handlePasswordLogin 폴백이 OTP로 전환한다.
const OTP_DOMAIN = "atasset.co.kr";

export default function Login() {
  const { login, requestOtp, verifyOtp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"credentials" | "otp">("credentials");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? "/";
  const isOtpEmail = email.trim().toLowerCase().endsWith(`@${OTP_DOMAIN}`);

  function goToApp() {
    navigate(from, { replace: true });
  }

  async function sendOtp() {
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await requestOtp(email.trim());
      setStep("otp");
      setNotice(`${email.trim()}로 6자리 인증 코드를 보냈어요. 5분 내 입력해주세요.`);
      // dev 환경: 서버가 devCode를 내려주면 자동 채움(테스트/개발 편의). 프로덕션은 undefined.
      if (res.devCode) setCode(res.devCode);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "코드 발송에 실패했어요");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePasswordLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
      goToApp();
    } catch (err) {
      // @도메인 계정이 비번 로그인 시도 → 서버 403 {otp:true} → OTP 모드로 전환(도메인 상수 드리프트 방어)
      if (err instanceof ApiError && err.status === 403 && (err.body as { otp?: boolean } | null)?.otp) {
        await sendOtp();
        return;
      }
      setError(err instanceof ApiError ? err.message : "로그인에 실패했어요");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleOtpRequest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await sendOtp();
  }

  async function handleOtpVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await verifyOtp(email.trim(), code);
      goToApp();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "코드 검증에 실패했어요");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-axis-surface-secondary p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-axis-surface-inverse text-lg font-extrabold text-axis-text-inverse">
            G
          </div>
          <CardTitle>GA-Settle</CardTitle>
          <CardDescription>수수료 · 시책 통합 정산에 로그인해요</CardDescription>
        </CardHeader>
        <CardContent>
          {step === "otp" ? (
            <form className="flex flex-col gap-4" onSubmit={handleOtpVerify}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="code">인증 코드</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="6자리 숫자"
                />
              </div>
              {notice && <p className="text-sm text-axis-text-secondary">{notice}</p>}
              {error && <p className="text-sm text-axis-text-error">{error}</p>}
              <Button type="submit" disabled={isSubmitting || code.length !== 6} className="mt-2">
                {isSubmitting ? "확인 중..." : "코드 확인 후 로그인"}
              </Button>
              <button
                type="button"
                className="text-sm text-axis-text-secondary underline"
                onClick={() => {
                  setStep("credentials");
                  setCode("");
                  setNotice(null);
                  setError(null);
                }}
              >
                이메일 다시 입력
              </button>
            </form>
          ) : isOtpEmail ? (
            <form className="flex flex-col gap-4" onSubmit={handleOtpRequest}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">이메일</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </div>
              <p className="text-sm text-axis-text-secondary">
                @{OTP_DOMAIN} 계정은 이메일 인증 코드로 로그인해요.
              </p>
              {error && <p className="text-sm text-axis-text-error">{error}</p>}
              <Button type="submit" disabled={isSubmitting} className="mt-2">
                {isSubmitting ? "발송 중..." : "인증 코드 받기"}
              </Button>
            </form>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={handlePasswordLogin}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">이메일</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">비밀번호</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-axis-text-error">{error}</p>}
              <Button type="submit" disabled={isSubmitting} className="mt-2">
                {isSubmitting ? "로그인 중..." : "로그인"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
