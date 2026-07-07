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

- GET /health - 헬스체크
- POST /api/uploads - 엑셀 업로드(멀티파트). SHA-256 멱등(중복 409), R2 불변 보관, Queue 발행, 202+{uploadId,jobId} (F-003)
- GET /api/jobs/:id - 파싱 진행률 폴링 (F-003)
- GET /api/uploads/:id - 업로드 상태 조회 (F-003)
- GET /api/uploads/:id/mapping - 파싱 후 columnMap + 검증 카운트 (F-005 어댑터, F-008 결선)
- GET /api/uploads/:id/errors - 검증 오류 행 리포트 (rowNo+field+reason, F-008)
- POST /api/uploads/:id/approve - review 상태 승인 → 원장(commission_records) 커밋 (F-008)
- POST /api/uploads/:id/mapping/confirm - 매핑 확정 → TemplateVersion 저장 + L0 시그니처 캐시 (F-007)
- GET /api/insurers/:id/templates - 원수사 매핑 버전 이력 (F-007)
- POST /api/org/units · GET /api/org/tree - 조직도(본부>사업단>팀) (F-009)
- POST /api/agents · POST /api/agents/:id/assignments · GET /api/agents/:id/org?date= - 설계사/시점별 소속 (F-009)
- POST /api/erp/agents - ERP 설계사+소속 일괄 등록 (F-009)
- POST /api/rules · GET /api/rules · DELETE /api/rules/:id - 시책 룰 CRUD(선언형 조건+액션) (F-010)
- POST /api/rules/simulate - 룰 변경 지급액 diff 미리보기(실데이터 무영향) (F-012)
- POST /api/family/detect · /:id/confirm · /:id/release · GET /api/family - 가족계약 감지 HITL (F-011)
- POST /api/runs · POST /api/runs/:id/calculate · GET /api/runs/:id - 월 정산 run + 룰 계산(재현성) (F-013)
- GET /api/runs/:id/reconciliation - 대사(원수사 보고액 vs 계산액, 계약 단위 차액 드릴다운) (F-014)
- POST /api/runs/:id/close - 마감 이중 잠금 (F-016, 미구현 501)

## 도메인 요지

30개 원수사가 매월 서로 다른 양식의 엑셀로 수수료 내역 송부 → L0 시그니처 캐시 → L1 프로파일링 → L2 LLM 매핑 → L3 정합성(지급수수료 ≈ 보험료 x 수수료율) → L4 신뢰도 등급 → 원장 → 시책 룰 → 대사 → 보정 → 마감 → 내역서. 상세는 SPEC.md와 상위 아키텍처 문서.

## 대화/문서 규칙

- 한국어 반존대, 간결. em/en 대시 대신 하이픈.
- ktds 자산·데이터 사용 금지 (계약 주체: 생각과 행동).
