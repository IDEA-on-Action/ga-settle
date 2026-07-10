import { useCallback, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, UploadCloud } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InsurerSelect } from "@/components/pickers/EntitySelects";
import { IncentivePlanUpload } from "./_pipeline/IncentivePlanUpload";
import { UploadHistory } from "./_pipeline/UploadHistory";
import type { JobDetail, UploadAcceptedResponse, UploadDetail, UploadDuplicateBody } from "./_pipeline/types";
import { currentMonth, formatNumber, ProgressBar, StatusBadge } from "./_pipeline/shared";

type UploadKind = "excel" | "plan";

/**
 * 업로드 (F-026): 엑셀 업로드 -> 파싱 진행률 폴링 -> 업로드 상태.
 * 원수사는 목록 드롭다운으로 선택(F-035). 최근 업로드 목록은 GET /api/uploads(F-036)로 조회 가능.
 */

interface SessionUpload {
  uploadId: string;
  jobId: string;
  fileName: string;
  insurerId: string;
  settlementMonth: string;
}

export default function UploadScreen() {
  const [kind, setKind] = useState<UploadKind>("excel");
  const [insurerId, setInsurerId] = useState("");
  const [settlementMonth, setSettlementMonth] = useState(currentMonth());
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sessionUploads, setSessionUploads] = useState<SessionUpload[]>([]);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("파일을 선택하세요");
      const form = new FormData();
      form.append("file", file);
      form.append("insurerId", insurerId);
      form.append("settlementMonth", settlementMonth);
      return apiFetch<UploadAcceptedResponse>("/api/uploads", { method: "POST", body: form });
    },
    onSuccess: (res) => {
      setDuplicateNotice(null);
      setSessionUploads((prev) => [
        { uploadId: res.uploadId, jobId: res.jobId, fileName: file?.name ?? "", insurerId, settlementMonth },
        ...prev,
      ]);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as UploadDuplicateBody | null;
        setDuplicateNotice(body?.uploadId ? `이미 업로드된 파일이에요 (uploadId: ${body.uploadId})` : err.message);
        return;
      }
      setDuplicateNotice(err instanceof ApiError ? err.message : "업로드에 실패했어요");
    },
  });

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || !insurerId.trim() || !settlementMonth.trim()) return;
    uploadMutation.mutate();
  }

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }, []);

  return (
    <div className="flex max-w-[1200px] flex-col gap-5">
      <div className="inline-flex w-fit rounded-lg border border-axis-border-default bg-axis-surface-secondary/40 p-1">
        <button
          type="button"
          onClick={() => setKind("excel")}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            kind === "excel" ? "bg-axis-surface-primary text-axis-text-primary shadow-sm" : "text-axis-text-tertiary"
          }`}
        >
          <FileSpreadsheet className="size-4" />
          지급명세 엑셀
        </button>
        <button
          type="button"
          onClick={() => setKind("plan")}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            kind === "plan" ? "bg-axis-surface-primary text-axis-text-primary shadow-sm" : "text-axis-text-tertiary"
          }`}
        >
          <FileText className="size-4" />
          시책안 문서 (OCR)
        </button>
      </div>

      {kind === "plan" && <IncentivePlanUpload />}

      {kind === "excel" && (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-[1.5px] border-dashed p-8 text-center transition-colors ${
                  isDragging ? "border-axis-border-focus bg-axis-surface-info" : "border-axis-border-secondary"
                }`}
              >
                <div className="flex size-10 items-center justify-center rounded-full bg-axis-surface-info text-axis-icon-brand">
                  <UploadCloud size={18} />
                </div>
                <div className="text-sm font-semibold">{file ? file.name : "원수사 엑셀 파일을 끌어다 놓으세요"}</div>
                <div className="text-xs text-axis-text-tertiary">xls · xlsx (최대 50MB) - SHA-256 해시로 중복 즉시 반려, R2 불변 보관</div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xls,.xlsx"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="insurerId">원수사</Label>
                  <InsurerSelect id="insurerId" value={insurerId} onChange={setInsurerId} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="settlementMonth">정산월</Label>
                  <Input
                    id="settlementMonth"
                    value={settlementMonth}
                    onChange={(e) => setSettlementMonth(e.target.value)}
                    placeholder="2026-06"
                    pattern="\d{4}-\d{2}"
                    required
                  />
                </div>
              </div>
              {duplicateNotice && (
                <div className="flex items-center gap-2 rounded-md border border-axis-border-error bg-axis-surface-error px-3 py-2 text-xs font-medium text-axis-text-error">
                  {duplicateNotice}
                </div>
              )}

              <Button type="submit" disabled={!file || uploadMutation.isPending} className="self-start">
                {uploadMutation.isPending ? "업로드 중..." : "업로드"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">이번 세션 업로드 · 파싱 진행률</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {sessionUploads.length === 0 ? (
              <p className="text-sm text-axis-text-tertiary">업로드하면 여기에 파싱 Job 진행률이 표시돼요.</p>
            ) : (
              sessionUploads.map((su) => <SessionUploadRow key={su.uploadId} upload={su} />)
            )}
          </CardContent>
        </Card>
      </div>
      )}

      {kind === "excel" && <UploadHistory />}
    </div>
  );
}

function SessionUploadRow({ upload }: { upload: SessionUpload }) {
  const queryClient = useQueryClient();
  const jobQuery = useQuery({
    queryKey: ["job", upload.jobId],
    queryFn: () => apiFetch<JobDetail>(`/api/jobs/${upload.jobId}`),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "done" || status === "failed" ? false : 1500;
    },
  });
  const uploadQuery = useQuery({
    queryKey: ["upload", upload.uploadId],
    queryFn: () => apiFetch<UploadDetail>(`/api/uploads/${upload.uploadId}`),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "review" || status === "approved" || status === "rejected" ? false : 2000;
    },
  });

  const job = jobQuery.data;
  const up = uploadQuery.data;
  const ratio = job ? job.progress : 0;

  return (
    <div className="overflow-hidden rounded-md border border-axis-border-default">
      <div className="flex items-center justify-between border-b border-axis-border-default px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-medium">{upload.fileName}</span>
          <span className="text-xs text-axis-text-tertiary">
            {upload.insurerId} · {upload.settlementMonth}
          </span>
        </div>
        {up && <StatusBadge status={up.status} />}
      </div>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <ProgressBar ratio={ratio} />
        <span className="w-20 text-right text-xs tabular-nums text-axis-text-secondary">
          {job ? `${Math.round(ratio * 100)}% · ${job.status}` : "..."}
        </span>
      </div>
      {job?.message && <div className="px-4 pb-2 text-xs text-axis-text-tertiary">{job.message}</div>}
      {up && (
        <div className="flex flex-wrap items-center gap-3 border-t border-axis-border-default px-4 py-2.5 text-xs text-axis-text-secondary">
          <span>행수 {formatNumber(up.rowCount ?? 0)}</span>
          <span>정상 {formatNumber(up.okCount ?? 0)}</span>
          <span className={up.errorCount ? "font-semibold text-axis-text-error" : ""}>오류 {formatNumber(up.errorCount ?? 0)}</span>
          {up.status === "review" && (
            <Link
              to={`/mapping-review?uploadId=${up.id}`}
              className="ml-auto font-medium text-axis-text-brand hover:underline"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["upload-detail", up.id] })}
            >
              매핑 검토 →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
