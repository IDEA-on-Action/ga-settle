import { NavLink } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { routeGroups, routes } from "@/routes";
import { cn } from "@/lib/utils";

/**
 * 앱 셸 좌측 네비게이션. routes.tsx registry를 그대로 소비하므로
 * 새 화면 추가는 routes.tsx 한 곳만 갱신하면 여기 자동 반영됨.
 */
export function Sidebar() {
  const { auth, logout } = useAuth();

  return (
    <aside className="flex w-[228px] flex-none flex-col border-r border-axis-border-default bg-axis-surface-default">
      <div className="flex items-center gap-2.5 border-b border-axis-border-default px-4 py-3.5">
        <div className="flex size-[30px] flex-none items-center justify-center rounded-md bg-axis-surface-inverse text-[15px] font-extrabold text-axis-text-inverse">
          G
        </div>
        <div className="flex flex-col gap-px">
          <div className="text-sm font-bold tracking-tight text-axis-text-primary">GA-Settle</div>
          <div className="text-[11px] text-axis-text-tertiary">수수료 · 시책 통합 정산</div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2.5">
        {routeGroups.map((group) => {
          const groupRoutes = routes.filter((r) => r.group === group.id);
          if (groupRoutes.length === 0) return null;
          return (
            <div key={group.id} className="flex flex-col gap-0.5">
              <div className="px-2.5 pb-1 pt-3 text-[10.5px] font-semibold tracking-[0.06em] text-axis-text-tertiary first:pt-1.5">
                {group.label}
              </div>
              {groupRoutes.map((route) => (
                <NavLink
                  key={route.path}
                  to={route.path}
                  data-tour={`nav-${route.path}`}
                  end={route.path === "/"}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-axis-text-secondary transition-colors hover:bg-axis-surface-secondary",
                      isActive && "bg-axis-surface-info text-axis-text-brand hover:bg-axis-surface-info",
                    )
                  }
                >
                  <route.icon className="size-[15px]" />
                  <span>{route.label}</span>
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="flex items-center gap-2.5 border-t border-axis-border-default px-3.5 py-3">
        <div className="flex size-[30px] flex-none items-center justify-center rounded-full bg-axis-color-blue-500 text-[11px] font-semibold text-white">
          {auth?.email?.slice(0, 2).toUpperCase() ?? "?"}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <div className="truncate text-[12.5px] font-semibold text-axis-text-primary">{auth?.email ?? "미로그인"}</div>
          <div className="truncate text-[11px] text-axis-text-tertiary">{auth?.role ?? "-"}</div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="flex-none text-[11px] font-medium text-axis-text-tertiary hover:text-axis-text-brand"
        >
          로그아웃
        </button>
      </div>
    </aside>
  );
}
