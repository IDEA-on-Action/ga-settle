import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MappingConfirmResponse, TemplateVersionRow } from "./_pipeline/types";

/**
 * 매핑 관리 (F-026): 원수사 매핑 버전 이력(TemplateVersion) + 매핑 확정.
 * API 제약: GET /api/insurers(목록) 엔드포인트가 없어 원수사 ID를 직접 입력한다.
 */
export default function MappingAdmin() {
  return (
    <div className="flex max-w-[1200px] flex-col gap-5">
      <TemplateHistoryCard />
      <MappingConfirmCard />
    </div>
  );
}

function TemplateHistoryCard() {
  const [insurerIdInput, setInsurerIdInput] = useState("");
  const [insurerId, setInsurerId] = useState("");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setInsurerId(insurerIdInput.trim());
  }

  const templatesQuery = useQuery({
    queryKey: ["insurer-templates", insurerId],
    queryFn: () => apiFetch<TemplateVersionRow[]>(`/api/insurers/${insurerId}/templates`),
    enabled: insurerId.length > 0,
    retry: false,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">원수사 매핑 버전 이력</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form className="flex flex-wrap items-end gap-3" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ma-insurer-id">원수사 ID</Label>
            <Input
              id="ma-insurer-id"
              value={insurerIdInput}
              onChange={(e) => setInsurerIdInput(e.target.value)}
              placeholder="사전 등록된 insurerId"
              className="w-64"
            />
          </div>
          <Button type="submit">조회</Button>
        </form>
        <p className="text-xs text-axis-text-tertiary">원수사 목록 조회 API가 아직 없어(GET /api/insurers 부재) ID를 직접 입력해요.</p>

        {templatesQuery.error instanceof ApiError && <p className="text-sm text-axis-text-error">{templatesQuery.error.message}</p>}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">버전</TableHead>
              <TableHead>헤더 시그니처</TableHead>
              <TableHead className="text-right">필드 수</TableHead>
              <TableHead>유효 시작</TableHead>
              <TableHead>유효 종료</TableHead>
              <TableHead>상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!templatesQuery.data || templatesQuery.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-axis-text-tertiary">
                  {insurerId ? "등록된 버전이 없어요." : "원수사 ID를 입력해 조회하세요."}
                </TableCell>
              </TableRow>
            ) : (
              templatesQuery.data.map((tv) => (
                <TableRow key={tv.id}>
                  <TableCell>
                    <Badge variant="secondary">v{tv.version}</Badge>
                  </TableCell>
                  <TableCell className="max-w-64 truncate font-mono text-xs text-axis-text-tertiary">{tv.headerSignature}</TableCell>
                  <TableCell className="text-right tabular-nums">{Object.keys(tv.columnMap).length}</TableCell>
                  <TableCell className="text-xs">{tv.validFrom}</TableCell>
                  <TableCell className="text-xs">{tv.validTo ?? "-"}</TableCell>
                  <TableCell>
                    <Badge variant={tv.validTo ? "secondary" : "success"}>{tv.validTo ? "만료" : "사용 중"}</Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function MappingConfirmCard() {
  const [uploadId, setUploadId] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [columnMapText, setColumnMapText] = useState('{\n  "계약번호": 0,\n  "보험료": 4,\n  "지급수수료": 5\n}');
  const [parseError, setParseError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const confirmMutation = useMutation({
    mutationFn: (body: { headers: string[]; columnMap: Record<string, number> }) =>
      apiFetch<MappingConfirmResponse>(`/api/uploads/${uploadId}/mapping/confirm`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurer-templates"] });
    },
  });

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setParseError(null);
    const headers = headersText
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    if (headers.length === 0) {
      setParseError("헤더를 콤마로 구분해 1개 이상 입력하세요");
      return;
    }
    let columnMap: Record<string, number>;
    try {
      columnMap = JSON.parse(columnMapText) as Record<string, number>;
    } catch {
      setParseError("columnMap JSON 파싱에 실패했어요");
      return;
    }
    confirmMutation.mutate({ headers, columnMap });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">매핑 확정 → TemplateVersion 저장</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ma-upload-id">Upload ID</Label>
            <Input id="ma-upload-id" value={uploadId} onChange={(e) => setUploadId(e.target.value)} placeholder="확정할 uploadId" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ma-headers">원본 헤더 (콤마 구분)</Label>
            <Input
              id="ma-headers"
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              placeholder="계약번호, 설계사코드, 상품명, 계약일, 보험료, 지급수수료"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ma-columnmap">columnMap (표준필드 → 원본 컬럼 인덱스, JSON)</Label>
            <Textarea id="ma-columnmap" value={columnMapText} onChange={(e) => setColumnMapText(e.target.value)} className="font-mono text-xs" rows={6} />
          </div>
          {parseError && <p className="text-sm text-axis-text-error">{parseError}</p>}
          {confirmMutation.isError && (
            <p className="text-sm text-axis-text-error">
              {confirmMutation.error instanceof ApiError ? confirmMutation.error.message : "매핑 확정에 실패했어요"}
            </p>
          )}
          {confirmMutation.isSuccess && (
            <p className="text-sm text-axis-text-success">
              TemplateVersion v{confirmMutation.data.version} {confirmMutation.data.cached ? "(기존 버전 재사용)" : "(신규 등록)"} - id: {confirmMutation.data.templateVersionId}
            </p>
          )}
          <Button type="submit" disabled={!uploadId || confirmMutation.isPending} className="self-start">
            {confirmMutation.isPending ? "확정 중..." : "매핑 확정"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
