/**
 * 정산 파이프라인 화면(F-026) API 응답 타입.
 * apps/api/src/routes/{uploads,mapping,runs,stats}.ts 실 구현에서 그대로 추출 (추측 금지).
 */

// GET /api/uploads/:id (F-003)
export interface UploadDetail {
  id: string;
  insurerId: string;
  templateVersionId: string | null;
  r2Key: string;
  fileHash: string;
  status: "queued" | "parsing" | "review" | "approved" | "rejected" | string;
  settlementMonth: string;
  rowCount: number | null;
  okCount: number | null;
  errorCount: number | null;
  createdBy: string;
  createdAt: string;
}

// GET /api/jobs/:id (F-003)
export interface JobDetail {
  id: string;
  kind: string;
  refId: string | null;
  status: "queued" | "running" | "done" | "failed" | string;
  progress: number;
  message: string | null;
  updatedAt: string;
}

// POST /api/uploads 202 응답
export interface UploadAcceptedResponse {
  uploadId: string;
  jobId: string;
  status: string;
}

// POST /api/uploads 409 중복 응답
export interface UploadDuplicateBody {
  error: string;
  uploadId: string;
  duplicate: true;
}

// GET /api/uploads/:id/mapping (F-005/F-008)
export interface MappingResult {
  columnMap: Record<string, number>;
  rowCount: number | null;
  okCount: number | null;
  errorCount: number | null;
  templateVersionId: string | null;
}

// GET /api/uploads/:id/errors (F-008)
export interface UploadErrorRow {
  id: number;
  uploadId: string;
  rowNo: number;
  field: string;
  reason: string;
  rawValue: string | null;
}

// POST /api/uploads/:id/approve
export interface ApproveResponse {
  committed: number;
  status: string;
}

// POST /api/uploads/:id/mapping/confirm
export interface MappingConfirmResponse {
  templateVersionId: string;
  version: number;
  cached: boolean;
}

// GET /api/insurers/:id/templates
export interface TemplateVersionRow {
  id: string;
  version: number;
  headerSignature: string;
  columnMap: Record<string, number>;
  validFrom: string;
  validTo: string | null;
}

// GET /api/runs/:id
export interface RunDetail {
  id: string;
  settlementMonth: string;
  status: "draft" | "calculated" | "reconciled" | "adjusted" | "closed" | string;
  snapshotR2Key: string | null;
  closedAt: string | null;
  closedBy: string | null;
  lineCount: number;
  totalAmount: number;
}

// GET /api/runs/:id/reconciliation
export interface ReconciliationInsurerSummary {
  insurerId: string;
  insurerTotal: number;
  calculatedTotal: number;
  diff: number;
  status: "matched" | "diff";
}
export interface ReconciliationDiffContract {
  commissionRecordId: string;
  contractNo: string;
  insurerId: string;
  insurerAmount: number;
  calculatedAmount: number;
  diff: number;
}
export interface ReconciliationResult {
  runId: string;
  insurers: ReconciliationInsurerSummary[];
  diffContracts: ReconciliationDiffContract[];
}

// GET /api/stats/by-month
export interface StatsByMonth {
  byMonth: { month: string; total: number; count: number }[];
}

// GET /api/stats/by-insurer?month=
export interface StatsByInsurer {
  month: string;
  byInsurer: { insurerId: string; total: number; count: number }[];
}

// GET /api/stats/by-org?month=
export interface StatsByOrg {
  month: string;
  byOrg: { orgUnitId: string; total: number; count: number }[];
}
