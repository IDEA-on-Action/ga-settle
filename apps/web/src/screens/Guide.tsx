import { Link } from "react-router-dom";
import { Download, Printer, ArrowRight, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { guideSteps } from "@/content/guide";
import { restartTour } from "@/components/help/Tour";

/** 데모 사용 가이드 화면 (F-034). 전체 파이프라인 시나리오 + PDF 다운로드 + 화면 투어 재시작. */
export default function Guide() {
  return (
    <div className="mx-auto max-w-[880px]">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-axis-text-primary">GA-Settle 사용 가이드</h1>
          <p className="mt-1 text-sm text-axis-text-tertiary">
            원수사 엑셀 업로드부터 AI 매핑 · 시책 정산 · 대사 · 마감 · 감사 소명까지, 데모를 따라 하며 익히는 10단계예요.
          </p>
        </div>
        <div className="flex flex-none gap-2 print:hidden">
          <Button asChild variant="default" size="sm">
            <a href="/guide/ga-settle-guide.pdf" download="GA-Settle-사용가이드.pdf">
              <Download className="size-4" />
              PDF 내려받기
            </a>
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="size-4" />
            인쇄
          </Button>
          <Button variant="outline" size="sm" onClick={restartTour}>
            화면 투어 다시 보기
          </Button>
        </div>
      </div>

      <ol className="flex flex-col gap-4">
        {guideSteps.map((step) => (
          <li
            key={step.n}
            className="rounded-xl border border-axis-border-default bg-axis-surface-default p-5 shadow-sm"
          >
            <div className="flex items-start gap-3.5">
              <div className="flex size-8 flex-none items-center justify-center rounded-full bg-axis-surface-inverse text-sm font-bold text-axis-text-inverse">
                {step.n}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-axis-text-primary">{step.title}</h2>
                  {step.route && (
                    <Link
                      to={step.route}
                      className="inline-flex items-center gap-0.5 text-xs font-medium text-axis-text-brand hover:underline print:hidden"
                    >
                      화면 열기 <ArrowRight className="size-3" />
                    </Link>
                  )}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-axis-text-secondary">{step.intro}</p>

                <ul className="mt-3 flex flex-col gap-1.5">
                  {step.actions.map((action, i) => (
                    <li key={i} className="flex gap-2 text-sm text-axis-text-secondary">
                      <span className="flex-none font-semibold text-axis-text-brand">{i + 1}.</span>
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>

                {step.tips && step.tips.length > 0 && (
                  <div className="mt-3 rounded-lg bg-axis-surface-secondary px-3.5 py-2.5">
                    {step.tips.map((tip, i) => (
                      <div key={i} className="flex gap-2 text-[13px] text-axis-text-tertiary">
                        <Lightbulb className="size-3.5 flex-none translate-y-0.5 text-axis-text-warning" />
                        <span>{tip}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-6 text-center text-xs text-axis-text-tertiary print:hidden">
        더 궁금한 점은 각 화면 오른쪽 위 <span className="font-medium text-axis-text-secondary">도움말</span>에서 확인하거나, 담당자에게 문의해 주세요.
      </p>
    </div>
  );
}
