import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind 클래스 병합 헬퍼 (shadcn/ui 표준). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
