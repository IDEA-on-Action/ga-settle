import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RuleCreateInput } from "./types";

interface RuleFormProps {
  onSubmit: (input: RuleCreateInput) => Promise<void>;
  onCancel: () => void;
  isSubmitting: boolean;
}

/**
 * 새 시책 룰 생성 폼. POST /api/rules(rulesRoutes ruleInput 스키마)와 1:1로 맞춤.
 * 수정 API는 없어서(설계상 create+soft-delete만) 생성 전용.
 */
export function RuleForm({ onSubmit, onCancel, isSubmitting }: RuleFormProps) {
  const [name, setName] = useState("");
  const [priority, setPriority] = useState("10");
  const [overlapPolicy, setOverlapPolicy] = useState<"exclusive" | "stack">("stack");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [insurerIds, setInsurerIds] = useState("");
  const [productPatterns, setProductPatterns] = useState("");
  const [orgUnitIds, setOrgUnitIds] = useState("");
  const [minPremium, setMinPremium] = useState("");
  const [maxPremium, setMaxPremium] = useState("");
  const [excludeFamilyContracts, setExcludeFamilyContracts] = useState(false);
  const [actionKind, setActionKind] = useState<"rate" | "fixed" | "tiered">("rate");
  const [ratePercent, setRatePercent] = useState("");
  const [fixedAmount, setFixedAmount] = useState("");
  // 구간시상(F-053): 실적 구간별 지급률
  const [tiers, setTiers] = useState<{ min: string; max: string; rate: string }[]>([{ min: "", max: "", rate: "" }]);
  // 등록 항목(F-053): 실적인정·환수(1·2차)·예외·브릿지
  const [performanceRecognition, setPerformanceRecognition] = useState("");
  const [clawbackYear1, setClawbackYear1] = useState("");
  const [clawbackYear2, setClawbackYear2] = useState("");
  const [exceptions, setExceptions] = useState("");
  const [bridge, setBridge] = useState("");
  const [error, setError] = useState<string | null>(null);

  function splitCsv(v: string): string[] | undefined {
    const list = v.split(",").map((s) => s.trim()).filter(Boolean);
    return list.length > 0 ? list : undefined;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !periodFrom || !periodTo) {
      setError("이름과 적용 기간(시작/종료)은 필수예요");
      return;
    }
    const priorityNum = Number(priority);
    if (!Number.isInteger(priorityNum)) {
      setError("priority는 정수여야 해요");
      return;
    }

    const min = minPremium.trim() ? Number(minPremium) : undefined;
    const max = maxPremium.trim() ? Number(maxPremium) : undefined;
    const performanceBand = min !== undefined || max !== undefined ? { minPremium: min, maxPremium: max } : undefined;

    let action: RuleCreateInput["action"];
    if (actionKind === "rate") {
      const rate = Number(ratePercent);
      if (!ratePercent.trim() || Number.isNaN(rate)) {
        setError("지급률(%)을 입력해 주세요");
        return;
      }
      action = { kind: "rate", rate: rate / 100 };
    } else if (actionKind === "fixed") {
      const amount = Number(fixedAmount);
      if (!fixedAmount.trim() || Number.isNaN(amount)) {
        setError("고정액을 입력해 주세요");
        return;
      }
      action = { kind: "fixed", amount };
    } else {
      // 구간시상: 유효 구간(rate 입력된 행)만 채택. 보험료 구간별 지급률(%).
      const parsed = tiers
        .filter((t) => t.rate.trim() && !Number.isNaN(Number(t.rate)))
        .map((t) => ({
          minPremium: t.min.trim() ? Number(t.min) : undefined,
          maxPremium: t.max.trim() ? Number(t.max) : undefined,
          rate: Number(t.rate) / 100,
        }));
      if (parsed.length === 0) {
        setError("구간시상은 최소 1개 구간(지급률)이 필요해요");
        return;
      }
      action = { kind: "tiered", tiers: parsed };
    }

    const termsObj = {
      performanceRecognition: performanceRecognition.trim() || undefined,
      clawbackYear1: clawbackYear1.trim() || undefined,
      clawbackYear2: clawbackYear2.trim() || undefined,
      exceptions: exceptions.trim() || undefined,
      bridge: bridge.trim() || undefined,
    };
    const hasTerms = Object.values(termsObj).some(Boolean);

    const input: RuleCreateInput = {
      name: name.trim(),
      priority: priorityNum,
      overlapPolicy,
      condition: {
        period: { from: periodFrom, to: periodTo },
        insurerIds: splitCsv(insurerIds),
        productPatterns: splitCsv(productPatterns),
        orgUnitIds: splitCsv(orgUnitIds),
        performanceBand,
        excludeFamilyContracts: excludeFamilyContracts || undefined,
      },
      action,
      ...(hasTerms ? { terms: termsObj } : {}),
    };

    try {
      await onSubmit(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : "룰 생성에 실패했어요");
    }
  }

  return (
    <form className="flex flex-col gap-4 p-4" onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-name">룰 이름</Label>
          <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 6월 장기보장성 시책" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-priority">priority (낮을수록 우선)</Label>
          <Input id="rule-priority" type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-period-from">적용 시작일</Label>
          <Input id="rule-period-from" type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-period-to">적용 종료일</Label>
          <Input id="rule-period-to" type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>중복 정책 (overlapPolicy)</Label>
        <Select value={overlapPolicy} onValueChange={(v) => setOverlapPolicy(v as "exclusive" | "stack")}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stack">stack (누적 적용)</SelectItem>
            <SelectItem value="exclusive">exclusive (매칭 시 이후 룰 중단)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-insurers">원수사 ID (쉼표 구분)</Label>
          <Input id="rule-insurers" value={insurerIds} onChange={(e) => setInsurerIds(e.target.value)} placeholder="비우면 전 원수사" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-products">상품 패턴 (쉼표 구분)</Label>
          <Input id="rule-products" value={productPatterns} onChange={(e) => setProductPatterns(e.target.value)} placeholder="예: 장기,운전자" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-orgs">조직 ID (쉼표 구분)</Label>
          <Input id="rule-orgs" value={orgUnitIds} onChange={(e) => setOrgUnitIds(e.target.value)} placeholder="비우면 전 조직" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-min-premium">최소 보험료 (선택)</Label>
          <Input id="rule-min-premium" type="number" value={minPremium} onChange={(e) => setMinPremium(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-max-premium">최대 보험료 (선택)</Label>
          <Input id="rule-max-premium" type="number" value={maxPremium} onChange={(e) => setMaxPremium(e.target.value)} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-axis-text-secondary">
        <input
          type="checkbox"
          className="size-4 rounded border-input"
          checked={excludeFamilyContracts}
          onChange={(e) => setExcludeFamilyContracts(e.target.checked)}
        />
        가족계약 제외 (excludeFamilyContracts)
      </label>

      <div className="flex flex-col gap-2 rounded-md border border-axis-border-default p-3">
        <Label>액션</Label>
        <div className="flex items-center gap-3">
          <Select value={actionKind} onValueChange={(v) => setActionKind(v as "rate" | "fixed" | "tiered")}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rate">지급률 (%)</SelectItem>
              <SelectItem value="fixed">고정액 (원)</SelectItem>
              <SelectItem value="tiered">구간시상 (구간별 %)</SelectItem>
            </SelectContent>
          </Select>
          {actionKind === "rate" && (
            <Input type="number" step="0.1" value={ratePercent} onChange={(e) => setRatePercent(e.target.value)} placeholder="예: 12" className="w-32" />
          )}
          {actionKind === "fixed" && (
            <Input type="number" value={fixedAmount} onChange={(e) => setFixedAmount(e.target.value)} placeholder="예: 50000" className="w-32" />
          )}
        </div>
        {actionKind === "tiered" && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-[11px] font-semibold text-axis-text-tertiary">
              <span>최소 보험료</span><span>최대 보험료</span><span>지급률 (%)</span><span></span>
            </div>
            {tiers.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                <Input type="number" value={t.min} placeholder="비우면 하한없음"
                  onChange={(e) => setTiers((prev) => prev.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))} />
                <Input type="number" value={t.max} placeholder="비우면 상한없음"
                  onChange={(e) => setTiers((prev) => prev.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)))} />
                <Input type="number" step="0.1" value={t.rate} placeholder="예: 50"
                  onChange={(e) => setTiers((prev) => prev.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
                <Button type="button" variant="ghost" size="sm" disabled={tiers.length === 1}
                  onClick={() => setTiers((prev) => prev.filter((_, j) => j !== i))}>삭제</Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="self-start"
              onClick={() => setTiers((prev) => [...prev, { min: "", max: "", rate: "" }])}>구간 추가</Button>
          </div>
        )}
      </div>

      {/* F-053 등록 항목: 실적인정·환수(1·2차년도)·예외·브릿지 (선언형, 정산 자동계산 아닌 담당자 근거) */}
      <div className="flex flex-col gap-3 rounded-md border border-axis-border-default p-3">
        <Label>시책룰 등록 항목 (선택)</Label>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-axis-text-tertiary">실적인정기분</span>
          <Input value={performanceRecognition} onChange={(e) => setPerformanceRecognition(e.target.value)} placeholder="예: 당월 취소·철회 차감, 자기계약 제외" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-axis-text-tertiary">1차년도 환수기준</span>
            <Input value={clawbackYear1} onChange={(e) => setClawbackYear1(e.target.value)} placeholder="예: 1회100%/6회60%/12회10%" />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-axis-text-tertiary">2차년도(13회차+) 환수기준</span>
            <Input value={clawbackYear2} onChange={(e) => setClawbackYear2(e.target.value)} placeholder="예: 13회차 이후 환수율" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-axis-text-tertiary">예외적용</span>
            <Input value={exceptions} onChange={(e) => setExceptions(e.target.value)} placeholder="예: 금소법 위법계약 회차 불문 100%" />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-axis-text-tertiary">브릿지시상</span>
            <Input value={bridge} onChange={(e) => setBridge(e.target.value)} placeholder="예: 25·26회차 유지 시" />
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-axis-text-error">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          취소
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "생성 중..." : "룰 생성"}
        </Button>
      </div>
    </form>
  );
}
