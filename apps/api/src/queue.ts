import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { jobs, uploads, uploadErrors, incentivePlans } from "@ga-settle/schema";
import { extractIncentivePlan, parseSettlementMonth, OcrError } from "./ocr";
import {
  ONTOLOGY, INCENTIVE_ONTOLOGY, RELATION_DESC, INCENTIVE_RELATION_DESC,
  detectHeaderRow, profileColumns, validateRows, columnMapOf,
  truncateAtBlockBoundary, extractGroupHeaders, type Cell,
} from "@ga-settle/mapping";
import { getDb, type Db } from "./db";
import { resolveTemplate } from "./routes/mapping";
import { resolveMapping } from "./llm";
import type { Env, ParseJob, OcrPlanJob } from "./types";

export type { ParseJob }; // 기존 import 경로(./queue) 호환용 재노출

// 오류 상세 행 저장 상한. errorCount(총계)는 전량 기록되고 상세만 절단 -> 병리적 파일(수만 오류)에서
// 배치 폭주 방지. 상한 초과분은 /errors 리포트에 미노출(총계와 차이로 절단 인지 가능).
export const MAX_ERROR_DETAIL_ROWS = 5000;

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
  env: Env, db: Db, ids: { uploadId: string; r2Key: string; insurerId: string; docType?: "commission" | "incentive" }, grid: Cell[][],
): Promise<{ rowCount: number; okCount: number; errorCount: number }> {
  const { uploadId, r2Key, insurerId } = ids;
  const incentive = ids.docType === "incentive";

  // 시책지급내역(F-062): 실무 파일은 하위 표 여러 개가 한 시트에 이어 붙음 -> 첫 블록(상세)만.
  // 3단 헤더가 흔해 그룹 라벨을 매핑 문맥에 주입. 수수료 경로는 기존 동작 그대로.
  const hIdx = detectHeaderRow(grid);
  const g = incentive ? truncateAtBlockBoundary(grid, hIdx) : grid;
  const headers = (g[hIdx] ?? []).map((h) => (h == null ? "" : String(h)));
  const { profiles, rows } = profileColumns(g, hIdx, incentive ? { groupHeaders: extractGroupHeaders(g, hIdx) } : undefined);

  const ontology = incentive ? INCENTIVE_ONTOLOGY : ONTOLOGY;
  const cached = await resolveTemplate(db, insurerId, headers);
  let columnMap: Record<string, number>;
  let templateVersionId: string | null = null;
  if (cached) {
    columnMap = cached.columnMap;
    templateVersionId = cached.templateVersionId;
  } else {
    const m = await resolveMapping(profiles, rows, env, {}, ontology, incentive ? INCENTIVE_RELATION_DESC : RELATION_DESC);
    columnMap = columnMapOf(m.candidates);
  }

  // 시책은 동일 증권번호 복수 시상 행이 정상 -> 중복 검증 미적용
  const { staged, errors } = validateRows(rows, columnMap, ontology, { dedupe: !incentive });
  if (errors.length) {
    // D1은 쿼리당 바인딩 파라미터 100개 한도 -> 5컬럼 x 18행 = 90개 단위로 분할해
    // 단일 batch(원자적)로 기록. 대량 오류 파일(삼성화재 시책지급내역 2,911건 실사례) 대응.
    const detail = errors.slice(0, MAX_ERROR_DETAIL_ROWS)
      .map((e) => ({ uploadId, rowNo: e.rowNo, field: e.field, reason: e.reason, rawValue: e.rawValue ?? null }));
    const chunks = [];
    for (let i = 0; i < detail.length; i += 18) chunks.push(detail.slice(i, i + 18));
    await db.batch([db.insert(uploadErrors).values(chunks[0]!), ...chunks.slice(1).map((c) => db.insert(uploadErrors).values(c))]);
  }
  await env.UPLOADS.put(`${r2Key}.staged.json`, JSON.stringify({ columnMap, staged }));
  await db.update(uploads).set({
    status: "review", rowCount: rows.length, okCount: staged.length, errorCount: errors.length, templateVersionId,
  }).where(eq(uploads.id, uploadId));

  return { rowCount: rows.length, okCount: staged.length, errorCount: errors.length };
}

/**
 * 시책안 OCR job 처리 (F-066). R2 원본 -> extractIncentivePlan -> 결과 R2 저장 + 대장 갱신.
 * 동기 경로(incentive-plans.ts)와 동일 로직이나, 결과를 응답 대신 R2(`{r2Key}.ocr.json`)에 저장해
 * 프론트가 job 완료 후 조회하게 한다(엑셀 staged.json 대칭). 실패도 F-064 stage/사유 기록.
 */
async function runOcrPlanJob(env: Env, db: Db, body: OcrPlanJob, now: () => string): Promise<void> {
  const { planId, jobId, r2Key, ext } = body;
  await db.update(jobs).set({ status: "running", progress: 0.1, updatedAt: now() }).where(eq(jobs.id, jobId));
  const obj = await env.UPLOADS.get(r2Key);
  if (!obj) throw new Error(`R2 원본 없음: ${r2Key}`);
  const bytes = await obj.arrayBuffer();

  try {
    await db.update(jobs).set({ progress: 0.3, updatedAt: now() }).where(eq(jobs.id, jobId));
    const result = await extractIncentivePlan(bytes, ext, env);
    const month = parseSettlementMonth(result.rule.period?.value);
    const lowCount = result.lowConfidenceKeys.length;
    // 결과를 R2에 저장 - 프론트가 job done 후 GET /:id/ocr-result로 조회(동기 응답 대체).
    await env.UPLOADS.put(`${r2Key}.ocr.json`, JSON.stringify(result));
    await db.update(incentivePlans).set({
      ocrStatus: lowCount > 0 ? "low_confidence" : "ok",
      ocrAvgConfidence: result.ocr.avgConfidence,
      ocrFieldCount: result.ocr.fieldCount,
      lowConfidenceCount: lowCount,
      ocrErrorStage: null, ocrErrorMessage: null, // 재시도 성공 시 이전 실패 사유 클리어
      ...(month ? { settlementMonth: month } : {}),
      updatedAt: now(),
    }).where(eq(incentivePlans.id, planId));
    await db.update(jobs).set({ status: "done", progress: 1, updatedAt: now() }).where(eq(jobs.id, jobId));
  } catch (e) {
    // F-064: 실패 단계+사유 저장(동기 경로와 동일). 큐 재시도는 상류 일시 장애만 흡수하도록 throw 유지.
    const stage = e instanceof OcrError ? e.stage : "unknown";
    const message = e instanceof Error ? e.message : String(e);
    await db.update(incentivePlans).set({ ocrStatus: "failed", ocrErrorStage: stage, ocrErrorMessage: message.slice(0, 500), updatedAt: now() })
      .where(eq(incentivePlans.id, planId));
    throw e;
  }
}

/**
 * Queue Consumer (F-003 진행률 / F-008 실 파싱 / F-066 OCR). kind로 분기.
 */
export async function queueConsumer(batch: MessageBatch<ParseJob>, env: Env): Promise<void> {
  const db = getDb(env);
  const now = () => new Date().toISOString();

  for (const msg of batch.messages) {
    const body = msg.body;
    const jobId = body.jobId;
    try {
      if (body.kind === "ocr-plan") {
        await runOcrPlanJob(env, db, body, now);
        msg.ack();
        continue;
      }
      const { uploadId, r2Key, insurerId, docType } = body;
      await db.update(jobs).set({ status: "running", progress: 0.1, updatedAt: now() }).where(eq(jobs.id, jobId));
      await db.update(uploads).set({ status: "parsing" }).where(eq(uploads.id, uploadId));

      const obj = await env.UPLOADS.get(r2Key);
      if (!obj) throw new Error(`R2 원본 없음: ${r2Key}`);
      const grid = sheetToGrid(await obj.arrayBuffer());

      await db.update(jobs).set({ progress: 0.5, updatedAt: now() }).where(eq(jobs.id, jobId));
      await ingestParsed(env, db, { uploadId, r2Key, insurerId, docType }, grid);

      await db.update(jobs).set({ status: "done", progress: 1, updatedAt: now() }).where(eq(jobs.id, jobId));
      msg.ack();
    } catch (e) {
      console.error(`${body.kind} job 실패 job=${jobId}`, e);
      // 원인 미기록이면 사후 진단 불가(F-061 교훈: "파싱 실패"만으론 D1 한도 초과를 특정 못 함)
      const cause = String(e instanceof Error ? e.message : e).slice(0, 200);
      const label = body.kind === "ocr-plan" ? "OCR 실패" : "파싱 실패";
      await db.update(jobs).set({ status: "failed", message: `${label}: ${cause}`, updatedAt: now() }).where(eq(jobs.id, jobId));
      msg.retry(); // max_retries 3 이후 DLQ
    }
  }
}
