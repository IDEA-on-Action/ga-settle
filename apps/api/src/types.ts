// Worker 바인딩 + 큐 메시지 타입 (SoT). 라우트 모듈/큐 소비자가 공유해 순환 import 방지.
export type ParseJob = {
  kind: "parse-upload";
  uploadId: string;
  jobId: string;
  r2Key: string;
  insurerId: string;
};

export type Env = {
  DB: D1Database;
  UPLOADS: R2Bucket;
  PARSE_QUEUE: Queue<ParseJob>;
  ANTHROPIC_API_KEY: string;
  FIELD_ENCRYPTION_KEY: string;
  SESSION_SECRET: string;
  ADMIN_IP_ALLOWLIST: string;
  ENV: string;
};
