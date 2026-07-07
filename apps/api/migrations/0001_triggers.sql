-- F-002 · D1 트리거 (스키마로 표현 불가, 수동 유지)
-- 도메인 불변식 2(마감 이중 잠금) + 4(audit append-only) 의 DB 측 강제.
-- drizzle-kit generate 대상 아님 → 스키마 변경 시에도 이 파일은 별도 유지.

-- ── audit_logs append-only (불변식 4) ──────────────────────────
CREATE TRIGGER trg_audit_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER trg_audit_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only');
END;
--> statement-breakpoint

-- ── 마감 잠금: closed run 자체 (불변식 2) ──────────────────────
CREATE TRIGGER trg_run_closed_no_update
BEFORE UPDATE ON settlement_runs
WHEN OLD.status = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'settlement_run is closed');
END;
--> statement-breakpoint
CREATE TRIGGER trg_run_closed_no_delete
BEFORE DELETE ON settlement_runs
WHEN OLD.status = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'settlement_run is closed');
END;
--> statement-breakpoint

-- ── 마감 잠금: 종속 테이블 (settlement_lines) ──────────────────
CREATE TRIGGER trg_line_closed_no_insert
BEFORE INSERT ON settlement_lines
WHEN (SELECT status FROM settlement_runs WHERE id = NEW.run_id) = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'run is closed');
END;
--> statement-breakpoint
CREATE TRIGGER trg_line_closed_no_update
BEFORE UPDATE ON settlement_lines
WHEN (SELECT status FROM settlement_runs WHERE id = OLD.run_id) = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'run is closed');
END;
--> statement-breakpoint
CREATE TRIGGER trg_line_closed_no_delete
BEFORE DELETE ON settlement_lines
WHEN (SELECT status FROM settlement_runs WHERE id = OLD.run_id) = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'run is closed');
END;
--> statement-breakpoint

-- ── 마감 잠금: 종속 테이블 (reconciliations) ───────────────────
CREATE TRIGGER trg_recon_closed_no_insert
BEFORE INSERT ON reconciliations
WHEN (SELECT status FROM settlement_runs WHERE id = NEW.run_id) = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'run is closed');
END;
--> statement-breakpoint
CREATE TRIGGER trg_recon_closed_no_update
BEFORE UPDATE ON reconciliations
WHEN (SELECT status FROM settlement_runs WHERE id = OLD.run_id) = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'run is closed');
END;
--> statement-breakpoint
CREATE TRIGGER trg_recon_closed_no_delete
BEFORE DELETE ON reconciliations
WHEN (SELECT status FROM settlement_runs WHERE id = OLD.run_id) = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'run is closed');
END;
--> statement-breakpoint

-- ── 마감 잠금: 종속 테이블 (adjustments) ───────────────────────
CREATE TRIGGER trg_adj_closed_no_insert
BEFORE INSERT ON adjustments
WHEN (SELECT status FROM settlement_runs WHERE id = NEW.run_id) = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'run is closed');
END;
--> statement-breakpoint
CREATE TRIGGER trg_adj_closed_no_update
BEFORE UPDATE ON adjustments
WHEN (SELECT status FROM settlement_runs WHERE id = OLD.run_id) = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'run is closed');
END;
--> statement-breakpoint
CREATE TRIGGER trg_adj_closed_no_delete
BEFORE DELETE ON adjustments
WHEN (SELECT status FROM settlement_runs WHERE id = OLD.run_id) = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'run is closed');
END;
--> statement-breakpoint

-- ── 마감 잠금: 종속 테이블 (payslips) ──────────────────────────
CREATE TRIGGER trg_slip_closed_no_insert
BEFORE INSERT ON payslips
WHEN (SELECT status FROM settlement_runs WHERE id = NEW.run_id) = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'run is closed');
END;
--> statement-breakpoint
CREATE TRIGGER trg_slip_closed_no_update
BEFORE UPDATE ON payslips
WHEN (SELECT status FROM settlement_runs WHERE id = OLD.run_id) = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'run is closed');
END;
--> statement-breakpoint
CREATE TRIGGER trg_slip_closed_no_delete
BEFORE DELETE ON payslips
WHEN (SELECT status FROM settlement_runs WHERE id = OLD.run_id) = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'run is closed');
END;
