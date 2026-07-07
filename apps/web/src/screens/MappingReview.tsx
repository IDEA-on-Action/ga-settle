import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ApproveResponse, MappingResult, UploadDetail, UploadErrorRow } from "./_pipeline/types";
import { formatNumber, formatPercent, StatusBadge } from "./_pipeline/shared";

/**
 * AI 매핑 검토 (F-026): 컬럼 매핑 + 검증 카운트 + 오류 행 리포트 -> 승인(원장 커밋).
 * 업로드 화면에서 `?uploadId=` 링크로 진입하거나, Upload ID를 직접 입력해 조회한다.
 */
export default function MappingReview() {
  const [searchParams] = useSearchParams();
  const [uploadIdInput, setUploadIdInput] = useState(searchParams.get("uploadId") ?? "");
  const [uploadId, setUploadId] = useState(searchParams.get("uploadId") ?? "");
  const queryClient = useQueryClient();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUploadId(uploadIdInput.trim());
  }

  const uploadQuery = useQuery({
    queryKey: ["mr-upload", uploadId],
    queryFn: () => apiFetch<UploadDetail>(`/api/uploads/${uploadId}`),
    enabled: uploadId.length > 0,
    retry: false,
  });
  const mappingQuery = useQuery({
    queryKey: ["mr-mapping", uploadId],
    queryFn: () => apiFetch<MappingResult>(`/api/uploads/${uploadId}/mapping`),
    enabled: uploadId.length > 0,
    retry: false,
  });
  const errorsQuery = useQuery({
    queryKey: ["mr-errors", uploadId],
    queryFn: () => apiFetch<UploadErrorRow[]>(`/api/uploads/${uploadId}/errors`),
    enabled: uploadId.length > 0,
    retry: false,
  });

  const approveMutation = useMutation({
    mutationFn: () => apiFetch<ApproveResponse>(`/api/uploads/${uploadId}/approve`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mr-upload", uploadId] });
    },
  });

  const up = uploadQuery.data;
  const mapping = mappingQuery.data;
  const errors = errorsQuery.data ?? [];

  return (
    <div className="flex max-w-[1280px] flex-col gap-5">
      <Card>
        <CardContent className="pt-6">
          <form className="flex flex-wrap items-end gap-3" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mr-upload-id">Upload ID</Label>
              <Input
                id="mr-upload-id"
                value={uploadIdInput}
                onChange={(e) => setUploadIdInput(e.target.value)}
                placeholder="업로드 화면에서 발급된 uploadId"
                className="w-80"
              />
            </div>
            <Button type="submit">조회</Button>
          </form>
        </CardContent>
      </Card>

      {uploadQuery.error instanceof ApiError && <p className="text-sm text-axis-text-error">{uploadQuery.error.message}</p>}

      {up && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4 pt-6 text-sm">
            <span className="font-mono text-xs text-axis-text-tertiary">{up.id}</span>
            <StatusBadge status={up.status} />
            <span>원수사 {up.insurerId}</span>
            <span>정산월 {up.settlementMonth}</span>
            {up.templateVersionId && <Badge variant="info">TemplateVersion 연결됨</Badge>}
          </CardContent>
        </Card>
      )}

      {mapping && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex flex-col gap-1 pt-6">
              <div className="text-xs font-medium text-axis-text-tertiary">전체 행</div>
              <div className="text-xl font-bold tabular-nums">{formatNumber(mapping.rowCount ?? 0)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col gap-1 pt-6">
              <div className="text-xs font-medium text-axis-text-tertiary">정상 행</div>
              <div className="text-xl font-bold tabular-nums text-axis-text-success">{formatNumber(mapping.okCount ?? 0)}</div>
              <div className="text-xs text-axis-text-secondary">{mapping.rowCount ? formatPercent((mapping.okCount ?? 0) / mapping.rowCount) : "-"}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col gap-1 pt-6">
              <div className="text-xs font-medium text-axis-text-tertiary">오류 행</div>
              <div className="text-xl font-bold tabular-nums text-axis-text-error">{formatNumber(mapping.errorCount ?? 0)}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {mapping && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">컬럼 매핑 (columnMap)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>표준 필드</TableHead>
                  <TableHead className="text-right">원본 컬럼 인덱스</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(mapping.columnMap).map(([field, colIndex]) => (
                  <TableRow key={field}>
                    <TableCell className="font-mono text-xs font-medium text-axis-text-brand">{field}</TableCell>
                    <TableCell className="text-right tabular-nums">{colIndex}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {uploadId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              오류 행 리포트 {errors.length > 0 && <span className="font-normal text-axis-text-error">{errors.length}건</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20 text-right">행</TableHead>
                  <TableHead className="w-32">필드</TableHead>
                  <TableHead>사유</TableHead>
                  <TableHead>원본값</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {errors.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-axis-text-tertiary">
                      오류 행이 없어요.
                    </TableCell>
                  </TableRow>
                ) : (
                  errors.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-right font-mono tabular-nums">{row.rowNo}</TableCell>
                      <TableCell>
                        <Badge variant="error">{row.field}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{row.reason}</TableCell>
                      <TableCell className="font-mono text-xs text-axis-text-secondary">{row.rawValue ?? "-"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {up && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <p className="text-sm text-axis-text-secondary">
              {up.status === "review"
                ? "검토(review) 상태예요. 승인하면 원장(commission_records)에 커밋돼요."
                : `현재 상태(${up.status})에서는 승인할 수 없어요 (review 상태만 승인 가능).`}
            </p>
            <Button
              className="ml-auto"
              disabled={up.status !== "review" || approveMutation.isPending}
              onClick={() => approveMutation.mutate()}
            >
              {approveMutation.isPending ? "승인 중..." : "승인 → 원장 커밋"}
            </Button>
          </CardContent>
          {approveMutation.isError && (
            <CardContent className="pt-0 text-sm text-axis-text-error">
              {approveMutation.error instanceof ApiError ? approveMutation.error.message : "승인에 실패했어요"}
            </CardContent>
          )}
          {approveMutation.isSuccess && (
            <CardContent className="pt-0 text-sm text-axis-text-success">
              {approveMutation.data.committed}건 원장 커밋 완료 (status: {approveMutation.data.status})
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
