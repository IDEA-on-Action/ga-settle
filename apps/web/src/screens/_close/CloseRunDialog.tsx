import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface CloseResponse {
  runId: string;
  status: "closed";
  closedAt: string;
  snapshotR2Key: string;
  lines: number;
}

/** 월 마감 확인 다이얼로그 - 되돌릴 수 없음을 명시. 마감자는 로그인 사용자로 서버가 자동 기록(F-038). */
export function CloseRunDialog({ runId, closedByLabel, disabled }: { runId: string; closedByLabel: string; disabled: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const closeMutation = useMutation({
    mutationFn: () =>
      apiFetch<CloseResponse>(`/api/runs/${runId}/close`, { method: "POST" }),
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["run", runId] });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={disabled}>
          월 마감
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>월 마감 확정</DialogTitle>
          <DialogDescription>
            마감하면 스냅샷(run+lines+reconciliations)이 R2에 불변 보관되고, API 검사와 D1 트리거가 이중으로 모든 쓰기를 차단해요.
            되돌릴 수 없어요.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label className="text-xs text-axis-text-tertiary">마감 처리자</Label>
          <p className="mt-1 text-sm font-medium text-axis-text-primary">
            {closedByLabel} <span className="font-normal text-axis-text-tertiary">(로그인 사용자로 자동 기록)</span>
          </p>
        </div>
        {closeMutation.isError && (
          <p className="text-xs font-medium text-axis-text-error">
            {closeMutation.error instanceof ApiError ? closeMutation.error.message : "마감에 실패했어요"}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={closeMutation.isPending}>
            취소
          </Button>
          <Button variant="destructive" size="sm" onClick={() => closeMutation.mutate()} disabled={closeMutation.isPending}>
            {closeMutation.isPending ? "마감 처리 중..." : "마감 확정"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
