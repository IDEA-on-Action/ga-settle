/**
 * 인증 정보 localStorage 저장소.
 * api.ts(fetch 래퍼)와 auth.tsx(AuthProvider)가 공유해서 사용한다.
 */

export interface StoredAuth {
  token: string;
  email: string;
  role: "admin" | "manager" | "staff" | "viewer";
  orgUnitId: string | null;
}

const STORAGE_KEY = "ga_settle_auth";

export function getStoredAuth(): StoredAuth | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

export function setStoredAuth(auth: StoredAuth): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

export function clearStoredAuth(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
