import type { Env } from "./types";

// 이메일 발송 (F-027). Resend HTTP API 사용. RESEND_API_KEY 미설정 시 미발송(dev/test).
// 반환: 실제 발송 성공 여부. 발송 실패해도 호출측 흐름은 계속(코드는 D1에 저장됨).
export async function sendEmail(env: Env, to: string, subject: string, html: string): Promise<boolean> {
  const key = env.RESEND_API_KEY;
  if (!key) {
    console.warn("RESEND_API_KEY 미설정 - 이메일 미발송 (dev)");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.OTP_FROM_EMAIL ?? "no-reply@atasset.co.kr", to, subject, html }),
    });
    if (!res.ok) console.error("이메일 발송 실패", res.status, await res.text().catch(() => ""));
    return res.ok;
  } catch (e) {
    console.error("이메일 발송 예외", e);
    return false;
  }
}

// OTP 코드 생성 (6자리, 암호학적 난수)
export function genOtpCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1000000;
  return String(n).padStart(6, "0");
}

export function otpEmailHtml(code: string): string {
  return `<div style="font-family:sans-serif;max-width:420px">
    <h2 style="margin:0 0 12px">ATA 로그인 인증 코드</h2>
    <p style="color:#444">아래 6자리 코드를 입력해 로그인하세요. 5분 내 유효합니다.</p>
    <div style="font-size:30px;font-weight:800;letter-spacing:8px;background:#f2f5fb;padding:16px;border-radius:10px;text-align:center">${code}</div>
    <p style="color:#999;font-size:12px;margin-top:14px">본인이 요청하지 않았다면 이 메일을 무시하세요.</p>
  </div>`;
}
