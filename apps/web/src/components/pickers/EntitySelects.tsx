import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useInsurers, useUploadsList, useRunsList, uploadLabel, runLabel } from "@/lib/pickers";

/**
 * 엔티티 선택기 (F-035~F-037): insurerId/uploadId/runId를 목록에서 고르게 한다.
 * 값(value)은 항상 id, 표시(label)는 사람이 알아볼 수 있는 이름/월/상태.
 */

interface BaseProps {
  value: string;
  onChange: (id: string) => void;
  id?: string;
  className?: string;
}

export function InsurerSelect({ value, onChange, id, className }: BaseProps) {
  const { data, isLoading } = useInsurers();
  const rows = data ?? [];
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={isLoading ? "불러오는 중..." : rows.length ? "원수사 선택" : "등록된 원수사 없음"} />
      </SelectTrigger>
      <SelectContent>
        {rows.map((i) => (
          <SelectItem key={i.id} value={i.id}>
            {i.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function UploadSelect({ value, onChange, id, className }: BaseProps) {
  const { data, isLoading } = useUploadsList();
  const rows = data ?? [];
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={isLoading ? "불러오는 중..." : rows.length ? "업로드 선택 (최근순)" : "업로드 없음"} />
      </SelectTrigger>
      <SelectContent>
        {rows.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {uploadLabel(u)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function RunSelect({ value, onChange, id, className }: BaseProps) {
  const { data, isLoading } = useRunsList();
  const rows = data ?? [];
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={isLoading ? "불러오는 중..." : rows.length ? "정산 Run 선택 (월)" : "정산 Run 없음"} />
      </SelectTrigger>
      <SelectContent>
        {rows.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {runLabel(r)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
