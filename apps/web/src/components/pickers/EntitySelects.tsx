import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import {
  useInsurers,
  useUploadsList,
  useRunsList,
  useAgents,
  useRunContracts,
  useDebounced,
  uploadLabel,
  runLabel,
  agentLabel,
  contractLabel,
} from "@/lib/pickers";
import { cn } from "@/lib/utils";

/**
 * 엔티티 선택기 (F-035~F-041) + 검색(F-042).
 * 값(value)은 항상 id/코드, 표시(label)는 사람이 알아볼 이름. 목록이 50개를 넘어도
 * 검색창(type-to-filter, 서버 ?q 연동)으로 도달할 수 있다. 무의존성 콤보박스(SearchableSelect).
 */

export interface Option {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  query: string;
  onQueryChange: (q: string) => void;
  loading?: boolean;
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
}

function SearchableSelect({
  value,
  onChange,
  options,
  query,
  onQueryChange,
  loading,
  placeholder,
  id,
  className,
  disabled,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // 선택된 값의 라벨은 검색으로 목록에서 사라져도 트리거에 보이도록 캐시한다.
  const labelCache = useRef<Record<string, string>>({});
  for (const o of options) labelCache.current[o.value] = o.label;
  const selectedLabel = value ? (labelCache.current[value] ?? value) : "";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={cn("truncate", !selectedLabel && "text-muted-foreground")}>{selectedLabel || placeholder}</span>
        <ChevronsUpDown className="size-4 flex-none opacity-50" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[220px] rounded-md border border-axis-border-default bg-axis-surface-default shadow-lg">
          <div className="flex items-center gap-2 border-b border-axis-border-default px-2.5 py-2">
            <Search className="size-3.5 flex-none text-axis-text-tertiary" />
            <input
              autoFocus
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="검색..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-axis-text-tertiary"
            />
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {loading ? (
              <div className="px-2.5 py-2 text-sm text-axis-text-tertiary">불러오는 중...</div>
            ) : options.length === 0 ? (
              <div className="px-2.5 py-2 text-sm text-axis-text-tertiary">결과가 없어요</div>
            ) : (
              options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                    onQueryChange("");
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm hover:bg-axis-surface-secondary",
                    o.value === value && "font-medium text-axis-text-brand",
                  )}
                >
                  <Check className={cn("size-3.5 flex-none", o.value === value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface BaseProps {
  value: string;
  onChange: (id: string) => void;
  id?: string;
  className?: string;
}

export function InsurerSelect({ value, onChange, id, className }: BaseProps) {
  const [query, setQuery] = useState("");
  const { data, isLoading } = useInsurers(useDebounced(query));
  const options = (data ?? []).map((i) => ({ value: i.id, label: i.name }));
  return (
    <SearchableSelect
      id={id}
      className={className}
      value={value}
      onChange={onChange}
      options={options}
      query={query}
      onQueryChange={setQuery}
      loading={isLoading}
      placeholder="원수사 선택"
    />
  );
}

export function UploadSelect({ value, onChange, id, className }: BaseProps) {
  const [query, setQuery] = useState("");
  const { data, isLoading } = useUploadsList(useDebounced(query));
  const options = (data ?? []).map((u) => ({ value: u.id, label: uploadLabel(u) }));
  return (
    <SearchableSelect
      id={id}
      className={className}
      value={value}
      onChange={onChange}
      options={options}
      query={query}
      onQueryChange={setQuery}
      loading={isLoading}
      placeholder="업로드 선택 (최근순)"
    />
  );
}

export function RunSelect({ value, onChange, id, className }: BaseProps) {
  const [query, setQuery] = useState("");
  const { data, isLoading } = useRunsList(useDebounced(query));
  const options = (data ?? []).map((r) => ({ value: r.id, label: runLabel(r) }));
  return (
    <SearchableSelect
      id={id}
      className={className}
      value={value}
      onChange={onChange}
      options={options}
      query={query}
      onQueryChange={setQuery}
      loading={isLoading}
      placeholder="정산 Run 선택 (월)"
    />
  );
}

export function AgentSelect({ value, onChange, id, className }: BaseProps) {
  const [query, setQuery] = useState("");
  const { data, isLoading } = useAgents(useDebounced(query));
  const options = (data ?? []).map((a) => ({ value: a.id, label: agentLabel(a) }));
  return (
    <SearchableSelect
      id={id}
      className={className}
      value={value}
      onChange={onChange}
      options={options}
      query={query}
      onQueryChange={setQuery}
      loading={isLoading}
      placeholder="설계사 선택"
    />
  );
}

/** 보정 대상 계약 선택기(F-041). runId가 있어야 해당 run의 계약을 불러온다. */
export function ContractSelect({ runId, value, onChange, id, className, disabled }: BaseProps & { runId: string; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const { data, isLoading } = useRunContracts(runId, useDebounced(query));
  const options = (data ?? []).map((cr) => ({ value: cr.contractNo, label: contractLabel(cr) }));
  return (
    <SearchableSelect
      id={id}
      className={className}
      value={value}
      onChange={onChange}
      options={options}
      query={query}
      onQueryChange={setQuery}
      loading={isLoading}
      disabled={disabled || !runId}
      placeholder={!runId ? "먼저 Run 선택" : "계약 선택"}
    />
  );
}
