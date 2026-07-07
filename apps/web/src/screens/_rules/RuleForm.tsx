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
  const [actionKind, setActionKind] = useState<"rate" | "fixed">("rate");
  const [ratePercent, setRatePercent] = useState("");
  const [fixedAmount, setFixedAmount] = useState("");
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
    } else {
      const amount = Number(fixedAmount);
      if (!fixedAmount.trim() || Number.isNaN(amount)) {
        setError("고정액을 입력해 주세요");
        return;
      }
      action = { kind: "fixed", amount };
    }

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
          <Select value={actionKind} onValueChange={(v) => setActionKind(v as "rate" | "fixed")}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rate">지급률 (%)</SelectItem>
              <SelectItem value="fixed">고정액 (원)</SelectItem>
            </SelectContent>
          </Select>
          {actionKind === "rate" ? (
            <Input
              type="number"
              step="0.1"
              value={ratePercent}
              onChange={(e) => setRatePercent(e.target.value)}
              placeholder="예: 12"
              className="w-32"
            />
          ) : (
            <Input
              type="number"
              value={fixedAmount}
              onChange={(e) => setFixedAmount(e.target.value)}
              placeholder="예: 50000"
              className="w-32"
            />
          )}
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
