import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { tourSteps } from "@/content/guide";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 첫 로그인 후 1회 자동 실행되는 온보딩 투어 (F-034).
 * 의존성 없이 box-shadow 스포트라이트 + 위치 계산으로 동작한다.
 * 앵커(data-tour="...")가 있으면 해당 요소를 비추고, 없으면 화면 중앙 모달로 표시한다.
 */

const DONE_KEY = "ga-settle-tour-done-v1";
const RESTART_EVENT = "ga-settle-restart-tour";

/** 가이드 화면 등에서 투어를 다시 실행. */
export function restartTour() {
  try {
    localStorage.removeItem(DONE_KEY);
  } catch {
    /* 스토리지 불가 환경 무시 */
  }
  window.dispatchEvent(new Event(RESTART_EVENT));
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6; // 스포트라이트 여백

export function Tour() {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  // 최초 방문 자동 실행 + 재시작 이벤트 구독
  useEffect(() => {
    let done = true;
    try {
      done = localStorage.getItem(DONE_KEY) === "1";
    } catch {
      done = false;
    }
    if (!done) {
      setIndex(0);
      setActive(true);
    }
    const onRestart = () => {
      setIndex(0);
      setActive(true);
    };
    window.addEventListener(RESTART_EVENT, onRestart);
    return () => window.removeEventListener(RESTART_EVENT, onRestart);
  }, []);

  const step = active ? tourSteps[index] : undefined;

  const measure = useCallback(() => {
    if (!step?.anchor) {
      setRect(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step?.anchor]);

  useLayoutEffect(() => {
    if (!active) return;
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [active, measure]);

  const finish = useCallback(() => {
    try {
      localStorage.setItem(DONE_KEY, "1");
    } catch {
      /* 무시 */
    }
    setActive(false);
    setRect(null);
  }, []);

  if (!active || !step) return null;

  const isLast = index === tourSteps.length - 1;
  const isFirst = index === 0;

  // 툴팁 위치: 앵커가 있으면 우측 또는 하단, 없으면 화면 중앙.
  const tip = tooltipPosition(rect);

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="사용 안내 투어">
      {/* 스포트라이트(앵커 있을 때) 또는 전체 딤(중앙 모달) */}
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-axis-border-focus transition-all duration-200"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(9, 14, 26, 0.62)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(9,14,26,0.62)]" />
      )}

      {/* 툴팁 카드 */}
      <div
        className={cn(
          "absolute w-[300px] max-w-[calc(100vw-24px)] rounded-xl border border-axis-border-default bg-axis-surface-default p-4 shadow-xl",
        )}
        style={tip}
      >
        <div className="mb-1 text-[11px] font-semibold tracking-wide text-axis-text-tertiary">
          {index + 1} / {tourSteps.length}
        </div>
        <h3 className="text-sm font-bold text-axis-text-primary">{step.title}</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-axis-text-secondary">{step.body}</p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={finish}
            className="text-xs font-medium text-axis-text-tertiary hover:text-axis-text-secondary"
          >
            건너뛰기
          </button>
          <div className="flex gap-2">
            {!isFirst && (
              <Button variant="outline" size="sm" onClick={() => setIndex((i) => i - 1)}>
                이전
              </Button>
            )}
            {isLast ? (
              <Button size="sm" onClick={finish}>
                시작하기
              </Button>
            ) : (
              <Button size="sm" onClick={() => setIndex((i) => i + 1)}>
                다음
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 앵커 rect 기준 툴팁 위치 계산(뷰포트 클램프). rect 없으면 화면 중앙. */
function tooltipPosition(rect: Rect | null): React.CSSProperties {
  const W = 300;
  const margin = 12;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  if (!rect) {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  // 앵커가 화면 왼쪽 절반이면 오른쪽에, 아니면 아래쪽에 배치
  let left: number;
  let top: number;
  if (rect.left + rect.width / 2 < vw / 2) {
    left = rect.left + rect.width + margin;
    top = rect.top;
  } else {
    left = rect.left + rect.width - W;
    top = rect.top + rect.height + margin;
  }
  // 뷰포트 클램프
  left = Math.max(margin, Math.min(left, vw - W - margin));
  top = Math.max(margin, Math.min(top, vh - 200));
  return { top, left };
}
