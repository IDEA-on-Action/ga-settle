import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "../src/index";

// F-002 Acceptance: 실제 마이그레이션 SQL(0000 테이블 + 0001 트리거)을 인메모리 SQLite에
// 적용하고 Drizzle로 insert/select 왕복을 검증한다. D1과 동일한 SQLite 엔진.
const MIG = (f: string) => readFileSync(fileURLToPath(new URL(`../../../apps/api/migrations/${f}`, import.meta.url)), "utf8");

function freshDb(): BetterSQLite3Database<typeof schema> {
  const sqlite = new Database(":memory:");
  sqlite.exec(MIG("0000_rainy_rogue.sql")); // '--> statement-breakpoint' 은 SQL 주석이라 무시됨
  sqlite.exec(MIG("0001_triggers.sql"));
  return drizzle(sqlite, { schema });
}

describe("F-002 스키마 왕복", () => {
  let db: BetterSQLite3Database<typeof schema>;
  beforeEach(() => { db = freshDb(); });

  it("18개 테이블이 생성된다", () => {
    const rows = db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    );
    expect(rows.length).toBe(18);
  });

  it("commission_records 역추적 왕복 (upload_id + row_no), REQ-004", () => {
    db.insert(schema.insurers).values({ id: "ins1", name: "A생명", createdAt: "2026-07-07" }).run();
    db.insert(schema.uploads).values({
      id: "up1", insurerId: "ins1", r2Key: "r2/up1.xlsx", fileHash: "hash1",
      status: "approved", settlementMonth: "2026-07", createdBy: "u1", createdAt: "2026-07-07",
    }).run();
    db.insert(schema.commissionRecords).values({
      id: "cr1", uploadId: "up1", rowNo: 42, settlementMonth: "2026-07",
      insurerId: "ins1", contractNo: "C-100", commissionEnc: "enc(123)",
    }).run();

    // 정산 숫자 -> 원본 행: upload_id + row_no 로 도달
    const rec = db.select().from(schema.commissionRecords)
      .where(and(eq(schema.commissionRecords.uploadId, "up1"), eq(schema.commissionRecords.rowNo, 42)))
      .get();
    expect(rec?.id).toBe("cr1");
    expect(rec?.rowNo).toBe(42);

    // 2 join 으로 원본 파일까지 (역추적 불변식)
    const traced = db.select({ file: schema.uploads.r2Key })
      .from(schema.commissionRecords)
      .innerJoin(schema.uploads, eq(schema.commissionRecords.uploadId, schema.uploads.id))
      .where(eq(schema.commissionRecords.id, "cr1")).get();
    expect(traced?.file).toBe("r2/up1.xlsx");
  });

  it("마감 잠금: closed run UPDATE + 종속 INSERT 가 트리거로 거부된다 (불변식 2)", () => {
    db.insert(schema.settlementRuns).values({ id: "run1", settlementMonth: "2026-07", status: "draft" }).run();
    // draft -> closed 전환은 허용 (OLD.status != 'closed')
    db.update(schema.settlementRuns).set({ status: "closed", closedAt: "2026-07-07", closedBy: "admin" })
      .where(eq(schema.settlementRuns.id, "run1")).run();

    // 마감된 run 재수정 -> 거부
    expect(() =>
      db.update(schema.settlementRuns).set({ snapshotR2Key: "x" }).where(eq(schema.settlementRuns.id, "run1")).run(),
    ).toThrow(/closed/);

    // 마감된 run 에 정산 라인 신규 삽입 -> 거부
    db.insert(schema.insurers).values({ id: "ins1", name: "A", createdAt: "2026-07-07" }).run();
    db.insert(schema.uploads).values({ id: "up1", insurerId: "ins1", r2Key: "k", fileHash: "h", status: "approved", settlementMonth: "2026-07", createdBy: "u", createdAt: "2026-07-07" }).run();
    db.insert(schema.commissionRecords).values({ id: "cr1", uploadId: "up1", rowNo: 1, settlementMonth: "2026-07", insurerId: "ins1", contractNo: "C" }).run();
    db.insert(schema.orgUnits).values({ id: "o1", name: "팀1", kind: "team", createdAt: "2026-07-07" }).run();
    db.insert(schema.agents).values({ id: "a1", code: "A001", name: "홍길동", status: "active", createdAt: "2026-07-07" }).run();
    expect(() =>
      db.insert(schema.settlementLines).values({
        id: "l1", runId: "run1", commissionRecordId: "cr1", agentId: "a1", orgUnitId: "o1",
        amountEnc: "enc(1)", createdAt: "2026-07-07",
      }).run(),
    ).toThrow(/closed/);
  });

  it("audit_logs append-only: UPDATE/DELETE 가 거부된다 (불변식 4)", () => {
    db.insert(schema.auditLogs).values({ actor: "u1", action: "create", entity: "uploads", at: "2026-07-07" }).run();
    expect(() =>
      db.update(schema.auditLogs).set({ action: "tamper" }).where(eq(schema.auditLogs.actor, "u1")).run(),
    ).toThrow(/append-only/);
    expect(() =>
      db.delete(schema.auditLogs).where(eq(schema.auditLogs.actor, "u1")).run(),
    ).toThrow(/append-only/);
  });
});
