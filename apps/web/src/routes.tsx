import type { ComponentType } from "react";
import {
  LayoutDashboard,
  Upload,
  Sparkles,
  Layers,
  SlidersHorizontal,
  ClipboardCheck,
  ShieldCheck,
  Users,
  CalendarCheck,
  GitCompare,
  Receipt,
  BarChart3,
  Building2,
  BookOpen,
  type LucideIcon,
} from "lucide-react";

import Dashboard from "./screens/Dashboard";
import UploadScreen from "./screens/Upload";
import MappingReview from "./screens/MappingReview";
import MappingAdmin from "./screens/MappingAdmin";
import Rules from "./screens/Rules";
import PlanDefinitions from "./screens/PlanDefinitions";
import Audit from "./screens/Audit";
import Family from "./screens/Family";
import Runs from "./screens/Runs";
import Reconciliation from "./screens/Reconciliation";
import Payslips from "./screens/Payslips";
import Stats from "./screens/Stats";
import Org from "./screens/Org";
import Guide from "./screens/Guide";

/**
 * 라우트 registry - 단일 등록 지점.
 * 사이드바 네비게이션과 <Routes>가 모두 이 배열을 소비한다.
 * 화면 작업자는 이 파일을 건드리지 말고 screens/*.tsx만 편집할 것.
 */

export type RouteGroupId = "pipeline" | "rules" | "closing" | "output" | "admin" | "help";

export interface RouteGroup {
  id: RouteGroupId;
  label: string;
}

export const routeGroups: RouteGroup[] = [
  { id: "pipeline", label: "정산 파이프라인" },
  { id: "rules", label: "룰 · 검증" },
  { id: "closing", label: "마감" },
  { id: "output", label: "출력" },
  { id: "admin", label: "관리" },
  { id: "help", label: "도움말" },
];

export interface RouteDef {
  path: string;
  label: string;
  subtitle: string;
  group: RouteGroupId;
  icon: LucideIcon;
  Component: ComponentType;
}

export const routes: RouteDef[] = [
  {
    path: "/",
    label: "대시보드",
    subtitle: "정산 사이클 현황",
    group: "pipeline",
    icon: LayoutDashboard,
    Component: Dashboard,
  },
  {
    path: "/upload",
    label: "업로드",
    subtitle: "원수사 엑셀 수집 · 검증 · 승인 커밋",
    group: "pipeline",
    icon: Upload,
    Component: UploadScreen,
  },
  {
    path: "/mapping-review",
    label: "AI 매핑 검토",
    subtitle: "L0 캐시 → L1 프로파일 → L2 AI → L3 정합성 → L4 등급",
    group: "pipeline",
    icon: Sparkles,
    Component: MappingReview,
  },
  {
    path: "/mapping-admin",
    label: "매핑 관리",
    subtitle: "TemplateVersion 버전 이력 · 헤더 시그니처 캐시",
    group: "pipeline",
    icon: Layers,
    Component: MappingAdmin,
  },
  {
    path: "/rules",
    label: "시책 룰",
    subtitle: "선언형 조건 · 액션 · 순수 평가기 · 시뮬레이션",
    group: "rules",
    icon: SlidersHorizontal,
    Component: Rules,
  },
  {
    path: "/plan-definitions",
    label: "시상정의 확정",
    subtitle: "원수사 시상정의 카탈로그 → 운영룰 확정(HITL)",
    group: "rules",
    icon: ClipboardCheck,
    Component: PlanDefinitions,
  },
  {
    path: "/family",
    label: "가족계약 HITL",
    subtitle: "후보 자동 생성, 확정은 실무자만",
    group: "rules",
    icon: Users,
    Component: Family,
  },
  {
    path: "/runs",
    label: "정산 Run",
    subtitle: "월 단위 계산 · 보정 · 마감(이중 잠금)",
    group: "closing",
    icon: CalendarCheck,
    Component: Runs,
  },
  {
    path: "/reconciliation",
    label: "대사 · 차액",
    subtitle: "원수사 보고액 vs 시스템 계산액",
    group: "closing",
    icon: GitCompare,
    Component: Reconciliation,
  },
  {
    path: "/payslips",
    label: "지급 내역서",
    subtitle: "설계사별 롤업 · 룰별 분해 · 이체 마스터",
    group: "output",
    icon: Receipt,
    Component: Payslips,
  },
  {
    path: "/stats",
    label: "통계",
    subtitle: "조직 · 원수사 · 기간별 집계",
    group: "output",
    icon: BarChart3,
    Component: Stats,
  },
  {
    path: "/org",
    label: "조직 · 계정",
    subtitle: "조직 트리 · ERP 동기화 · RBAC",
    group: "admin",
    icon: Building2,
    Component: Org,
  },
  {
    path: "/audit",
    label: "감사 소명",
    subtitle: "지급건 → 운영룰 → 시상정의 → 원본 시책안 역추적",
    group: "admin",
    icon: ShieldCheck,
    Component: Audit,
  },
  {
    path: "/guide",
    label: "사용 가이드",
    subtitle: "데모 사용법 · 전체 정산 파이프라인 안내",
    group: "help",
    icon: BookOpen,
    Component: Guide,
  },
];
