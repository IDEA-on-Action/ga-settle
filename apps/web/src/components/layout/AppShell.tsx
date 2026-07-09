import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { Tour } from "@/components/help/Tour";

/**
 * 인증된 화면 공통 셸: 좌측 Sidebar + 상단 TopBar + <Outlet/>(화면 본문).
 * 화면 작업자는 이 파일을 건드릴 필요 없음 - screens/*.tsx 본문만 수정.
 */
export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-axis-surface-secondary text-axis-text-primary">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
      <Tour />
    </div>
  );
}
