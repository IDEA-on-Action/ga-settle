# SPEC.md — ga-settle 단일 SoT

> SDD Triangle (Spec ↔ Code ↔ Test) 의 진실 소스. 모든 변경은 여기서 시작.
> 상위 문서: 위시켓_PRD_156459 (발주자 합의 기준) · 위시켓_아키텍처_156459 (설계 근거)
> 계약: 33,000,000원 / 105일(15주) · 마일스톤 1 = W4 매핑 엔진, 마일스톤 2 = W8 대사 시연

## §1. 개요

ga-settle — GA(법인보험대리점) 수수료·시책 통합 정산/대사 시스템. 30개 원수사 엑셀을 AI 온톨로지 매핑으로 표준화하고, 시책 룰 적용 → 대사(차액 검증) → 월 마감 → 지급 내역서까지 처리한다. 성공 기준: 변환 성공률 99%+, 병행 검증 차액 0원, 수만 행 비블로킹, 운영 자립(개발자 없이 포맷/룰 변경).

## §2. F-items (구현 단위)

### F-001 · 하네스 부트스트랩 + CI
- **REQ-001**: pnpm install → pnpm dev(web+api) → pnpm test 가 통과해야 한다
- **REQ-002**: GitHub Actions에서 push마다 lint+typecheck+test가 돌아야 한다
- **Acceptance**:
  - [ ] `pnpm install` PASS, `wrangler dev` GET /health 200
  - [ ] CI 그린
- **Status**: TODO
- **Sprint**: S0
- **Notes**: dot-* rename은 scripts/setup.sh가 처리

### F-002 · D1 스키마 + 마이그레이션
- **REQ-003**: 아키텍처 §4의 18개 엔티티가 Drizzle 스키마로 정의되어야 한다
- **REQ-004**: commission_records는 upload_id+row_no 역추적 컬럼을 필수로 가진다 (FR-08)
- **Acceptance**:
  - [ ] `wrangler d1 migrations apply` PASS
  - [ ] 스키마 단위 테스트 (insert/select 왕복)
- **Status**: TODO
- **Sprint**: S0

### F-003 · 업로드 파이프라인 (R2 + Queue 멱등)
- **REQ-005**: xls/xlsx 업로드 → 파일 해시 중복 즉시 반려 → R2 불변 보관 → Queue 발행 (FR-01, FR-06)
- **REQ-006**: 진행률이 jobs 테이블에 기록되고 SPA가 폴링으로 표시 (NFR-01)
- **Acceptance**:
  - [ ] 같은 파일 2회 업로드 시 두 번째는 반려
  - [ ] 수만 행 파일 업로드 중 UI 응답성 유지 (수동 확인)
- **Status**: TODO
- **Sprint**: S1

### F-004 · L1 데이터 프로파일링
- **REQ-007**: 컬럼별 타입 분포/널률/유니크/수치범위/표본을 산출한다
- **Acceptance**:
  - [ ] packages/mapping 단위 테스트 PASS (프로토타입 검증 케이스 이식됨)
- **Status**: TODO
- **Sprint**: S1
- **Notes**: 코어 로직은 packages/mapping에 이식 완료 (2026-07-07 프로토타입에서 검증)

### F-005 · L2 AI 시맨틱 매핑 + 폴백
- **REQ-008**: 온톨로지+프로파일을 Claude API에 전달, 매핑 후보+신뢰도+근거 JSON 수신 (FR-02)
- **REQ-009**: LLM 장애 시 규칙 기반 엔진으로 강등 동작 (자동 확정 비활성)
- **REQ-010**: 전송 표본은 마스킹, 컬럼당 8개 한정 (NFR-02 연계)
- **Acceptance**:
  - [ ] 무의미 헤더('항목A') 샘플이 값 기반으로 매핑됨
  - [ ] API 키 제거 상태에서 폴백 경로 테스트 PASS
- **Status**: TODO
- **Sprint**: S1

### F-006 · L3 정합성 교차검증 + L4 신뢰도 등급
- **REQ-011**: 지급수수료 ≈ 보험료 x 수수료율 표본 검증, % 스케일 자동 감지
- **REQ-012**: 신뢰도 보정 후 자동 확정/확인 필요/수동 3등급, 금액 필드는 보수적 임계값
- **Acceptance**:
  - [ ] 오염 데이터(율 컬럼 텍스트 혼입) 시 자동 확정 금지 테스트 PASS
- **Status**: TODO
- **Sprint**: S1

### F-007 · 매핑 관리 화면 + TemplateVersion
- **REQ-013**: 매핑 확정 시 TemplateVersion 저장(버전 이력), 헤더 시그니처 캐시로 재업로드 즉시 매핑 (FR-03)
- **REQ-014**: 양식 변경 감지 시 새 버전 등록 플로우 (개발자 개입 없음)
- **Acceptance**:
  - [ ] 확정 → 재업로드 → L0 캐시 적중 E2E
- **Status**: TODO
- **Sprint**: S1 (마일스톤 1 게이트: 실샘플 변환 성공률 리포트)

### F-008 · 행 검증 + 오류 리포트 + 승인 커밋
- **REQ-015**: 타입/필수/중복 검증, 오류 행 번호+사유 전량 표시 (FR-04, FR-05)
- **REQ-016**: 승인 후에만 스테이징 → 원장 트랜잭션 커밋 (FR-07)
- **Acceptance**:
  - [ ] 골든 표본 변환 성공률 자동 산출 스크립트
- **Status**: TODO
- **Sprint**: S1

### F-009 · 조직도 + ERP 동기화 + 소속 이력
- **REQ-017**: 본부>사업단>팀 트리, ERP 엑셀 일괄 등록, 월 정산은 당월 소속 기준 (FR-09~11)
- **Acceptance**:
  - [ ] 소속 이동 후 이전 월 재계산 시 이전 소속으로 계산되는 테스트
- **Status**: TODO
- **Sprint**: S2

### F-010 · 시책 룰 빌더
- **REQ-018**: 조건(기간/원수사/상품/조직/실적구간)+액션(지급률|고정액) 선언형 JSON, 관리 화면 CRUD (FR-12)
- **REQ-019**: 우선순위·중복 정책 명시, 평가기는 순수 함수 (FR-13)
- **Acceptance**:
  - [ ] packages/rules 표 기반(case table) 단위 테스트
- **Status**: TODO
- **Sprint**: S2

### F-011 · 가족계약 감지 (HITL)
- **REQ-020**: 성명+생년월일 매칭 후보 자동 생성, 확정은 실무자만, 해제 가능, 이력 보존 (FR-14)
- **Acceptance**:
  - [ ] 자동 확정 경로가 존재하지 않음을 테스트로 보장
- **Status**: TODO
- **Sprint**: S2

### F-012 · 룰 시뮬레이션
- **REQ-021**: 룰 변경 전 지급액 diff 미리보기, 실데이터 무영향 (FR-15)
- **Acceptance**:
  - [ ] 시뮬레이션 실행 후 원본 run 데이터 불변 검증
- **Status**: TODO
- **Sprint**: S2

### F-013 · 정산 계산 배치
- **REQ-022**: 월 단위 run, 상태 draft→calculated, Queue 배치+재시도, 룰별 산출 분해 저장 (FR-16)
- **Acceptance**:
  - [ ] 동일 입력 재실행 시 동일 출력 (재현성 테스트)
- **Status**: TODO
- **Sprint**: S3

### F-014 · 대사 + 차액 드릴다운
- **REQ-023**: 원수사 지급총액 vs 계산총액 자동 비교, 차액을 계약 단위까지 추적 (FR-17, FR-18)
- **Acceptance**:
  - [ ] 의도적 차액 주입 시 원인 계약 특정 E2E
- **Status**: TODO
- **Sprint**: S3 (마일스톤 2 게이트: 실데이터 대사 시연)

### F-015 · 수동 보정 + 감사 로그
- **REQ-024**: 보정 사유 필수, 이중 승인(옵션 플래그), 전 쓰기 감사 기록 (FR-19, NFR-04)
- **Status**: TODO
- **Sprint**: S3

### F-016 · 월 마감 (이중 잠금 + 스냅샷)
- **REQ-025**: closed 상태에서 API+DB 트리거 이중 쓰기 차단, 마감 스냅샷 R2 보관 (FR-20, NFR-05)
- **Acceptance**:
  - [ ] 마감 후 UPDATE 시도가 API/DB 양쪽에서 거부되는 테스트
- **Status**: TODO
- **Sprint**: S3

### F-017 · RBAC + 계정/공지
- **REQ-026**: 직책별 조직 스코프 권한, 세션 인증, 관리자 IP 허용목록 (FR-25~26, NFR-03)
- **Acceptance**:
  - [ ] 팀장이 타 팀 데이터 조회 시 403 테스트
- **Status**: TODO
- **Sprint**: S4

### F-018 · 지급 내역서 + 출력물
- **REQ-027**: 팀장용 설계사별 내역서, 정산 엑셀, 급여 이체 마스터 파일 (FR-21~23)
- **Status**: TODO
- **Sprint**: S5

### F-019 · 통계/집계
- **REQ-028**: 조직/원수사/기간별 집계 (FR-24)
- **Status**: TODO
- **Sprint**: S5

### F-020 · 보안 하드닝
- **REQ-029**: 금액/인적정보 필드 AES-GCM 암호화, 키는 Workers Secret (NFR-02)
- **Status**: TODO
- **Sprint**: S6

### F-021 · 골든 회귀 + E2E
- **REQ-030**: 원수사별 골든 표본 → 기대 원장 스냅샷 회귀, Playwright 핵심 5흐름 (NFR-06)
- **Status**: TODO
- **Sprint**: S6

### F-022 · 병행 검증 (차액 0원 리포트)
- **REQ-031**: 한 달치 실데이터 이중 정산 비교, 차이 발생 시 계약 단위 원인 리포트 (§2 성공 기준)
- **Status**: TODO
- **Sprint**: S6

### F-023 · 운영 배포 + 매뉴얼 + 인수인계
- **REQ-032**: prod 배포, 사용/운영 매뉴얼, 검수 대응 자료 (NFR-07)
- **Status**: TODO
- **Sprint**: S7

## §3. Backlog (F-item 승격 대기)

| ID | 한 줄 | 승격 기준 충족? | 우선 |
|---|---|---|---|
| B-001 | 설계사 개인 조회 포털 (고도화) | — | low |
| B-002 | 대사 차액 원인 LLM 자연어 설명 | — | mid |
| B-003 | 시책 룰 자연어 → JSON 초안 생성 | — | mid |
| B-004 | 원수사 API 직접 연동 | — | low |

> 승격 기준 (`.claude/rules/task-promotion.md`): D1 migration / 3+ 파일 / 사용자 관찰가능 / Sprint 필요 — 1개 충족 시 F-item으로

## §4. Phase / Milestone

| Phase | 주차 | F-items | Status |
|---|---|---|---|
| 0 · Bootstrap + 분석(S0) | W1-2 | F-001, F-002 (+룰 워크숍/샘플 수집) | TBD |
| 1 · 매핑 엔진(S1) | W3-4 | F-003~F-008 → **마일스톤 1** | planned |
| 2 · 룰(S2) | W5-6 | F-009~F-012 | planned |
| 3 · 대사(S3) | W7-8 | F-013~F-016 → **마일스톤 2** | planned |
| 4 · 백오피스(S4) | W9-10 | F-017 | planned |
| 5 · 출력(S5) | W11-12 | F-018, F-019 | planned |
| 6 · 검증(S6) | W13-14 | F-020~F-022 → 차액 0원 리포트 | planned |
| 7 · 오픈(S7) | W15 | F-023 | planned |
