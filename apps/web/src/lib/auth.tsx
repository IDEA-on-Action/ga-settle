import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { apiFetch } from "./api";
import { clearStoredAuth, getStoredAuth, setStoredAuth, type StoredAuth } from "./auth-storage";

interface LoginResponse {
  token: string;
  role: StoredAuth["role"];
  orgUnitId: string | null;
}

interface OtpRequestResponse {
  sent: boolean;
  ttlSeconds: number;
  /** 비-프로덕션에서만 서버가 내려주는 테스트용 코드 (F-027) */
  devCode?: string;
}

interface AuthContextValue {
  auth: StoredAuth | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** @도메인 계정(F-027): 이메일로 6자리 OTP 코드 발송 요청 */
  requestOtp: (email: string) => Promise<OtpRequestResponse>;
  /** @도메인 계정(F-027): OTP 코드 검증 → 세션 토큰 발급 */
  verifyOtp: (email: string, code: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(() => getStoredAuth());

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      skipAuth: true,
    });
    const next: StoredAuth = { token: res.token, role: res.role, orgUnitId: res.orgUnitId, email };
    setStoredAuth(next);
    setAuth(next);
  }, []);

  const requestOtp = useCallback(async (email: string) => {
    return await apiFetch<OtpRequestResponse>("/api/auth/otp/request", {
      method: "POST",
      body: JSON.stringify({ email }),
      skipAuth: true,
    });
  }, []);

  const verifyOtp = useCallback(async (email: string, code: string) => {
    const res = await apiFetch<LoginResponse>("/api/auth/otp/verify", {
      method: "POST",
      body: JSON.stringify({ email, code }),
      skipAuth: true,
    });
    const next: StoredAuth = { token: res.token, role: res.role, orgUnitId: res.orgUnitId, email };
    setStoredAuth(next);
    setAuth(next);
  }, []);

  const logout = useCallback(() => {
    clearStoredAuth();
    setAuth(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ auth, isAuthenticated: auth !== null, login, requestOtp, verifyOtp, logout }),
    [auth, login, requestOtp, verifyOtp, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth는 AuthProvider 내부에서만 사용할 수 있어요");
  return ctx;
}
