/**
 * @ga-settle/schema - D1(Drizzle) 스키마 단일 진실원천 (아키텍처 문서 §4)
 * F-002에서 완성. D1 전용 기능 금지 (PostgreSQL 전환 경로 유지).
 * 원칙: 역추적 불변식(upload_id+row_no), 마감 이중 잠금, 월 파티셔닝 컬럼.
 */
import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";

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
  // 역추적 불변식: 어떤 정산 숫자든 원본 파일 행까지 도달
  uploadId: text("upload_id").notNull().references(() => uploads.id),
  rowNo: integer("row_no").notNull(),
  settlementMonth: text("settlement_month").notNull(),
  insurerId: text("insurer_id").notNull(),
  contractNo: text("contract_no").notNull(),
  installment: integer("installment"),
  agentId: text("agent_id"),
  productName: text("product_name"),
  contractDate: text("contract_date"),
  premiumEnc: text("premium_enc"),        // 암호화 필드 (F-020)
  commissionEnc: text("commission_enc"),  // 암호화 필드 (F-020)
  clawbackEnc: text("clawback_enc"),
}, (t) => ({ idxCrMonth: index("idx_cr_month").on(t.settlementMonth, t.insurerId) }));

export const settlementRuns = sqliteTable("settlement_runs", {
  id: text("id").primaryKey(),
  settlementMonth: text("settlement_month").notNull(),
  status: text("status").notNull(), // draft|calculated|reconciled|adjusted|closed (단방향)
  snapshotR2Key: text("snapshot_r2_key"),
  closedAt: text("closed_at"),
  closedBy: text("closed_by"),
}, (t) => ({ uqRunMonth: uniqueIndex("uq_run_month").on(t.settlementMonth) }));

export const adjustments = sqliteTable("adjustments", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => settlementRuns.id),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  amountEnc: text("amount_enc").notNull(),
  reason: text("reason").notNull(),       // 필수 (도메인 불변식 4)
  createdBy: text("created_by").notNull(),
  approvedBy: text("approved_by"),        // 이중 승인 옵션
  createdAt: text("created_at").notNull(),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  summaryJson: text("summary_json"),
  ip: text("ip"),
  at: text("at").notNull(),
}); // append-only: UPDATE/DELETE 금지 (트리거)

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  refId: text("ref_id"),
  status: text("status").notNull(), // queued|running|done|failed
  progress: real("progress").notNull().default(0),
  message: text("message"),
  updatedAt: text("updated_at").notNull(),
});

// TODO(F-002): org_units, agents, agent_assignments(시점별 소속),
//   incentive_rules, family_flags, settlement_lines, reconciliations,
//   payslips, users/roles + D1 트리거 마이그레이션(마감 잠금, audit append-only)
