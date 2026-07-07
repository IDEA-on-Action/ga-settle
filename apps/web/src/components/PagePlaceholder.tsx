interface PagePlaceholderProps {
  title: string;
  description?: string;
}

/**
 * 후속 화면 작업자가 실제 화면을 붙이기 전까지 사용하는 플레이스홀더.
 * screens/*.tsx에서만 사용하고, 이 파일 자체는 공용 컴포넌트라 화면 작업자가 편집할 필요는 없음.
 */
export function PagePlaceholder({ title, description }: PagePlaceholderProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-axis-border-secondary bg-card/60 p-16 text-center">
      <h2 className="text-lg font-semibold text-axis-text-primary">{title}</h2>
      {description && <p className="max-w-md text-sm text-axis-text-secondary">{description}</p>}
      <p className="mt-2 text-xs text-axis-text-tertiary">화면 구현 예정 (F-025 앱 셸 단계, 백엔드 API는 이미 준비됨)</p>
    </div>
  );
}
