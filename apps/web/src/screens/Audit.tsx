import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, FileImage, FileSpreadsheet, ArrowDown } from "lucide-react";
import { apiFetch, apiFetchBlob, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { InsurerSelect } from "@/components/pickers/EntitySelects";

/**
 * 감사 소명 화면 (F-044, B-012). 금감원 감사 대응 역추적:
 * 지급건 → 실적원본(업로드·행) + 운영룰 → 시상정의 → 원본 시책안(이미지/xlsx).
 * 앵커는 시상정의(검색) 또는 id 직접(지급건/운영룰/시상정의).
 */
interface DefRow { id: string; insurerName: string | null; product: string; payTiming: string | null; baseMonth: string }
interface Trace {
  anchor: { lineId: string | null; ruleId: string | null; definitionId: string | null };
  line?: { id: string; amount: number; agentId: string };
  commissionRecord?: { id: string; uploadId: string; rowNo: number; contractNo: string; productName: string | null };
  upload?: { id: string; settlementMonth: string; r2Key: string };
  rule?: { id: string; name: string; action: { kind: string; rate?: number; amount?: number }; validFrom: string; validTo: string | null; active: boolean; createdBy: string };
  definition?: DefRow & {
    baseMonth: string; lineType: string | null; payTerm: string | null; channel: string | null; branch: string | null;
    cond1: string | null; cond2: string | null; cond3: string | null; rateType: string; rateValue: number;
    sourceType: string; sourceRef: string | null; planImageKey: string | null; createdBy: string; createdAt: string;
  };
  imageAvailable?: boolean;
  promotedRuleId?: string;
}

const fmtAction = (a?: { kind: string; rate?: number; amount?: number }) =>
  !a ? "-" : a.kind === "rate" ? `보험료 × ${a.rate}` : `정액 ${(a.amount ?? 0).toLocaleString()}원`;

function Step({ label, tone, children }: { label: string; tone?: "accent"; children: React.ReactNode }) {
  return (
    <div className="relative rounded-lg border border-axis-border-default bg-axis-surface-secondary/40 p-3">
      <div className={`mb-1.5 text-xs font-semibold ${tone === "accent" ? "text-axis-text-accent" : "text-axis-text-secondary"}`}>{label}</div>
      <div className="text-sm text-axis-text-primary">{children}</div>
    </div>
  );
}

export default function Audit() {
  const [anchorType, setAnchorType] = useState<"definitionId" | "ruleId" | "lineId">("definitionId");
  const [anchorId, setAnchorId] = useState("");
  const [queryId, setQueryId] = useState<{ type: string; id: string } | null>(null);
  const [insurerId, setInsurerId] = useState("");
  const [search, setSearch] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // 시상정의 검색(앵커 고르기)
  const pickParams = new URLSearchParams({ limit: "8" });
  if (insurerId) pickParams.set("insurerId", insurerId);
  if (search) pickParams.set("q", search);
  const pickQuery = useQuery({
    queryKey: ["audit-pick", insurerId, search],
    queryFn: () => apiFetch<{ items: DefRow[]; total: number }>(`/api/incentive-plan-definitions?${pickParams}`),
    enabled: !!insurerId || search.length >= 2,
  });

  // 트레이스
  const traceQuery = useQuery({
    queryKey: ["audit-trace", queryId?.type, queryId?.id],
    queryFn: () => apiFetch<Trace>(`/api/audit/incentive-trace?${queryId!.type}=${encodeURIComponent(queryId!.id)}`),
    enabled: !!queryId,
  });
  const trace = traceQuery.data;
  const defId = trace?.definition?.id;

  // 원본 이미지(인증 blob → objectURL)
  useEffect(() => {
    let revoked: string | null = null;
    if (trace?.imageAvailable && defId) {
      apiFetchBlob(`/api/incentive-plan-definitions/${encodeURIComponent(defId)}/image`)
        .then((b) => {
          const url = URL.createObjectURL(b);
          revoked = url;
          setImageUrl(url);
        })
        .catch(() => setImageUrl(null));
    } else {
      setImageUrl(null);
    }
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [trace?.imageAvailable, defId]);

  const runTrace = (type: string, id: string) => {
    if (id.trim()) setQueryId({ type, id: id.trim() });
  };

  return (
    <div className="grid max-w-[1280px] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      {/* 앵커 선택 */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-axis-border-default py-3.5">
          <CardTitle className="text-sm">감사 소명 · 역추적</CardTitle>
          <p className="mt-1 text-xs text-axis-text-tertiary">지급 건·운영룰·시상정의 어디서든 원본 시책안까지 되짚어 금감원 감사에 소명합니다.</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-4">
          <div>
            <div className="mb-1.5 text-xs font-semibold text-axis-text-secondary">id로 조회</div>
            <div className="flex gap-2">
              <select
                value={anchorType}
                onChange={(e) => setAnchorType(e.target.value as typeof anchorType)}
                className="h-9 rounded-md border border-axis-border-default bg-axis-surface-primary px-2 text-sm"
              >
                <option value="definitionId">시상정의</option>
                <option value="ruleId">운영룰</option>
                <option value="lineId">지급건</option>
              </select>
              <Input value={anchorId} onChange={(e) => setAnchorId(e.target.value)} placeholder="id 입력" className="flex-1" />
              <Button size="sm" onClick={() => runTrace(anchorType, anchorId)} disabled={!anchorId.trim()}>
                <Search className="size-4" /> 조회
              </Button>
            </div>
          </div>

          <div className="border-t border-axis-border-default pt-3">
            <div className="mb-1.5 text-xs font-semibold text-axis-text-secondary">또는 시상정의에서 찾기</div>
            <div className="flex gap-2">
              <InsurerSelect value={insurerId} onChange={setInsurerId} className="w-44" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="상품 검색(2자+)" className="flex-1" />
            </div>
            <div className="mt-2 flex flex-col gap-1">
              {pickQuery.data?.items.map((d) => (
                <button
                  key={d.id}
                  onClick={() => runTrace("definitionId", d.id)}
                  className="rounded-md border border-axis-border-default px-2.5 py-1.5 text-left text-xs hover:border-axis-border-accent"
                >
                  <span className="font-medium">{d.insurerName}</span> · {d.product.slice(0, 30)} · <span className="text-axis-text-tertiary">{d.baseMonth} {d.payTiming ?? ""}</span>
                </button>
              ))}
              {pickQuery.data && pickQuery.data.items.length === 0 && (
                <span className="text-xs text-axis-text-tertiary">검색 결과가 없어요.</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 역추적 체인 */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-axis-border-default py-3.5">
          <CardTitle className="text-sm">역추적 체인</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {!queryId && <p className="py-8 text-center text-sm text-axis-text-tertiary">왼쪽에서 앵커를 선택하면 원본까지의 근거 사슬이 나타나요.</p>}
          {traceQuery.isLoading && <p className="py-8 text-center text-sm text-axis-text-tertiary">역추적 중...</p>}
          {traceQuery.isError && (
            <p className="py-8 text-center text-sm text-axis-text-error">
              {traceQuery.error instanceof ApiError ? traceQuery.error.message : "역추적에 실패했어요"}
            </p>
          )}
          {trace && (
            <div className="flex flex-col gap-2">
              {trace.line && (
                <>
                  <Step label="① 지급 건" tone="accent">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <span>지급액 <b>{trace.line.amount.toLocaleString()}원</b></span>
                      <span className="text-axis-text-tertiary">설계사 {trace.line.agentId}</span>
                      <span className="text-axis-text-tertiary">line {trace.line.id}</span>
                    </div>
                  </Step>
                  <ArrowDown className="mx-auto size-4 text-axis-text-tertiary" />
                </>
              )}
              {trace.commissionRecord && (
                <>
                  <Step label="② 실적 원본 (역추적 불변식)">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <span>계약 <b>{trace.commissionRecord.contractNo}</b></span>
                      <span>{trace.commissionRecord.productName ?? "-"}</span>
                      <span className="text-axis-text-tertiary">업로드 {trace.commissionRecord.uploadId.slice(0, 8)}… · 행 {trace.commissionRecord.rowNo}</span>
                    </div>
                  </Step>
                  <ArrowDown className="mx-auto size-4 text-axis-text-tertiary" />
                </>
              )}
              {trace.rule && (
                <>
                  <Step label="③ 운영룰 (정산 적용)">
                    <div className="text-sm">{trace.rule.name}</div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-axis-text-tertiary">
                      <span>지급식 {fmtAction(trace.rule.action)}</span>
                      <span>유효 {trace.rule.validFrom} ~ {trace.rule.validTo ?? "무기한"}</span>
                      <span>확정 {trace.rule.createdBy}</span>
                    </div>
                  </Step>
                  <ArrowDown className="mx-auto size-4 text-axis-text-tertiary" />
                </>
              )}
              {!trace.rule && trace.promotedRuleId && (
                <p className="text-xs text-axis-text-tertiary">이 정의는 운영룰 <code>{trace.promotedRuleId}</code>로 승격됨.</p>
              )}
              {!trace.rule && !trace.promotedRuleId && trace.definition && (
                <p className="text-xs text-axis-text-tertiary">아직 운영룰로 승격되지 않은 정의예요(참조 카탈로그).</p>
              )}
              {trace.definition && (
                <>
                  <Step label="④ 시상정의 (원수사 제공)">
                    <div className="text-sm">
                      <b>{trace.definition.insurerName}</b> · {trace.definition.product}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-axis-text-tertiary">
                      <span>{trace.definition.baseMonth}</span>
                      {trace.definition.payTiming && <span>지급시점 {trace.definition.payTiming}</span>}
                      {trace.definition.payTerm && <span>납기 {trace.definition.payTerm}</span>}
                      {trace.definition.channel && <span>{trace.definition.channel}</span>}
                      {trace.definition.cond1 && <span>{trace.definition.cond1}</span>}
                      <span>{trace.definition.rateType === "rate" ? `x${trace.definition.rateValue}` : `${trace.definition.rateValue.toLocaleString()}원`}</span>
                    </div>
                  </Step>
                  <ArrowDown className="mx-auto size-4 text-axis-text-tertiary" />
                  <Step label="⑤ 원본 시책안 (지급 근거)">
                    {trace.definition.sourceType === "ocr" ? (
                      <div className="flex flex-col gap-2">
                        <Badge className="w-fit"><FileImage className="mr-1 size-3" /> OCR 원본 이미지</Badge>
                        {imageUrl ? (
                          <img src={imageUrl} alt="원본 시책안" className="max-h-[420px] w-auto rounded-md border border-axis-border-default" />
                        ) : (
                          <span className="text-xs text-axis-text-tertiary">이미지 불러오는 중…</span>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm">
                        <Badge variant="outline"><FileSpreadsheet className="mr-1 size-3" /> 엑셀 출처</Badge>
                        <span className="text-axis-text-secondary">{trace.definition.sourceRef ?? "원본 파일"}</span>
                      </div>
                    )}
                  </Step>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
