import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FamilyFlag, FamilyStatus } from "./types";

const STATUS_LABEL: Record<FamilyStatus, string> = {
  candidate: "후보",
  confirmed: "확정 (실무자)",
  released: "해제됨",
};

const STATUS_CLASS: Record<FamilyStatus, string> = {
  candidate: "border-transparent bg-axis-badge-warning-bg text-axis-badge-warning-text",
  confirmed: "border-transparent bg-axis-badge-success-bg text-axis-badge-success-text",
  released: "border-transparent bg-axis-surface-tertiary text-axis-text-secondary",
};

interface FamilyTableProps {
  flags: FamilyFlag[];
  onConfirm: (id: string, confirmedBy: string) => void;
  onRelease: (id: string) => void;
  isConfirming: (id: string) => boolean;
  isReleasing: (id: string) => boolean;
}

/**
 * 가족계약 후보 목록 테이블. GET /api/family 결과를 그대로 렌더링.
 * matchedNameEnc는 AES-GCM 암호화 필드라(apps/api/src/db.ts encField, 도메인 불변식 5)
 * API 응답이 평문을 주지 않음. 클라이언트에서 복호화 불가라 잠금 표시만 함.
 */
export function FamilyTable({ flags, onConfirm, onRelease, isConfirming, isReleasing }: FamilyTableProps) {
  const [confirmedByDraft, setConfirmedByDraft] = useState<Record<string, string>>({});

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>계약번호</TableHead>
          <TableHead>설계사</TableHead>
          <TableHead>매칭 근거</TableHead>
          <TableHead>상태</TableHead>
          <TableHead>처리자</TableHead>
          <TableHead className="text-right">액션</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {flags.map((f) => (
          <TableRow key={f.id}>
            <TableCell className="font-medium">{f.contractNo}</TableCell>
            <TableCell>{f.agentId}</TableCell>
            <TableCell className="text-axis-text-secondary">
              <span className="inline-flex items-center gap-1 text-xs">
                <Lock className="size-3" />
                암호화 필드 (평문 미제공)
              </span>
            </TableCell>
            <TableCell>
              <Badge className={STATUS_CLASS[f.status]}>{STATUS_LABEL[f.status]}</Badge>
            </TableCell>
            <TableCell className="text-axis-text-secondary">{f.confirmedBy ?? "-"}</TableCell>
            <TableCell className="text-right">
              {f.status === "candidate" && (
                <div className="flex items-center justify-end gap-1.5">
                  <Input
                    value={confirmedByDraft[f.id] ?? ""}
                    onChange={(e) => setConfirmedByDraft((prev) => ({ ...prev, [f.id]: e.target.value }))}
                    placeholder="확정자 이름"
                    className="h-8 w-28 text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={isConfirming(f.id) || !(confirmedByDraft[f.id] ?? "").trim()}
                    onClick={() => onConfirm(f.id, (confirmedByDraft[f.id] ?? "").trim())}
                  >
                    확정
                  </Button>
                </div>
              )}
              {f.status === "confirmed" && (
                <Button type="button" size="sm" variant="outline" disabled={isReleasing(f.id)} onClick={() => onRelease(f.id)}>
                  해제
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
        {flags.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="py-6 text-center text-sm text-axis-text-tertiary">
              감지된 가족계약 후보가 없어요.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
