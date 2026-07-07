import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { AppShell } from "./AppShell";

/**
 * 인증 가드 겸 레이아웃 라우트.
 * 미인증 시 /login으로 리다이렉트하고, 인증 시 AppShell(사이드바+헤더+Outlet)을 렌더링한다.
 */
export function ProtectedLayout() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <AppShell />;
}
