# CLAUDE.md — ga-settle

GA 수수료·시책 통합 정산/대사 시스템. **SPEC.md가 단일 SoT** — 작업은 F-item 단위로만 진행하고, 완료 시 SPEC.md Status를 갱신한다.

## 스택 (변경 금지, 변경 필요 시 SPEC Notes에 결정 기록)

- 모노레포: pnpm + Turborepo
- apps/web: React 18 + Vite + TS(strict) + Tailwind 4 + shadcn/ui + TanStack Query
- apps/api: Cloudflare Workers + Hono + Zod / Queue Consumer 분리 엔트리
- packages/schema: Drizzle(D1) 스키마 + Zod 타입 (프론트/백 공유, 단일 진실원천)
- packages/mapping: AI 온톨로지 매핑 코어 (순수 TS, 브라우저/Worker 양용)
- packages/rules: 시책 룰 엔진 (순수 함수, 재현성 보장)
- packages/golden: 골든 표본 + 기대 결과 (회귀 테스트 데이터)

## 명령

```bash
pnpm dev          # web + api 동시 (turbo)
pnpm test         # vitest 전체
pnpm build        # 전체 빌드
pnpm -F api dev   # wrangler dev 단독
pnpm -F @ga-settle/schema db:generate  # 스키마 변경 후 D1 마이그레이션 SQL 생성 (drizzle-kit)
pnpm -F api d1:migrate:local           # 로컬 D1에 마이그레이션 적용 (트리거는 0001 수동 유지)
```

## 불변 원칙 (아키텍처 문서 §4-§7 요약)

1. **역추적 불변식**: commission_records는 반드시 upload_id + row_no 보유. 어떤 정산 숫자든 원본 행까지 2 join.
2. **마감 이중 잠금**: closed run은 API 거부 + D1 트리거 차단. 스냅샷 R2 보관.
3. **AI는 후보/근거만**: 정산 숫자는 전부 결정적 코드가 계산. LLM은 매핑 후보·설명·초안만. 확정은 정합성 검증 또는 사람(HITL).
4. **멱등**: 파일 해시 중복 반려, 배치 재실행 안전.
5. **민감정보**: 금액/인적정보 필드 암호화, LLM 전송은 마스킹된 표본만.
6. 정산/매핑/룰 로직 수정 시 골든 회귀 테스트 필수 통과.

## API 엔드포인트 (구현 시 여기 갱신)

- GET / - 고객 데모 랜딩/인터랙티브 페이지 (정식 SPA는 B-006)
- GET /health - 헬스체크
- POST /api/insurers · GET /api/insurers · GET/PATCH/DELETE /api/insurers/:id - 원수사 마스터 CRUD(삭제는 참조 있으면 409) (F-032)
- POST /api/uploads - 엑셀 업로드(멀티파트). SHA-256 멱등(중복 409), R2 불변 보관, Queue 발행, 202+{uploadId,jobId} (F-003)
- GET /api/uploads - 최근 업로드 목록(id,원수사명,정산월,상태,카운트) 선택기용, 민감정보 제외. ?q·?limit·?offset+total 검색/페이지 (F-036/F-042)
- DELETE /api/uploads/:id - 업로드 삭제. 마감(closed run)된 정산월은 409 차단(불변식 #2, API+D1 트리거), 그 외는 원장·정산라인·검증오류·jobs·R2 원본 cascade + 감사로그(upload.delete). UI: 업로드 내역 목록 2단계 확인 (F-047)
- GET /api/jobs/:id - 파싱 진행률 폴링 (F-003)
- GET /api/uploads/:id - 업로드 상태 조회 (F-003)
- GET /api/uploads/:id/mapping - 파싱 후 columnMap + 검증 카운트 (F-005 어댑터, F-008 결선)
- GET /api/uploads/:id/errors - 검증 오류 행 리포트 (rowNo+field+reason, F-008)
- POST /api/uploads/:id/approve - review 상태 승인 → 원장(commission_records) 커밋 (F-008)
- POST /api/uploads/:id/mapping/confirm - 매핑 확정 → TemplateVersion 저장 + L0 시그니처 캐시 (F-007)
- GET /api/insurers/:id/templates - 원수사 매핑 버전 이력 (F-007)
- POST /api/org/units · GET /api/org/tree - 조직도(본부>사업단>팀) (F-009)
- GET /api/agents - 설계사 목록(id,code,name,status) 이름순, 선택기용 (F-040)
- POST /api/agents · POST /api/agents/:id/assignments · GET /api/agents/:id/org?date= - 설계사/시점별 소속 (F-009)
- POST /api/erp/agents - ERP 설계사+소속 일괄 등록 (F-009)
- POST /api/incentive-plans/ocr - 시책안 이미지/PDF(multipart, category 대분류 필수) → R2 원본 보관(SHA-256 멱등) → 업로드 즉시 incentive_plans 대장 등록(F-048, 대분류 저장 F-051) → CLOVA OCR(10p 초과 PDF는 ≤10p 청크 분할·병합 F-049) + Upstage 구조화 → 시책룰 필드 후보 + 저신뢰 표시. OCR 결과로 대장 갱신(ocr_status/신뢰도/정산월 자동파싱), 실패도 status=failed로 기록. category 미선택/오값 400. 하이브리드 엔진, blended 신뢰도(LLM×OCR평균, 임계 0.85). 인증 필수 (F-043/F-046/F-048/F-049/F-051)
- GET /api/incentive-plans - 시책안 등록 대장 목록(파일명·원수사·정산월·OCR상태·신뢰도·업로더·시각). 원수사명 조인, ?q·?limit·?offset+total, `{items,total}`. UI: 업로드 화면 '시책안 문서(OCR)' 탭 '시책안 등록 내역' 섹션 (F-048)
- GET /api/incentive-plan-definitions · /summary - 시상정의 카탈로그(원수사가 준 정의 원형, 무손실 16열). ?insurerId·?month·?q+페이지. incentive_rules(정산엔진)와 분리, 정의는 참조/후보 (F-044)
- POST /api/incentive-plan-definitions - 담당자 확정 시상정의 write(OCR→정의 결선). planImageKey(F-043 OCR 원본)로 역추적, source_type=ocr, 확정자 자동+감사 (F-044)
- POST /api/incentive-plan-definitions/promote - 선택 정의를 정산 엔진 운영룰(incentive_rules)로 확정 승격(HITL). rule-{defId} 결정적·idempotent, condition/action 매핑. 목록에 promoted 플래그. UI: /app/plan-definitions (F-044)
- GET /api/incentive-plan-definitions/:id/image - 원본 시책안 이미지 R2 스트림(OCR 출처만, 인증). 감사 소명 (F-044)
- GET /api/audit/incentive-trace - 감사 역추적(?lineId|ruleId|definitionId): 지급건→실적원본(upload+row)→운영룰→시상정의→원본 시책안. UI: /app/audit (F-044)
- POST /api/rules · GET /api/rules · DELETE /api/rules/:id - 시책 룰 CRUD(선언형 조건+액션) (F-010)
- POST /api/rules/simulate - 룰 변경 지급액 diff 미리보기(실데이터 무영향) (F-012)
- POST /api/family/detect · /:id/confirm · /:id/release · GET /api/family - 가족계약 감지 HITL. 확정자(confirmedBy)는 인증 사용자 자동 (F-011/F-038). GET은 {items,total} 페이지네이션(?limit/?offset, F-042)
- POST /api/users · POST /api/auth/login · GET /api/orgs/:id/agents - 계정/세션인증/RBAC 조직스코프 (F-017)
- POST /api/auth/change-password · POST /api/users/:id/reset-password - 본인 비번 변경(현재 비번 확인, mustChangePassword 해제)·admin 초기화(mustChangePassword=true 임시 비번 발급) (F-031/F-033)
- POST /api/auth/otp/request · POST /api/auth/otp/verify - @atasset.co.kr 이메일 OTP(6자리, 5분). OTP_ENFORCED=true일 때만 비번 차단, 기본 off는 임시 비번 로그인 허용 (F-033)
- GET /api/runs - 정산 Run 목록(id,정산월,상태,마감시각) 월/Run 선택기용 (F-037)
- POST /api/runs · POST /api/runs/:id/calculate · GET /api/runs/:id - 월 정산 run + 룰 계산(재현성) (F-013)
- GET /api/runs/:id/reconciliation - 대사(원수사 보고액 vs 계산액, 계약 단위 차액 드릴다운) (F-014)
- GET /api/runs/:id/contracts - 해당 run 월 계약 목록(contractNo,agentId,productName) 보정 선택기용, 금액 제외 (F-041)
- GET /api/runs/:id/parallel-verify - 병행 검증(저장 vs 재계산 차액 0원 무결성) (F-022)
- POST /api/runs/:id/adjustments · GET - 수동 보정(reason 필수)+감사로그. 등록자(createdBy)는 인증 사용자 자동 기록, approvedBy는 선택적 이중 승인자 (F-015/F-038). GET은 {items,total} 페이지네이션 (F-042)
- POST /api/runs/:id/close - 월 마감(이중 잠금 API+DB 트리거, R2 스냅샷). 마감자(closedBy)는 인증 사용자 자동 (F-016/F-038)
- POST/GET /api/runs/:id/payslips · GET /:agentId · GET /transfer-master - 지급 내역서/이체 CSV (F-018)
- GET /api/stats/by-org · by-insurer · by-month - 조직/원수사/기간별 집계 (F-019)

## 도메인 요지

30개 원수사가 매월 서로 다른 양식의 엑셀로 수수료 내역 송부 → L0 시그니처 캐시 → L1 프로파일링 → L2 LLM 매핑 → L3 정합성(지급수수료 ≈ 보험료 x 수수료율) → L4 신뢰도 등급 → 원장 → 시책 룰 → 대사 → 보정 → 마감 → 내역서. 상세는 SPEC.md와 상위 아키텍처 문서.

## 대화/문서 규칙

- 한국어 반존대, 간결. em/en 대시 대신 하이픈.
- ktds 자산·데이터 사용 금지 (계약 주체: 생각과 행동).
