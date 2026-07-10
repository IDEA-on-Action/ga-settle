import { clearStoredAuth, getStoredAuth } from "./auth-storage";

/**
 * apps/api(Hono) 호출용 fetch 래퍼.
 * - base URL: VITE_API_BASE 환경변수(없으면 상대경로 /api 그대로 사용)
 * - Authorization: Bearer <token> 자동 주입
 * - 401 응답 시 토큰 폐기 + /login 리다이렉트
 */

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.clone().json();
  } catch {
    return null;
  }
}

function messageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return fallback;
}

export interface ApiFetchOptions extends RequestInit {
  /** true면 Authorization 헤더를 붙이지 않음 (로그인 요청 등) */
  skipAuth?: boolean;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { skipAuth, headers: initHeaders, ...init } = options;
  const headers = new Headers(initHeaders);

  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (!skipAuth) {
    const auth = getStoredAuth();
    if (auth?.token) headers.set("Authorization", `Bearer ${auth.token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 401) {
    clearStoredAuth();
    const body = await safeJson(res);
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/app/login")) {
      window.location.assign("/app/login");
    }
    throw new ApiError(messageFromBody(body, "인증이 만료됐어요"), 401, body);
  }

  if (!res.ok) {
    const body = await safeJson(res);
    throw new ApiError(messageFromBody(body, `요청이 실패했어요 (${res.status})`), res.status, body);
  }

  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return undefined as T;
  return (await res.json()) as T;
}

/** 인증 헤더를 붙여 바이너리(이미지 등)를 Blob으로 받는다. <img> 태그는 Bearer를 못 붙이므로 blob→objectURL 용도. */
export async function apiFetchBlob(path: string): Promise<Blob> {
  const headers = new Headers();
  const auth = getStoredAuth();
  if (auth?.token) headers.set("Authorization", `Bearer ${auth.token}`);
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) throw new ApiError(messageFromBody(await safeJson(res), `로드 실패 (${res.status})`), res.status, null);
  return res.blob();
}
