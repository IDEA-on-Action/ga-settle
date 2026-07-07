import { eq } from "drizzle-orm";
import { jobs, uploads } from "@ga-settle/schema";
import { getDb } from "./db";
import type { Env, ParseJob } from "./types";

export type { ParseJob }; // 기존 import 경로(./queue) 호환용 재노출

/**
 * Queue Consumer (F-003 진행률 골격 / F-008 실제 파싱)
 * F-003: R2 원본 존재 확인 + jobs 진행률 생명주기(queued→running→done) 기록.
 * F-008: R2 스트리밍 -> SheetJS 청크(1,000행) 파싱 -> @ga-settle/mapping 검증 -> 스테이징.
 */
export async function queueConsumer(batch: MessageBatch<ParseJob>, env: Env): Promise<void> {
  const db = getDb(env);
  const now = () => new Date().toISOString();

  for (const msg of batch.messages) {
    const { uploadId, jobId, r2Key } = msg.body;
    try {
      await db.update(jobs).set({ status: "running", progress: 0.1, updatedAt: now() }).where(eq(jobs.id, jobId));
      await db.update(uploads).set({ status: "parsing" }).where(eq(uploads.id, uploadId));

      // 존재 확인만 (head = 스트림 없음). 실제 스트리밍 파싱은 F-008에서 get + 소비.
      const head = await env.UPLOADS.head(r2Key);
      if (!head) throw new Error(`R2 원본 없음: ${r2Key}`);
      // TODO(F-008): env.UPLOADS.get(r2Key).body 청크 파싱 -> 행 검증 -> 스테이징,
      //   청크마다 jobs.progress 갱신, 실패 행 upload_errors, uploads.rowCount/okCount/errorCount 집계.

      await db.update(jobs).set({ status: "done", progress: 1, updatedAt: now() }).where(eq(jobs.id, jobId));
      await db.update(uploads).set({ status: "review" }).where(eq(uploads.id, uploadId));
      msg.ack();
    } catch (e) {
      // 원시 에러는 서버 로그로만 (jobs.message는 무인증 GET으로 노출되므로 일반 메시지)
      console.error(`parse job 실패 job=${jobId} upload=${uploadId}`, e);
      await db.update(jobs).set({ status: "failed", message: "파싱 실패", updatedAt: now() }).where(eq(jobs.id, jobId));
      msg.retry(); // max_retries 3 이후 DLQ
    }
  }
}
