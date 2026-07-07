import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { jobs, uploads, uploadErrors } from "@ga-settle/schema";
import { detectHeaderRow, profileColumns, validateRows, columnMapOf, type Cell } from "@ga-settle/mapping";
import { getDb, type Db } from "./db";
import { resolveTemplate } from "./routes/mapping";
import { resolveMapping } from "./llm";
import type { Env, ParseJob } from "./types";

export type { ParseJob }; // 기존 import 경로(./queue) 호환용 재노출

// XLSX 바이트 -> Grid(배열의 배열). 얇은 I/O 어댑터. workerd에서 SheetJS가 환경 편차가
// 있어 CI 테스트는 이 함수를 우회하고 프로덕션 스모크로 검증한다(F-008 Notes).
export function sheetToGrid(buf: ArrayBuffer): Cell[][] {
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]!];
  return XLSX.utils.sheet_to_json(sheet!, { header: 1, raw: true, defval: null }) as Cell[][];
}

/**
 * Grid -> L0 캐시/매핑 -> 행 검증 -> 오류 리포트 + 스테이징(R2 JSON) + 카운트.
 * 원장 미커밋(승인 전). 결정적 순수 파이프라인(테스트는 Grid 주입).
 */
export async function ingestParsed(
  env: Env, db: Db, ids: { uploadId: string; r2Key: string; insurerId: string }, grid: Cell[][],
): Promise<{ rowCount: number; okCount: number; errorCount: number }> {
  const { uploadId, r2Key, insurerId } = ids;
  const hIdx = detectHeaderRow(grid);
  const headers = (grid[hIdx] ?? []).map((h) => (h == null ? "" : String(h)));
  const { profiles, rows } = profileColumns(grid, hIdx);

  const cached = await resolveTemplate(db, insurerId, headers);
  let columnMap: Record<string, number>;
  let templateVersionId: string | null = null;
  if (cached) {
    columnMap = cached.columnMap;
    templateVersionId = cached.templateVersionId;
  } else {
    const m = await resolveMapping(profiles, rows, env);
    columnMap = columnMapOf(m.candidates);
  }

  const { staged, errors } = validateRows(rows, columnMap);
  if (errors.length) {
    await db.insert(uploadErrors).values(
      errors.map((e) => ({ uploadId, rowNo: e.rowNo, field: e.field, reason: e.reason, rawValue: e.rawValue ?? null })),
    );
  }
  await env.UPLOADS.put(`${r2Key}.staged.json`, JSON.stringify({ columnMap, staged }));
  await db.update(uploads).set({
    status: "review", rowCount: rows.length, okCount: staged.length, errorCount: errors.length, templateVersionId,
  }).where(eq(uploads.id, uploadId));

  return { rowCount: rows.length, okCount: staged.length, errorCount: errors.length };
}

/**
 * Queue Consumer (F-003 진행률 / F-008 실 파싱). R2 xlsx -> Grid -> ingestParsed.
 */
export async function queueConsumer(batch: MessageBatch<ParseJob>, env: Env): Promise<void> {
  const db = getDb(env);
  const now = () => new Date().toISOString();

  for (const msg of batch.messages) {
    const { uploadId, jobId, r2Key, insurerId } = msg.body;
    try {
      await db.update(jobs).set({ status: "running", progress: 0.1, updatedAt: now() }).where(eq(jobs.id, jobId));
      await db.update(uploads).set({ status: "parsing" }).where(eq(uploads.id, uploadId));

      const obj = await env.UPLOADS.get(r2Key);
      if (!obj) throw new Error(`R2 원본 없음: ${r2Key}`);
      const grid = sheetToGrid(await obj.arrayBuffer());

      await db.update(jobs).set({ progress: 0.5, updatedAt: now() }).where(eq(jobs.id, jobId));
      await ingestParsed(env, db, { uploadId, r2Key, insurerId }, grid);

      await db.update(jobs).set({ status: "done", progress: 1, updatedAt: now() }).where(eq(jobs.id, jobId));
      msg.ack();
    } catch (e) {
      console.error(`parse job 실패 job=${jobId} upload=${uploadId}`, e);
      await db.update(jobs).set({ status: "failed", message: "파싱 실패", updatedAt: now() }).where(eq(jobs.id, jobId));
      msg.retry(); // max_retries 3 이후 DLQ
    }
  }
}
