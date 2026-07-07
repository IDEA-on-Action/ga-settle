import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiFetch, ApiError } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatWon } from "./_output/format";

interface AggBucket {
  total: number;
  count: number;
}

interface ByOrgResponse {
  month: string;
  byOrg: (AggBucket & { orgUnitId: string })[];
}

interface ByInsurerResponse {
  month: string;
  byInsurer: (AggBucket & { insurerId: string })[];
}

interface ByMonthResponse {
  byMonth: (AggBucket & { month: string })[];
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

interface TooltipPayloadEntry {
  payload: { total: number; count: number };
}

function AggTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadEntry[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const { total, count } = payload[0]!.payload;
  return (
    <div className="rounded-md border border-axis-border-default bg-card px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold">{label}</div>
      <div className="mt-1 tabular-nums">{formatWon(total)}</div>
      <div className="text-axis-text-tertiary">{count}건</div>
    </div>
  );
}

function EmptyOrError({ isLoading, isError, error, empty }: { isLoading: boolean; isError: boolean; error: unknown; empty: boolean }) {
  if (isLoading) return <p className="py-10 text-center text-sm text-axis-text-tertiary">불러오는 중...</p>;
  if (isError) {
    return (
      <p className="py-10 text-center text-sm text-axis-text-error">
        {error instanceof ApiError ? error.message : "데이터를 불러오지 못했어요"}
      </p>
    );
  }
  if (empty) return <p className="py-10 text-center text-sm text-axis-text-tertiary">해당 월 데이터가 없어요.</p>;
  return null;
}

export default function Stats() {
  const [month, setMonth] = useState(currentMonth());

  const byOrgQuery = useQuery({
    queryKey: ["stats-by-org", month],
    queryFn: () => apiFetch<ByOrgResponse>(`/api/stats/by-org?month=${month}`),
    enabled: month.length > 0,
  });

  const byInsurerQuery = useQuery({
    queryKey: ["stats-by-insurer", month],
    queryFn: () => apiFetch<ByInsurerResponse>(`/api/stats/by-insurer?month=${month}`),
    enabled: month.length > 0,
  });

  const byMonthQuery = useQuery({
    queryKey: ["stats-by-month"],
    queryFn: () => apiFetch<ByMonthResponse>("/api/stats/by-month"),
  });

  const orgData = useMemo(
    () => (byOrgQuery.data?.byOrg ?? []).map((r) => ({ name: r.orgUnitId, total: r.total, count: r.count })),
    [byOrgQuery.data],
  );
  const insurerData = useMemo(
    () => (byInsurerQuery.data?.byInsurer ?? []).map((r) => ({ name: r.insurerId, total: r.total, count: r.count })),
    [byInsurerQuery.data],
  );
  const monthData = useMemo(
    () => (byMonthQuery.data?.byMonth ?? []).map((r) => ({ name: r.month, total: r.total, count: r.count })),
    [byMonthQuery.data],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-axis-text-primary">통계</h1>
          <p className="text-sm text-axis-text-secondary">조직 · 원수사 · 기간별 집계 (F-019)</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="stats-month">기준월</Label>
          <Input id="stats-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">조직별 지급액 · {month}</CardTitle>
            <CardDescription>settlement_lines 합산 (계산된 지급액)</CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyOrError
              isLoading={byOrgQuery.isLoading}
              isError={byOrgQuery.isError}
              error={byOrgQuery.error}
              empty={!byOrgQuery.isLoading && !byOrgQuery.isError && orgData.length === 0}
            />
            {orgData.length > 0 && (
              <ResponsiveContainer width="100%" height={Math.max(180, orgData.length * 44)}>
                <BarChart data={orgData} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--axis-border-default)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--axis-text-tertiary)" }} tickFormatter={(v: number) => v.toLocaleString()} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12, fill: "var(--axis-text-secondary)" }} />
                  <Tooltip content={<AggTooltip />} cursor={{ fill: "var(--axis-surface-secondary)" }} />
                  <Bar dataKey="total" fill="var(--axis-color-blue-500)" radius={[0, 4, 4, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">원수사별 보고액 · {month}</CardTitle>
            <CardDescription>commission_records 합산 (원수사 보고 원본)</CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyOrError
              isLoading={byInsurerQuery.isLoading}
              isError={byInsurerQuery.isError}
              error={byInsurerQuery.error}
              empty={!byInsurerQuery.isLoading && !byInsurerQuery.isError && insurerData.length === 0}
            />
            {insurerData.length > 0 && (
              <ResponsiveContainer width="100%" height={Math.max(180, insurerData.length * 44)}>
                <BarChart data={insurerData} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--axis-border-default)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--axis-text-tertiary)" }} tickFormatter={(v: number) => v.toLocaleString()} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12, fill: "var(--axis-text-secondary)" }} />
                  <Tooltip content={<AggTooltip />} cursor={{ fill: "var(--axis-surface-secondary)" }} />
                  <Bar dataKey="total" fill="var(--axis-color-gray-600)" radius={[0, 4, 4, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">월별 지급 총액 추이</CardTitle>
          <CardDescription>settlement_lines 파생 집계 · 새 저장 없음 (모든 run 기준)</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyOrError
            isLoading={byMonthQuery.isLoading}
            isError={byMonthQuery.isError}
            error={byMonthQuery.error}
            empty={!byMonthQuery.isLoading && !byMonthQuery.isError && monthData.length === 0}
          />
          {monthData.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthData} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--axis-border-default)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--axis-text-tertiary)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--axis-text-tertiary)" }} tickFormatter={(v: number) => v.toLocaleString()} width={72} />
                <Tooltip content={<AggTooltip />} cursor={{ fill: "var(--axis-surface-secondary)" }} />
                <Bar dataKey="total" fill="var(--axis-color-blue-500)" radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
