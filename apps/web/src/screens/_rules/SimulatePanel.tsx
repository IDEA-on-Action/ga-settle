import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch, ApiError } from "@/lib/api";
import type { IncentiveRule, SimulateResult } from "./types";

const SAMPLE_RECORDS = JSON.stringify(
  [
    {
      recordId: "rec-001",
      insurerId: "ins-001",
      productName: "장기보장성보험",
      orgUnitId: "org-001",
      agentId: "agent-001",
      contractDate: "2026-06-05",
      premium: 500000,
      isFamilyContract: false,
    },
    {
      recordId: "rec-002",
      insurerId: "ins-001",
      productName: "운전자보험",
      orgUnitId: "org-002",
      agentId: "agent-002",
      contractDate: "2026-06-10",
      premium: 120000,
      isFamilyContract: false,
    },
  ],
  null,
  2,
);

function fmtWon(n: number): string {
  return `₩${Math.round(n).toLocaleString()}`;
}

interface SimulatePanelProps {
  currentRules: IncentiveRule[];
}

/**
 * 룰 시뮬레이션 (F-012). POST /api/rules/simulate는 records + proposedRules를 그대로 받아
 * evaluate()를 2회(현재 활성 룰 vs 제안 룰) 실행한 diff만 반환 - DB 쓰기 없음(FR-15).
 * 화면에서 실 원장 레코드를 조회하는 API는 없어서(SPEC 미정의) 샘플 JSON을 직접 입력받는다.
 */
export function SimulatePanel({ currentRules }: SimulatePanelProps) {
  const [recordsText, setRecordsText] = useState(SAMPLE_RECORDS);
  const [proposedText, setProposedText] = useState("");
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  function loadCurrentRulesAsProposal() {
    setProposedText(JSON.stringify(currentRules, null, 2));
  }

  async function runSimulation() {
    setError(null);
    setResult(null);

    let records: unknown;
    let proposedRules: unknown;
    try {
      records = JSON.parse(recordsText);
    } catch {
      setError("레코드 JSON 형식이 올바르지 않아요");
      return;
    }
    try {
      proposedRules = proposedText.trim() ? JSON.parse(proposedText) : currentRules;
    } catch {
      setError("제안 룰 JSON 형식이 올바르지 않아요");
      return;
    }

    setIsRunning(true);
    try {
      const res = await apiFetch<SimulateResult>("/api/rules/simulate", {
        method: "POST",
        body: JSON.stringify({ records, proposedRules }),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "시뮬레이션 실행에 실패했어요");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-l-4 border-axis-border-default border-l-[var(--axis-color-blue-500)] bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-axis-text-primary">룰 시뮬레이션</span>
        <span className="text-xs text-axis-text-tertiary">실데이터 무영향 · DB 쓰기 0 (FR-15)</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sim-records">레코드 (JSON 배열, CommissionInput[])</Label>
        <Textarea
          id="sim-records"
          value={recordsText}
          onChange={(e) => setRecordsText(e.target.value)}
          className="min-h-[140px] font-mono text-xs"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="sim-proposed">제안 룰 (JSON 배열, IncentiveRule[])</Label>
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={loadCurrentRulesAsProposal}>
            현재 룰로 채우기
          </Button>
        </div>
        <Textarea
          id="sim-proposed"
          value={proposedText}
          onChange={(e) => setProposedText(e.target.value)}
          placeholder="비우면 현재 활성 룰과 동일하게 실행돼요"
          className="min-h-[140px] font-mono text-xs"
        />
      </div>

      <Button type="button" onClick={runSimulation} disabled={isRunning} className="self-end">
        {isRunning ? "evaluate() 2회 실행 중..." : "시뮬레이션 실행"}
      </Button>

      {error && <p className="text-sm text-axis-text-error">{error}</p>}

      {result && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-md bg-axis-surface-secondary p-3">
              <div className="text-xs text-axis-text-tertiary">현재 총액</div>
              <div className="text-sm font-bold tabular-nums">{fmtWon(result.totalCurrent)}</div>
            </div>
            <div className="rounded-md bg-axis-surface-secondary p-3">
              <div className="text-xs text-axis-text-tertiary">제안 총액</div>
              <div className="text-sm font-bold tabular-nums">{fmtWon(result.totalProposed)}</div>
            </div>
            <div className="rounded-md bg-axis-surface-info p-3">
              <div className="text-xs text-axis-text-tertiary">차액</div>
              <div className="text-sm font-bold tabular-nums text-axis-text-brand">{fmtWon(result.totalDiff)}</div>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>레코드 ID</TableHead>
                <TableHead className="text-right">현재</TableHead>
                <TableHead className="text-right">제안</TableHead>
                <TableHead className="text-right">diff</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.byRecord.map((r) => (
                <TableRow key={r.recordId}>
                  <TableCell className="font-mono text-xs">{r.recordId}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtWon(r.current)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtWon(r.proposed)}</TableCell>
                  <TableCell
                    className={`text-right font-semibold tabular-nums ${r.diff === 0 ? "text-axis-text-tertiary" : "text-axis-text-brand"}`}
                  >
                    {r.diff > 0 ? "+" : ""}
                    {fmtWon(r.diff)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-axis-text-tertiary">
            시뮬레이션 후 원본 run 데이터는 불변이에요 - 적용하려면 룰을 실제로 생성한 뒤 재계산하세요.
          </p>
        </div>
      )}
    </div>
  );
}
