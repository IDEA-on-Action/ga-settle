/** 마감 화면(F-028) 공용 포맷 헬퍼 - 정산 Run/대사 화면에서 공유. */

export function krw(amount: number): string {
  return `₩${Math.round(amount).toLocaleString("ko-KR")}`;
}

export function signedKrw(amount: number): string {
  if (amount === 0) return "₩0";
  const sign = amount > 0 ? "+" : "-";
  return `${sign}₩${Math.abs(Math.round(amount)).toLocaleString("ko-KR")}`;
}

export function currentMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
