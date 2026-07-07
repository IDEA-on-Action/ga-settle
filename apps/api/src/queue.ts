import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { jobs, uploads, uploadErrors } from "@ga-settle/schema";
import { detectHeaderRow, profileColumns, validateRows, columnMapOf, type Cell } from "@ga-settle/mapping";
import { getDb } from "./db";
import { resolveTemplate } from "./routes/mapping";
import { resolveMapping } from "./llm";
import type { Env, ParseJob } from "./types";

export type { ParseJob }; // 기존 import 경로(./queue) 호환용 재노출

/**
 * Queue Consumer (F-003 진행률 / F-008 실 파싱).
 * R2 원본(xlsx) -> Grid -> L0 캐시 or L2~L4 매핑 -> 행 검증 -> 오류 리포트 + 스테이징(R2 JSON).
 * 승인 전까지 원장(commission_records) 미커밋 (REQ-016은 approve 라우트에서).
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
      const buf = await obj.arrayBuffer(); // 스트림 완전 소비

      // 파싱: 첫 시트 -> Grid(배열의 배열)
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]!];
      const grid = XLSX.utils.sheet_to_json(sheet!, { header: 1, raw: true, defval: null }) as Cell[][];

      const hIdx = detectHeaderRow(grid);
      const headers = (grid[hIdx] ?? []).map((h) => (h == null ? "" : String(h)));
      const { profiles, rows } = profileColumns(grid, hIdx);
      await db.update(jobs).set({ progress: 0.4, updatedAt: now() }).where(eq(jobs.id, jobId));

      // L0 시그니처 캐시 적중이면 AI 스킵, 아니면 L2~L4 매핑
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
      await db.update(jobs).set({ progress: 0.7, updatedAt: now() }).where(eq(jobs.id, jobId));

      // 행 검증 -> 오류 리포트 + 스테이징 (원장 미커밋)
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

      await db.update(jobs).set({ status: "done", progress: 1, updatedAt: now() }).where(eq(jobs.id, jobId));
      msg.ack();
    } catch (e) {
      // 원시 에러는 서버 로그로만 (jobs.message는 무인증 GET으로 노출되므로 일반 메시지)
      console.error(`parse job 실패 job=${jobId} upload=${uploadId}`, e);
      await db.update(jobs).set({ status: "failed", message: "파싱 실패", updatedAt: now() }).where(eq(jobs.id, jobId));
      msg.retry(); // max_retries 3 이후 DLQ
    }
  }
}
