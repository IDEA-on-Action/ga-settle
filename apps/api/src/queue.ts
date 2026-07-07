import type { Env } from "./index";

export type ParseJob = {
  kind: "parse-upload";
  uploadId: string;
  r2Key: string;
  insurerId: string;
};

/**
 * Queue Consumer (F-003/F-008)
 * R2 원본 스트리밍 -> SheetJS 청크(1,000행) 파싱 -> 검증 -> 스테이징
 * 청크마다 jobs.progress 갱신 (SPA 폴링용)
 */
export async function queueConsumer(batch: MessageBatch<ParseJob>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    try {
      // TODO(F-003): env.UPLOADS.get(msg.body.r2Key) -> 청크 파싱 -> @ga-settle/mapping 검증
      // TODO(F-008): 실패 행 upload_errors, 성공 행 스테이징, 진행률 갱신
      msg.ack();
    } catch (e) {
      msg.retry(); // max_retries 3 이후 DLQ
    }
  }
}
