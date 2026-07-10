import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PLAN_CATEGORIES, type PlanCategoryCode } from "./planCategories";

interface RuleField {
  value: string | null;
  confidence: number;
}
interface PayoutRow {
  payTerm: string | null;
  payTiming: string | null;
  rate: string | null;
}
interface OcrResult {
  planId?: string;
  planImageKey: string;
  sha256: string;
  idempotentReuse: boolean;
  ocr: { avgConfidence: number; fieldCount: number };
  rule: Record<string, RuleField>;
  payoutRows?: PayoutRow[];
  lowConfidenceKeys: string[];
}

// ocr.ts StructuredRule 키 ↔ 화면 라벨.
const FIELD_LABELS: Record<string, string> = {
  insurer: "원수사",
  planType: "시책유형",
  period: "적용기간",
  targetProduct: "대상상품",
  payout: "지급방식/배수",
  retention: "유지조건",
};

const ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf";

/**
 * 시책안 문서(PDF/이미지) OCR 업로드 (F-046, 260710 데모 피드백 AI-2).
 * POST /api/incentive-plans/ocr → CLOVA OCR + Upstage 구조화 → 시책룰 필드 후보 + 저신뢰 표시.
 * 확정(시상정의 write)·운영룰 승격은 /plan-definitions에서 HITL로 이어진다(불변식 #3).
 */
export function IncentivePlanUpload() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<PlanCategoryCode | "">("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const ocrMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("파일을 선택하세요");
      if (!category) throw new Error("대분류를 선택하세요");
      const form = new FormData();
      form.append("image", file);
      form.append("category", category); // F-051 대분류 필수
      return apiFetch<OcrResult>("/api/incentive-plans/ocr", { method: "POST", body: form });
    },
    // OCR 실패도 업로드 즉시 대장에 기록되므로(F-048), 성공/실패 모두 등록 내역을 갱신한다.
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "OCR 처리에 실패했어요");
      qc.invalidateQueries({ queryKey: ["incentive-plans"] });
    },
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["incentive-plans"] });
    },
  });

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || !category) return;
    setError(null);
    ocrMutation.mutate();
  }

  const result = ocrMutation.data;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardContent className="pt-6">
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            {/* F-051: 4대 대분류 먼저 선택 후 업로드 */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-axis-text-secondary">대분류 <span className="text-axis-text-error">*</span></span>
              <div className="grid grid-cols-2 gap-1.5">
                {PLAN_CATEGORIES.map((cat) => (
                  <button
                    key={cat.code}
                    type="button"
                    onClick={() => setCategory(cat.code)}
                    className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                      category === cat.code
                        ? "border-axis-border-focus bg-axis-surface-info text-axis-text-info"
                        : "border-axis-border-secondary text-axis-text-secondary hover:bg-axis-surface-secondary/40"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-[1.5px] border-dashed border-axis-border-secondary p-8 text-center"
            >
              <div className="flex size-10 items-center justify-center rounded-full bg-axis-surface-info text-axis-icon-brand">
                <FileText size={18} />
              </div>
              <div className="text-sm font-semibold">{file ? file.name : "시책안 PDF·이미지를 선택하세요"}</div>
              <div className="text-xs text-axis-text-tertiary">
                PNG · JPG · WEBP · PDF (최대 8MB) - OCR로 시책룰 필드 후보 추출, R2 불변 보관
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  ocrMutation.reset();
                }}
              />
            </div>
            {error && (
              <div className="rounded-md border border-axis-border-error bg-axis-surface-error px-3 py-2 text-xs font-medium text-axis-text-error">
                {error}
              </div>
            )}
            <Button type="submit" disabled={!file || !category || ocrMutation.isPending} className="self-start">
              {ocrMutation.isPending ? "OCR 처리 중..." : "OCR로 시책룰 후보 추출"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {!result ? (
            <p className="text-sm text-axis-text-tertiary">
              시책안을 업로드하면 OCR이 시책룰 필드 후보를 추출해요. 저신뢰 필드는 담당자 확인 대상으로 표시돼요.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-axis-text-primary">
                추출된 시책룰 후보
                <span className="text-xs font-normal text-axis-text-tertiary">
                  OCR 평균 신뢰도 {(result.ocr.avgConfidence * 100).toFixed(1)}%{result.idempotentReuse ? " · 재사용" : ""}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {Object.entries(FIELD_LABELS).map(([key, label]) => {
                  const f = result.rule[key];
                  const low = result.lowConfidenceKeys.includes(key);
                  return (
                    <div key={key} className="flex items-center gap-2 text-xs">
                      <span className="w-24 shrink-0 text-axis-text-tertiary">{label}</span>
                      <span className={`flex-1 ${low ? "text-axis-text-error" : "text-axis-text-primary"}`}>{f?.value ?? "-"}</span>
                      {low && (
                        <span className="rounded bg-axis-surface-error px-1.5 py-0.5 text-[10px] font-semibold text-axis-text-error">확인</span>
                      )}
                    </div>
                  );
                })}
              </div>
              {result.payoutRows && result.payoutRows.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-axis-text-secondary">납입기간별 지급율</span>
                  <div className="overflow-hidden rounded-md border border-axis-border-default">
                    <div className="grid grid-cols-[1fr_1fr_1fr] bg-axis-surface-secondary/40 px-2 py-1 text-[10px] font-semibold text-axis-text-tertiary">
                      <span>납입기간</span>
                      <span>지급시점</span>
                      <span className="text-right">지급율</span>
                    </div>
                    {result.payoutRows.map((r, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1fr_1fr] border-t border-axis-border-default px-2 py-1 text-xs">
                        <span className="text-axis-text-secondary">{r.payTerm ?? "-"}</span>
                        <span className="text-axis-text-secondary">{r.payTiming ?? "-"}</span>
                        <span className="text-right font-medium text-axis-text-primary">{r.rate ?? "-"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <Link
                to="/plan-definitions"
                className="inline-flex w-fit items-center gap-1.5 rounded-md bg-axis-surface-info px-3 py-1.5 text-xs font-semibold text-axis-text-info hover:opacity-90"
              >
                시상정의로 확정하러 가기
              </Link>
              <p className="text-[11px] leading-relaxed text-axis-text-tertiary">
                추출값은 후보예요. 담당자가 시상정의로 확정한 뒤 운영룰로 승격하면 정산에 반영돼요 (HITL).
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
