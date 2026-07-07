import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FamilyContractInput } from "./types";

interface FamilyDetectFormProps {
  onDetect: (contracts: FamilyContractInput[]) => Promise<void>;
  isDetecting: boolean;
}

function emptyRow(): FamilyContractInput {
  return { contractNo: "", agentId: "", holderName: "", holderBirth: "" };
}

/**
 * 가족계약 후보 감지 입력 (F-011). POST /api/family/detect는 contracts[] 전체를 요청 본문으로
 * 받아 그 자리에서 매칭 후 candidate만 생성한다 - 원장에서 미확정 계약을 조회하는 API는 없어서
 * (SPEC 미정의) 실무자가 직접 계약자/설계사 정보를 입력해 감지를 돌리는 구조.
 */
export function FamilyDetectForm({ onDetect, isDetecting }: FamilyDetectFormProps) {
  const [rows, setRows] = useState<FamilyContractInput[]>([emptyRow()]);
  const [error, setError] = useState<string | null>(null);
  const [lastCount, setLastCount] = useState<number | null>(null);

  function updateRow(idx: number, patch: Partial<FamilyContractInput>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(idx: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  }

  async function handleDetect() {
    setError(null);
    setLastCount(null);
    const filled = rows.filter((r) => r.contractNo && r.agentId && r.holderName && r.holderBirth);
    if (filled.length === 0) {
      setError("계약번호/설계사ID/계약자명/생년월일을 모두 입력해야 감지를 실행할 수 있어요");
      return;
    }
    try {
      await onDetect(filled);
      setLastCount(filled.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "감지 실행에 실패했어요");
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-axis-border-default bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-axis-text-primary">감지 후보 생성 - 성명 + 생년월일 매칭</span>
        <span className="text-xs text-axis-text-tertiary">생년월일 없는 레코드는 오탐 방지를 위해 제외돼요</span>
      </div>

      <div className="flex flex-col gap-2">
        {rows.map((row, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">계약번호</Label>
              <Input
                value={row.contractNo}
                onChange={(e) => updateRow(idx, { contractNo: e.target.value })}
                placeholder="CT-0001"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">설계사 ID</Label>
              <Input
                value={row.agentId}
                onChange={(e) => updateRow(idx, { agentId: e.target.value })}
                placeholder="agent-001"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">계약자명</Label>
              <Input
                value={row.holderName}
                onChange={(e) => updateRow(idx, { holderName: e.target.value })}
                placeholder="홍길동"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">계약자 생년월일</Label>
              <Input
                type="date"
                value={row.holderBirth}
                onChange={(e) => updateRow(idx, { holderBirth: e.target.value })}
              />
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(idx)} aria-label="행 삭제">
              <Trash2 className="size-4 text-axis-text-error" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus className="size-4" />
          행 추가
        </Button>
        <Button type="button" onClick={handleDetect} disabled={isDetecting}>
          {isDetecting ? "감지 실행 중..." : "감지 실행"}
        </Button>
      </div>

      {error && <p className="text-sm text-axis-text-error">{error}</p>}
      {lastCount !== null && (
        <p className="text-sm text-axis-text-success">
          입력한 {lastCount}건 중 매칭된 후보가 아래 목록에 candidate 상태로 추가됐어요.
        </p>
      )}
    </div>
  );
}
