/**
 * @ga-settle/schema - D1(Drizzle) 스키마 단일 진실원천 (아키텍처 문서 §4, 18 엔티티)
 * F-002 완성. D1 전용 기능 금지 (PostgreSQL 전환 경로 유지).
 * 원칙: 역추적 불변식(upload_id+row_no), 마감 이중 잠금(트리거는 migrations/0001), 월 파티셔닝 컬럼.
 * 암호화 필드는 `*Enc` 접미사 (F-020 AES-GCM). 인적정보/금액은 평문 저장 금지.
 */
import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// ── 원수사 / 양식 (F-005~F-007) ────────────────────────────────
export const insurers = sqliteTable("insurers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const templateVersions = sqliteTable("template_versions", {
  id: text("id").primaryKey(),
  insurerId: text("insurer_id").notNull().references(() => insurers.id),
  version: integer("version").notNull(),
  headerSignature: text("header_signature").notNull(), // 정규화 헤더 해시 (L0 캐시 키)
  columnMapJson: text("column_map_json").notNull(),    // { 마스터필드: 원본헤더 }
  validFrom: text("valid_from").notNull(),
  validTo: text("valid_to"),
}, (t) => ({ idxTvSig: index("idx_tv_sig").on(t.headerSignature) }));

// ── 업로드 / 파싱 (F-003, F-008) ───────────────────────────────
export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(),
  insurerId: text("insurer_id").notNull().references(() => insurers.id),
  templateVersionId: text("template_version_id"),
  r2Key: text("r2_key").notNull(),
  fileHash: text("file_hash").notNull(),               // 멱등 키
  status: text("status").notNull(),                    // queued|parsing|review|approved|rejected
  settlementMonth: text("settlement_month").notNull(), // YYYY-MM (월 파티셔닝)
  rowCount: integer("row_count"),
  okCount: integer("ok_count"),
  errorCount: integer("error_count"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => ({ uqUploadsHash: uniqueIndex("uq_uploads_hash").on(t.fileHash) }));

export const uploadErrors = sqliteTable("upload_errors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  uploadId: text("upload_id").notNull().references(() => uploads.id),
  rowNo: integer("row_no").notNull(),
  field: text("field").notNull(),
  reason: text("reason").notNull(),
  rawValue: text("raw_value"),
});

export const commissionRecords = sqliteTable("commission_records", {
  id: text("id").primaryKey(),
  // 역추적 불변식: 어떤 정산 숫자든 원본 파일 행까지 도달 (upload_id + row_no)
  uploadId: text("upload_id").notNull().references(() => uploads.id),
  rowNo: integer("row_no").notNull(),
  settlementMonth: text("settlement_month").notNull(),
  insurerId: text("insurer_id").notNull().references(() => insurers.id),
  contractNo: text("contract_no").notNull(),
  installment: integer("installment"),
  agentId: text("agent_id"),
  productName: text("product_name"),
  contractDate: text("contract_date"),
  premiumEnc: text("premium_enc"),        // 암호화 필드 (F-020)
  commissionEnc: text("commission_enc"),  // 암호화 필드 (F-020)
  clawbackEnc: text("clawback_enc"),
}, (t) => ({
  idxCrMonth: index("idx_cr_month").on(t.settlementMonth, t.insurerId),
  idxCrTrace: index("idx_cr_trace").on(t.uploadId, t.rowNo), // 역추적 조회
}));

// ── 조직 / 설계사 / 시점별 소속 (F-009) ─────────────────────────
export const orgUnits = sqliteTable("org_units", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),               // headquarters|division|team (본부>사업단>팀)
  parentId: text("parent_id"),                // self-ref (트리)
  createdAt: text("created_at").notNull(),
}, (t) => ({ idxOrgParent: index("idx_org_parent").on(t.parentId) }));

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),               // ERP 설계사 코드
  name: text("name").notNull(),
  birthDateEnc: text("birth_date_enc"),       // 인적정보 암호화 (가족계약 매칭 F-011)
  status: text("status").notNull(),           // active|inactive
  createdAt: text("created_at").notNull(),
}, (t) => ({ uqAgentCode: uniqueIndex("uq_agent_code").on(t.code) }));

// 시점별 소속 이력: 당월 정산은 [validFrom, validTo) 구간으로 당시 소속 복원 (FR-11)
export const agentAssignments = sqliteTable("agent_assignments", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id),
  orgUnitId: text("org_unit_id").notNull().references(() => orgUnits.id),
  validFrom: text("valid_from").notNull(),    // YYYY-MM-DD
  validTo: text("valid_to"),                  // null = 현재 소속
}, (t) => ({ idxAsgAgent: index("idx_asg_agent").on(t.agentId, t.validFrom) }));

// ── 시책 룰 / 가족계약 (F-010, F-011) ──────────────────────────
export const incentiveRules = sqliteTable("incentive_rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  conditionJson: text("condition_json").notNull(), // 기간/원수사/상품/조직/실적구간 (선언형)
  actionJson: text("action_json").notNull(),       // 지급률 | 고정액
  priority: integer("priority").notNull().default(0),
  validFrom: text("valid_from").notNull(),
  validTo: text("valid_to"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => ({ idxRulePriority: index("idx_rule_priority").on(t.active, t.priority) }));

// 시상정의 카탈로그 (F-044): 원수사가 준 시상 정의 원형(xlsx/OCR 출처)을 무손실 보관.
// incentive_rules(정산 엔진 운영 룰)와 분리 - 정의는 후보/참조, 확정 시 운영 룰로 파생.
// 현 incentive_rules condition이 담지 못하던 차원(납입기간·지급시점·채널·지점·조건)을 1급 컬럼으로.
export const incentivePlanDefinitions = sqliteTable("incentive_plan_definitions", {
  id: text("id").primaryKey(),
  insurerId: text("insurer_id").notNull().references(() => insurers.id),
  baseMonth: text("base_month").notNull(),        // 기준월 YYYYMM (예: 202605)
  lineType: text("line_type"),                    // 손생보: 생보|손보
  product: text("product").notNull(),             // 상품명(상품1[+상품2])
  payTerm: text("pay_term"),                       // 납입기간 (5년납 등)
  payTiming: text("pay_timing"),                   // 지급시점 (익월|13차월|15차월|구간|연속|가동)
  channel: text("channel"),                        // FC|법인
  branch: text("branch"),                          // 적용지점
  cond1: text("cond1"),
  cond2: text("cond2"),
  cond3: text("cond3"),
  rateType: text("rate_type").notNull(),           // rate(보험료×배수) | fixed(정액)
  rateValue: real("rate_value").notNull(),         // 적용률 또는 정액(원)
  note: text("note"),                              // 비고
  sourceType: text("source_type").notNull(),       // xlsx|ocr
  sourceRef: text("source_ref"),                   // 원본 파일명/업로드 참조
  planImageKey: text("plan_image_key"),            // OCR 원본 이미지 R2 키 (역추적, F-043)
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => ({ idxDefInsurerMonth: index("idx_def_insurer_month").on(t.insurerId, t.baseMonth) }));

// 가족계약 후보: 자동 확정 경로 없음 - 확정은 실무자(HITL)만 (F-011)
export const familyFlags = sqliteTable("family_flags", {
  id: text("id").primaryKey(),
  contractNo: text("contract_no").notNull(),
  agentId: text("agent_id").notNull().references(() => agents.id),
  matchedNameEnc: text("matched_name_enc"),   // 성명 매칭 근거 (마스킹/암호화)
  status: text("status").notNull(),           // candidate|confirmed|released
  confirmedBy: text("confirmed_by"),          // 실무자만 (자동 확정 금지)
  createdAt: text("created_at").notNull(),
}, (t) => ({ idxFamilyContract: index("idx_family_contract").on(t.contractNo) }));

// ── 정산 / 대사 / 보정 (F-013~F-016) ───────────────────────────
export const settlementRuns = sqliteTable("settlement_runs", {
  id: text("id").primaryKey(),
  settlementMonth: text("settlement_month").notNull(),
  status: text("status").notNull(), // draft|calculated|reconciled|adjusted|closed (단방향)
  snapshotR2Key: text("snapshot_r2_key"),
  closedAt: text("closed_at"),
  closedBy: text("closed_by"),
}, (t) => ({ uqRunMonth: uniqueIndex("uq_run_month").on(t.settlementMonth) }));

// 룰별 산출 분해 - 역추적: commission_record까지 연결 (FR-16)
export const settlementLines = sqliteTable("settlement_lines", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => settlementRuns.id),
  commissionRecordId: text("commission_record_id").notNull().references(() => commissionRecords.id),
  ruleId: text("rule_id").references(() => incentiveRules.id),
  agentId: text("agent_id").notNull().references(() => agents.id),
  orgUnitId: text("org_unit_id").notNull().references(() => orgUnits.id), // 당월 소속 스냅샷
  amountEnc: text("amount_enc").notNull(),
  breakdownJson: text("breakdown_json"),      // 룰 적용 근거 분해
  createdAt: text("created_at").notNull(),
}, (t) => ({ idxLineRun: index("idx_line_run").on(t.runId) }));

// 대사: 원수사 지급총액 vs 계산총액 (FR-17)
export const reconciliations = sqliteTable("reconciliations", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => settlementRuns.id),
  insurerId: text("insurer_id").notNull().references(() => insurers.id),
  insurerTotalEnc: text("insurer_total_enc").notNull(),
  calculatedTotalEnc: text("calculated_total_enc").notNull(),
  diffEnc: text("diff_enc").notNull(),
  status: text("status").notNull(),           // matched|diff|resolved
  createdAt: text("created_at").notNull(),
}, (t) => ({ idxReconRun: index("idx_recon_run").on(t.runId) }));

// 수동 보정: reason 필수(도메인 불변식 4), 이중 승인 옵션 (FR-19)
export const adjustments = sqliteTable("adjustments", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => settlementRuns.id),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  amountEnc: text("amount_enc").notNull(),
  reason: text("reason").notNull(),           // 필수 (도메인 불변식 4)
  createdBy: text("created_by").notNull(),
  approvedBy: text("approved_by"),            // 이중 승인 옵션
  createdAt: text("created_at").notNull(),
}, (t) => ({ idxAdjRun: index("idx_adj_run").on(t.runId) }));

// ── 출력물 (F-018) ─────────────────────────────────────────────
export const payslips = sqliteTable("payslips", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => settlementRuns.id),
  agentId: text("agent_id").notNull().references(() => agents.id),
  orgUnitId: text("org_unit_id").notNull().references(() => orgUnits.id),
  totalEnc: text("total_enc").notNull(),
  detailR2Key: text("detail_r2_key"),         // 설계사별 내역서 파일
  createdAt: text("created_at").notNull(),
}, (t) => ({ idxSlipRun: index("idx_slip_run").on(t.runId, t.agentId) }));

// ── 계정 / RBAC (F-017) · 감사 (F-015) · 잡 (F-003) ────────────
// roles는 별도 테이블 대신 role 컬럼으로 통합 (직책별 조직 스코프 권한)
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),               // admin|manager|staff|viewer
  orgUnitId: text("org_unit_id").references(() => orgUnits.id), // 권한 스코프 (null=전사)
  passwordHash: text("password_hash").notNull(),
  // 임시 비번(admin reset) 발급 시 true → 다음 로그인에서 비번 변경 강제(F-027 대체 흐름).
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
}, (t) => ({ uqUserEmail: uniqueIndex("uq_user_email").on(t.email) }));

// append-only: UPDATE/DELETE 금지 (migrations/0001 트리거). 모든 쓰기 동반 (불변식 4)
export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  summaryJson: text("summary_json"),
  ip: text("ip"),
  at: text("at").notNull(),
}, (t) => ({ idxAuditEntity: index("idx_audit_entity").on(t.entity, t.entityId) }));

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  refId: text("ref_id"),
  status: text("status").notNull(), // queued|running|done|failed
  progress: real("progress").notNull().default(0),
  message: text("message"),
  updatedAt: text("updated_at").notNull(),
});

// 이메일 OTP (F-027): 지정 도메인(@atasset.co.kr) 사용자의 일회용 코드 로그인.
// 코드는 해시 저장, 5분 만료, 5회 시도 제한. 검증 후 consumedAt 마킹.
export const otpCodes = sqliteTable("otp_codes", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (t) => ({ idxOtpEmail: index("idx_otp_email").on(t.email) }));
