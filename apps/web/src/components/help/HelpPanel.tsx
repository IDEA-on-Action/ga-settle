import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { HelpCircle, X } from "lucide-react";
import { screenHelp } from "@/content/guide";
import { cn } from "@/lib/utils";

/**
 * 화면별 인라인 도움말 (F-034). TopBar 우측에 '도움말' 버튼으로 붙고,
 * 현재 경로(useLocation)에 맞는 도움말을 팝오버로 보여준다.
 * data-tour="help-button" 앵커로 첫 방문 투어의 마지막 스텝이 이 버튼을 가리킨다.
 */
export function HelpPanel() {
  const location = useLocation();
  const help = screenHelp[location.pathname];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 경로가 바뀌면 닫기
  useEffect(() => setOpen(false), [location.pathname]);

  // 바깥 클릭 / ESC 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!help) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-tour="help-button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-axis-border-default px-2.5 py-1.5 text-xs font-medium text-axis-text-secondary transition-colors hover:bg-axis-surface-secondary",
          open && "bg-axis-surface-secondary",
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <HelpCircle className="size-3.5" />
        도움말
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[320px] rounded-xl border border-axis-border-default bg-axis-surface-default p-4 shadow-xl">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="text-[13px] font-semibold leading-snug text-axis-text-primary">{help.summary}</div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex-none text-axis-text-tertiary hover:text-axis-text-secondary"
              aria-label="닫기"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <ul className="flex flex-col gap-1.5">
            {help.points.map((point, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-axis-text-secondary">
                <span className="flex-none translate-y-1.5 size-1 rounded-full bg-axis-text-brand" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
