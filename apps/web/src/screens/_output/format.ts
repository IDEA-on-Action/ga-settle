/** 출력 화면(F-029) 공용 포맷 헬퍼. */

/** 원화 표기: ₩ + 천단위 콤마 (소수점은 반올림). */
export function formatWon(amount: number): string {
  return `₩${Math.round(amount).toLocaleString("ko-KR")}`;
}

/** 이름 첫 글자(아바타 이니셜). 빈 문자열이면 "?". */
export function initialOf(name: string): string {
  return name.trim().slice(0, 1) || "?";
}
