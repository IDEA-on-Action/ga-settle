import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { AppShell } from "./AppShell";

/**
 * 인증 가드 겸 레이아웃 라우트.
 * 미인증 시 /login으로 리다이렉트하고, 인증 시 AppShell(사이드바+헤더+Outlet)을 렌더링한다.
 */
export function ProtectedLayout() {
  const { isAuthenticated, auth } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // 임시 비번 로그인(mustChangePassword) → 변경 완료 전까지 앱 진입 차단 (F-027 대체 흐름)
  if (auth?.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  return <AppShell />;
}
