import { useLocation } from "react-router-dom";
import { routes } from "@/routes";
import { HelpPanel } from "@/components/help/HelpPanel";

export function TopBar() {
  const location = useLocation();
  const current = routes.find((r) => r.path === location.pathname);

  return (
    <header className="flex h-[54px] flex-none items-center gap-3 border-b border-axis-border-default bg-axis-surface-default px-6">
      <div className="text-[15px] font-semibold tracking-tight text-axis-text-primary">
        {current?.label ?? "GA-Settle"}
      </div>
      {current?.subtitle && <div className="text-xs text-axis-text-tertiary">{current.subtitle}</div>}
      <div className="ml-auto flex-none">
        <HelpPanel />
      </div>
    </header>
  );
}
