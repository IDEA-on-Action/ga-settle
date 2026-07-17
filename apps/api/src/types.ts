// Worker 바인딩 + 큐 메시지 타입 (SoT). 라우트 모듈/큐 소비자가 공유해 순환 import 방지.
export type ParseJob = {
  kind: "parse-upload";
  uploadId: string;
  jobId: string;
  r2Key: string;
  insurerId: string;
  docType?: "commission" | "incentive"; // 문서유형 (F-062, 생략 시 commission - 구 메시지 호환)
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
  // 이메일 OTP (F-027). 미설정 시 도메인 기본값 사용, 이메일 미발송(dev).
  RESEND_API_KEY?: string;      // 이메일 발송 API 키 (secret)
  OTP_EMAIL_DOMAIN?: string;    // OTP 전용 도메인 (기본 atasset.co.kr)
  OTP_FROM_EMAIL?: string;      // 발신 주소
  // OTP 강제 스위치. "true"/"1"일 때만 @도메인 계정 비번 로그인 차단(OTP 전용).
  // 미설정(기본 off)이면 임시 비번 로그인 허용 - 이메일 발송 인프라 준비 전까지의 대체 흐름.
  OTP_ENFORCED?: string;
  // OCR 시책안 인식 (F-043). 하이브리드: CLOVA General OCR(텍스트 추출) + Upstage Solar(룰 필드 구조화).
  // 미설정 시 해당 기능만 503 degrade - 나머지 파이프라인 무영향.
  CLOVA_OCR_INVOKE_URL?: string; // Naver CLOVA General OCR APIGW invoke URL (secret)
  CLOVA_OCR_SECRET?: string;     // X-OCR-SECRET (secret)
  UPSTAGE_API_KEY?: string;      // Upstage Solar Bearer 키 (secret)
  UPSTAGE_BASE_URL?: string;     // 기본 https://api.upstage.ai/v1
  UPSTAGE_MODEL?: string;        // 기본 solar-mini
  UPSTAGE_CHUNK_CHARS?: string;  // 구조화 청크 크기 조정(기본 8000, F-065 대용량 튜닝)
  // 정적 자산(SPA) 바인딩 - apps/web/dist를 같은 오리진(ata.minu.best)에서 서빙 (B-006 단일 오리진).
  ASSETS: Fetcher;
};
