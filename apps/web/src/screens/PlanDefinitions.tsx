import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightCircle } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InsurerSelect } from "@/components/pickers/EntitySelects";
import { Pager } from "@/components/ui/pager";

/**
 * 시상정의 → 운영룰 확정 화면 (F-044, B-012).
 * 원수사가 준 시상정의 카탈로그(참조)를 담당자가 검토·선택해 정산 엔진 운영룰(incentive_rules)로 확정 승격.
 * 도메인 불변식 #3: 정의는 후보, 확정은 사람(HITL). 승격은 idempotent(rule-{defId}).
 */
interface DefRow {
  id: string;
  insurerName: string | null;
  baseMonth: string;
  lineType: string | null;
  product: string;
  payTiming: string | null;
  cond1: string | null;
  rateType: string;
  rateValue: number;
  sourceType: string;
  promoted: number;
}
interface DefList { items: DefRow[]; total: number }
interface PromoteResult { promoted: number; skipped: number; notFound: string[]; ruleIds: string[] }

const LIMIT = 50;
const fmtRate = (r: DefRow) => (r.rateType === "rate" ? `x${r.rateValue}` : `${r.rateValue.toLocaleString()}원`);

export default function PlanDefinitions() {
  const qc = useQueryClient();
  const [insurerId, setInsurerId] = useState("");
  const [month, setMonth] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);

  const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
  if (insurerId) params.set("insurerId", insurerId);
  if (month) params.set("month", month);
  if (q) params.set("q", q);

  const listQuery = useQuery({
    queryKey: ["plan-definitions", insurerId, month, q, offset],
    queryFn: () => apiFetch<DefList>(`/api/incentive-plan-definitions?${params.toString()}`),
  });
  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;

  const promote = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<PromoteResult>("/api/incentive-plan-definitions/promote", { method: "POST", body: JSON.stringify({ definitionIds: ids }) }),
    onSuccess: (r) => {
      setMsg(`운영룰 ${r.promoted}건 확정${r.skipped ? ` · 기승격 ${r.skipped}건 건너뜀` : ""}.`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["plan-definitions"] });
      qc.invalidateQueries({ queryKey: ["rules"] });
    },
    onError: (e) => setMsg(e instanceof ApiError ? e.message : "확정에 실패했어요"),
  });

  const selectable = items.filter((r) => !r.promoted).map((r) => r.id);
  const allSelected = selectable.length > 0 && selectable.every((id) => selected.has(id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allSelected) selectable.forEach((id) => n.delete(id));
      else selectable.forEach((id) => n.add(id));
      return n;
    });
  const onFilter = (fn: () => void) => {
    fn();
    setOffset(0);
    setSelected(new Set());
    setMsg(null);
  };

  return (
    <div className="max-w-[1280px]">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-axis-border-default py-3.5">
          <CardTitle className="text-sm">시상정의 → 운영룰 확정</CardTitle>
          <p className="mt-1 text-xs text-axis-text-tertiary">
            원수사가 준 시상정의(참조 카탈로그)를 검토·선택해 정산 엔진 운영룰로 확정합니다. 확정은 담당자만(HITL), 재확정은 자동 건너뜀.
          </p>
        </CardHeader>
        <CardContent className="p-4">
          {/* 필터 */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <InsurerSelect value={insurerId} onChange={(v) => onFilter(() => setInsurerId(v))} className="w-52" />
            <Input
              value={month}
              onChange={(e) => onFilter(() => setMonth(e.target.value.trim()))}
              placeholder="기준월 YYYYMM"
              className="w-36"
              inputMode="numeric"
            />
            <Input
              value={q}
              onChange={(e) => onFilter(() => setQ(e.target.value))}
              placeholder="상품·지급시점 검색"
              className="w-52"
            />
            <div className="ml-auto flex items-center gap-2">
              {msg && <span className="text-xs text-axis-text-secondary">{msg}</span>}
              <Button
                size="sm"
                disabled={selected.size === 0 || promote.isPending}
                onClick={() => promote.mutate([...selected])}
              >
                <ArrowRightCircle className="size-4" />
                운영룰로 확정 ({selected.size})
              </Button>
            </div>
          </div>

          {listQuery.isLoading && <p className="p-6 text-sm text-axis-text-tertiary">시상정의를 불러오는 중...</p>}
          {listQuery.isError && (
            <p className="p-6 text-sm text-axis-text-error">
              {listQuery.error instanceof ApiError ? listQuery.error.message : "목록을 불러오지 못했어요"}
            </p>
          )}
          {!listQuery.isLoading && !listQuery.isError && (
            <>
              <div className="overflow-x-auto rounded-md border border-axis-border-default">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-9">
                        <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="현재 페이지 전체 선택" />
                      </TableHead>
                      <TableHead>원수사</TableHead>
                      <TableHead>구분</TableHead>
                      <TableHead>상품</TableHead>
                      <TableHead>기준월</TableHead>
                      <TableHead>지급시점</TableHead>
                      <TableHead>시상유형</TableHead>
                      <TableHead className="text-right">지급</TableHead>
                      <TableHead>상태</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={9} className="py-6 text-center text-sm text-axis-text-tertiary">
                          조건에 맞는 시상정의가 없어요.
                        </TableCell>
                      </TableRow>
                    )}
                    {items.map((r) => (
                      <TableRow key={r.id} className={selected.has(r.id) ? "bg-axis-surface-secondary/40" : undefined}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selected.has(r.id)}
                            disabled={!!r.promoted}
                            onChange={() => toggle(r.id)}
                            aria-label={`${r.product} 선택`}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{r.insurerName ?? r.id}</TableCell>
                        <TableCell>{r.lineType ?? "-"}</TableCell>
                        <TableCell className="max-w-[280px] truncate" title={r.product}>{r.product}</TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">{r.baseMonth}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.payTiming ?? "-"}</TableCell>
                        <TableCell className="max-w-[180px] truncate" title={r.cond1 ?? ""}>{r.cond1 ?? "-"}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{fmtRate(r)}</TableCell>
                        <TableCell>
                          {r.promoted ? <Badge>운영룰</Badge> : <Badge variant="outline">후보</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-3">
                <Pager offset={offset} limit={LIMIT} total={total} onOffset={setOffset} />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
