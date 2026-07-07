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
  - [x] `pnpm install` PASS, `wrangler dev` GET /health 200
  - [x] CI 그린 (GitHub Actions run 28867146909 PASS, PR #1)
- **Status**: DONE
- **Sprint**: S0
- **Notes**: dot-* rename은 scripts/setup.sh가 처리. 2026-07-07 D1/R2/Queue 리소스 생성 완료(D1 id 기입), 부트스트랩 정합성 수정: schema Drizzle extraConfig 객체형(drizzle 0.36 유지), api ExportedHandler 큐 타입 파라미터, /health vitest 스모크 추가.

### F-002 · D1 스키마 + 마이그레이션
- **REQ-003**: 아키텍처 §4의 18개 엔티티가 Drizzle 스키마로 정의되어야 한다
- **REQ-004**: commission_records는 upload_id+row_no 역추적 컬럼을 필수로 가진다 (FR-08)
- **Acceptance**:
  - [x] `wrangler d1 migrations apply` PASS (0000 테이블 35 + 0001 트리거 17 commands, --local)
  - [x] 스키마 단위 테스트 (insert/select 왕복, better-sqlite3 인메모리 4 tests PASS)
- **Status**: DONE
- **Sprint**: S0
- **Notes**: 18 엔티티(insurers/template_versions/uploads/upload_errors/commission_records/org_units/agents/agent_assignments/incentive_rules/family_flags/settlement_runs/settlement_lines/reconciliations/adjustments/payslips/users/audit_logs/jobs). roles는 users.role 컬럼 통합. 마이그레이션 생성: drizzle-kit(devDep 추가, 스택 결정). 마감 잠금·audit append-only는 스키마로 표현 불가 → migrations/0001_triggers.sql 수동 유지(16 트리거). 왕복 테스트는 better-sqlite3(devDep, D1과 동일 SQLite 엔진).

### F-003 · 업로드 파이프라인 (R2 + Queue 멱등)
- **REQ-005**: xls/xlsx 업로드 → 파일 해시 중복 즉시 반려 → R2 불변 보관 → Queue 발행 (FR-01, FR-06)
- **REQ-006**: 진행률이 jobs 테이블에 기록되고 SPA가 폴링으로 표시 (NFR-01)
- **Acceptance**:
  - [x] 같은 파일 2회 업로드 시 두 번째는 반려 (miniflare D1 UNIQUE 실측, 409)
  - [x] 수만 행 파일 업로드 중 UI 응답성 유지 (202 즉시 반환 + Queue offload + jobs 폴링 구조로 충족, 실제 수만행 스트리밍 파싱은 F-008)
- **Status**: DONE
- **Sprint**: S1
- **Notes**: POST /api/uploads(SHA-256 멱등→R2 불변→Queue→jobs), GET /api/jobs/:id·/api/uploads/:id 폴링. 원수사 사전 등록 검사(404). Queue consumer는 진행률 생명주기 골격(head 존재확인)까지, 실제 파싱은 F-008. 테스트: vitest-pool-workers(miniflare 실 D1+R2+Queue) 6 + health 1. nodejs_compat 플래그 추가(pool-workers 요건).

### F-004 · L1 데이터 프로파일링
- **REQ-007**: 컬럼별 타입 분포/널률/유니크/수치범위/표본을 산출한다
- **Acceptance**:
  - [x] packages/mapping 단위 테스트 PASS (프로토타입 이식 10 + L1 REQ-007 보강 6 = 16)
- **Status**: DONE
- **Sprint**: S1
- **Notes**: 코어 로직 이식 완료(프로토타입). F-004에서 REQ-007 각 산출물(널률/유니크/수치범위/표본) 명시 단언 추가 + `inferType()`(열별 대표 타입 text/number/date, int는 온톨로지 몫이라 배제, yymmdd 겹침은 날짜 우선) 추가 + `ColumnProfile.type` 필드 + buildProfilePrompt에 추정타입 노출. 이식 로직 불변(추가만).

### F-005 · L2 AI 시맨틱 매핑 + 폴백
- **REQ-008**: 온톨로지+프로파일을 Claude API에 전달, 매핑 후보+신뢰도+근거 JSON 수신 (FR-02)
- **REQ-009**: LLM 장애 시 규칙 기반 엔진으로 강등 동작 (자동 확정 비활성)
- **REQ-010**: 전송 표본은 마스킹, 컬럼당 8개 한정 (NFR-02 연계)
- **Acceptance**:
  - [x] 무의미 헤더('항목A') 샘플이 값 기반으로 매핑됨 (산식 발굴, mapping + api 테스트)
  - [x] API 키 제거 상태에서 폴백 경로 테스트 PASS (engine=local 강등)
- **Status**: DONE
- **Sprint**: S1
- **Notes**: apps/api/src/llm.ts 어댑터 - aiMap(Claude tool_use로 매핑후보 JSON, 마스킹표본 8개) + resolveMapping(AI 시도→장애 시 localMap 강등 REQ-009→L3 정합성→L4 등급). 모델 claude-sonnet-5. 테스트 4(폴백/AI파싱/5xx강등/마스킹). GET /api/uploads/:id/mapping 라우트 E2E는 파싱된 프로파일 필요 → F-008에서 결선.

### F-006 · L3 정합성 교차검증 + L4 신뢰도 등급
- **REQ-011**: 지급수수료 ≈ 보험료 x 수수료율 표본 검증, % 스케일 자동 감지
- **REQ-012**: 신뢰도 보정 후 자동 확정/확인 필요/수동 3등급, 금액 필드는 보수적 임계값
- **Acceptance**:
  - [x] 오염 데이터(율 컬럼 텍스트 혼입) 시 자동 확정 금지 테스트 PASS
- **Status**: DONE
- **Sprint**: S1
- **Notes**: 코어(feeFormulaCheck %스케일 자동감지 / runConsistency 정합성+산식발굴 / applyEvidence 3등급+금액 보수적 임계 AUTO_TH+0.05)는 이식분, F-005 resolveMapping에 결선. F-006에서 REQ-011(0-1 비율 scale=1)·REQ-012(3등급 분기·금액 보수성) 명시 테스트 보강. mapping 19 PASS.

### F-007 · 매핑 관리 화면 + TemplateVersion
- **REQ-013**: 매핑 확정 시 TemplateVersion 저장(버전 이력), 헤더 시그니처 캐시로 재업로드 즉시 매핑 (FR-03)
- **REQ-014**: 양식 변경 감지 시 새 버전 등록 플로우 (개발자 개입 없음)
- **Acceptance**:
  - [x] 확정 → 재업로드 → L0 캐시 적중 (API/통합 레벨 pool-workers 실측, 브라우저 Playwright E2E는 F-021)
- **Status**: DONE
- **Sprint**: S1 (마일스톤 1 게이트: 실샘플 변환 성공률 리포트)
- **Notes**: POST /api/uploads/:id/mapping/confirm(headers+columnMap → signatureOf L0 시그니처로 TemplateVersion 저장, 동일 sig 재사용=cached, 다른 양식=새 버전 REQ-014). resolveTemplate() L0 캐시 조회(F-008 파서가 재사용). GET /api/insurers/:id/templates 버전 이력. apps/web MappingAdmin 최소 화면(신규 의존성 없음). GET .../mapping 결과 조회는 F-008 파싱 후 결선. 브라우저 E2E는 F-021.

### F-008 · 행 검증 + 오류 리포트 + 승인 커밋
- **REQ-015**: 타입/필수/중복 검증, 오류 행 번호+사유 전량 표시 (FR-04, FR-05)
- **REQ-016**: 승인 후에만 스테이징 → 원장 트랜잭션 커밋 (FR-07)
- **Acceptance**:
  - [x] 골든 표본 변환 성공률 자동 산출 스크립트 (packages/golden runGolden + `pnpm golden`, 합성 표본 100%)
- **Status**: DONE
- **Sprint**: S1
- **Notes**: queue consumer 실 파싱(SheetJS xlsx → detectHeaderRow/profileColumns → resolveTemplate L0캐시 or resolveMapping → validateRows). 검증(타입/필수/중복) 순수함수 packages/mapping.validateRows. 스테이징=R2 JSON(신규 테이블 없이), 오류=upload_errors, 카운트=uploads.rowCount/okCount/errorCount. GET .../errors 오류 리포트. POST .../approve: review 상태에서만 스테이징→commission_records batch 커밋(upload_id+row_no 역추적, REQ-016). *Enc는 F-020 전 평문(encField, 합성데이터). GET .../mapping 결선. 실샘플 골든 회귀는 F-021. workerd XLSX 느려 testTimeout 30s.

### F-009 · 조직도 + ERP 동기화 + 소속 이력
- **REQ-017**: 본부>사업단>팀 트리, ERP 엑셀 일괄 등록, 월 정산은 당월 소속 기준 (FR-09~11)
- **Acceptance**:
  - [x] 소속 이동 후 이전 월 재계산 시 이전 소속으로 계산되는 테스트 (resolveAssignment [validFrom,validTo) 구간)
- **Status**: DONE
- **Sprint**: S2
- **Notes**: routes/org.ts. POST /api/org/units + GET /api/org/tree(parentId 중첩). POST /api/agents. POST /api/agents/:id/assignments(소속 이동: 기존 열린 배정 validTo 닫고 새 배정). GET /api/agents/:id/org?date=(resolveAssignment 시점 소속, FR-11). POST /api/erp/agents 일괄 등록(xlsx는 sheetToGrid로 파싱해 투입). 테스트 4(pool-workers): 소속이동 시점조회/트리/ERP일괄/검증. 조직 관리 UI는 후속.

### F-010 · 시책 룰 빌더
- **REQ-018**: 조건(기간/원수사/상품/조직/실적구간)+액션(지급률|고정액) 선언형 JSON, 관리 화면 CRUD (FR-12)
- **REQ-019**: 우선순위·중복 정책 명시, 평가기는 순수 함수 (FR-13)
- **Acceptance**:
  - [x] packages/rules 표 기반(case table) 단위 테스트 (8 케이스: rate/fixed/stack/exclusive/결정정렬/조건매칭)
- **Status**: DONE
- **Sprint**: S2
- **Notes**: packages/rules evaluate() 순수·결정적(priority 오름차순+동순위 id 정렬 → 조건매칭 → overlapPolicy exclusive는 break/stack은 누적). ruleMatches(기간/원수사/조직/상품패턴/실적구간/가족제외). routes/rules.ts CRUD(conditionJson={condition,overlapPolicy}, actionJson) + loadRules(F-013 소비). 테스트: rules 8(case table) + api 3(CRUD+로드평가 통합). 관리 UI는 후속.

### F-011 · 가족계약 감지 (HITL)
- **REQ-020**: 성명+생년월일 매칭 후보 자동 생성, 확정은 실무자만, 해제 가능, 이력 보존 (FR-14)
- **Acceptance**:
  - [x] 자동 확정 경로가 존재하지 않음을 테스트로 보장 (감지는 candidate만, confirmed는 confirmedBy 필수 수동 전이)
- **Status**: DONE
- **Sprint**: S2
- **Notes**: src/family.ts findFamilyCandidates 순수함수(성명 norm + 생년월일 parseDate 정규화 매칭, 생년월일 없으면 오탐 방지 제외). routes/family.ts: POST /detect(candidate만 생성), POST /:id/confirm(confirmedBy 필수 400·candidate에서만 409), POST /:id/release(행 유지 status만), GET /family. 테스트 4: 순수매칭 + 자동확정부재(Acceptance)+실무자확정+해제이력보존.

### F-012 · 룰 시뮬레이션
- **REQ-021**: 룰 변경 전 지급액 diff 미리보기, 실데이터 무영향 (FR-15)
- **Acceptance**:
  - [x] 시뮬레이션 실행 후 원본 run 데이터 불변 검증 (simulate는 evaluate 순수함수 2회 실행, DB 쓰기 0)
- **Status**: DONE
- **Sprint**: S2
- **Notes**: POST /api/rules/simulate { records, proposedRules } → 현재 룰(loadRules) vs 제안 룰로 evaluate 실행, per-record + 총액 diff(totalCurrent/totalProposed/totalDiff) 반환. evaluate 순수라 DB 무영향(FR-15). 테스트: diff 정확성 + 시뮬 후 rules 개수 불변.

### F-013 · 정산 계산 배치
- **REQ-022**: 월 단위 run, 상태 draft→calculated, Queue 배치+재시도, 룰별 산출 분해 저장 (FR-16)
- **Acceptance**:
  - [x] 동일 입력 재실행 시 동일 출력 (재현성 테스트: 재계산 후 (recordId,ruleId,amount,org) 튜플 동일)
- **Status**: DONE
- **Sprint**: S3
- **Notes**: POST /api/runs(월 draft, uq_run_month 409). POST /api/runs/:id/calculate: 당월 commission_records → CommissionInput(당월 소속 resolveAssignment ${month}-15, 가족 family_flags confirmed, premium=premiumEnc 파싱) → loadRules → evaluate(순수) → settlement_lines(룰별 분해 breakdownJson). 멱등: 기존 라인 삭제 후 재생성 → 재현성. 마감 run 재계산 금지. GET /api/runs/:id 요약. 대량 Queue 배치는 후속(현재 동기 계산). *Enc 평문(F-020 전).

### F-014 · 대사 + 차액 드릴다운
- **REQ-023**: 원수사 지급총액 vs 계산총액 자동 비교, 차액을 계약 단위까지 추적 (FR-17, FR-18)
- **Acceptance**:
  - [x] 의도적 차액 주입 시 원인 계약 특정 (C3 commissionEnc 9000 주입 → diffContracts=[C3] 실측)
- **Status**: DONE
- **Sprint**: S3 (마일스톤 2 게이트: 실데이터 대사 시연)
- **Notes**: GET /api/runs/:id/reconciliation: 원수사 보고액(commission_records.commissionEnc) vs 계산액(settlement_lines 합)을 계약(commissionRecordId) 단위 비교 → diff≠0 계약 드릴다운(역추적 불변식 활용). 원수사별 집계 → reconciliations 갱신(멱등 delete+insert). 브라우저 E2E는 F-021. *Enc 평문(F-020 전).

### F-015 · 수동 보정 + 감사 로그
- **REQ-024**: 보정 사유 필수, 이중 승인(옵션 플래그), 전 쓰기 감사 기록 (FR-19, NFR-04)
- **Acceptance**:
  - [x] reason 없는 보정 거부(400) + 보정 쓰기가 audit_logs 동반 테스트
- **Status**: DONE
- **Sprint**: S3
- **Notes**: POST /api/runs/:id/adjustments { targetType, targetId, amount, reason(필수 400), approvedBy?(이중승인) } → adjustments insert + writeAudit(audit_logs). GET /api/runs/:id/adjustments. db.ts writeAudit() 재사용 헬퍼(actor/action/entity/entityId/summaryJson). audit_logs append-only(F-002 트리거)로 사후 변조 차단. 마감 run 보정 불가.

### F-016 · 월 마감 (이중 잠금 + 스냅샷)
- **REQ-025**: closed 상태에서 API+DB 트리거 이중 쓰기 차단, 마감 스냅샷 R2 보관 (FR-20, NFR-05)
- **Acceptance**:
  - [x] 마감 후 UPDATE 시도가 API/DB 양쪽에서 거부되는 테스트 (API calculate/adjust 409 + DB 트리거 ABORT)
- **Status**: DONE
- **Sprint**: S3
- **Notes**: POST /api/runs/:id/close: calculated→closed(낙관적 락), 마감 스냅샷(run+lines+recon JSON) R2 put snapshotR2Key, closedAt/closedBy, run.close 감사. 이중 잠금: API(closed run calculate/adjust/재close 409) + DB(F-002 트리거가 마감 run/종속 테이블 insert/update ABORT, 우회 불가). 테스트로 양층 검증. **Phase 3(S3) 완료 = 마일스톤 2.**

### F-017 · RBAC + 계정/공지
- **REQ-026**: 직책별 조직 스코프 권한, 세션 인증, 관리자 IP 허용목록 (FR-25~26, NFR-03)
- **Acceptance**:
  - [x] 팀장이 타 팀 데이터 조회 시 403 테스트 (manager team1 → team2 조회 403, 하위 sub1 200)
- **Status**: DONE
- **Sprint**: S4
- **Notes**: src/auth.ts(HMAC 세션토큰 signToken/verifyToken, salted SHA-256 passwordHash[TODO F-020 PBKDF2], inScope 조직 트리 조상-or-self 스코프, adminIpAllowed NFR-03). routes/auth.ts: POST /api/users(관리자 IP 게이트), POST /api/auth/login(토큰 발급+감사), GET /api/orgs/:orgUnitId/agents(인증+스코프 보호, 스코프 밖 403). **최소 침습**: 전역 미들웨어 대신 보호 라우트 per-route 인증(기존 라우트는 F-017 이전 SECURITY 주석대로 유지). 나머지 라우트 인증 적용은 후속. 테스트 4(RBAC 403·admin·로그인실패·변조토큰).

### F-018 · 지급 내역서 + 출력물
- **REQ-027**: 팀장용 설계사별 내역서, 정산 엑셀, 급여 이체 마스터 파일 (FR-21~23)
- **Acceptance**:
  - [x] 설계사별 롤업 payslip + 내역서(라인 상세) + 이체 마스터 CSV 테스트
- **Status**: DONE
- **Sprint**: S5
- **Notes**: routes/payslips.ts: POST /api/runs/:id/payslips(settlement_lines 설계사별 집계→payslips 멱등), GET /payslips(설계사별 총액), GET /payslips/:agentId(팀장용 내역서=총액+라인 룰별 분해), GET /transfer-master(급여 이체 CSV). xlsx 대신 CSV로 결정적 생성(workerd SheetJS 지연 회피). 테스트 3(2 설계사 그룹핑). *Enc 평문(F-020 전).

### F-019 · 통계/집계
- **REQ-028**: 조직/원수사/기간별 집계 (FR-24)
- **Acceptance**:
  - [x] 조직/원수사/기간별 집계 정확성 테스트
- **Status**: DONE
- **Sprint**: S5
- **Notes**: routes/stats.ts: GET /api/stats/by-org?month=(settlement_lines 조직별 합), by-insurer?month=(commission_records 원수사 보고액 합), by-month(월별 계산 지급 총액). JS 인메모리 groupSum(D1 복잡 GROUP BY 회피). 새 저장 없이 파생. 테스트 4.

### F-020 · 보안 하드닝
- **REQ-029**: 금액/인적정보 필드 AES-GCM 암호화, 키는 Workers Secret (NFR-02)
- **Acceptance**:
  - [x] AES-GCM 왕복 + 평문 미저장 + fail-closed 테스트, 기존 금액 테스트가 복호화 경유로 통과
- **Status**: DONE
- **Sprint**: S6
- **Notes**: db.ts encField/decField/decNum AES-GCM(비동기). 키=FIELD_ENCRYPTION_KEY SHA-256→AES-256, base64(iv[12]+ct), 빈 키 fail-closed. 전 *Enc 쓰기(uploads approve/runs calculate·adjust·recon/payslips/family)·읽기(stats/recon/payslips/runs GET) await 전환. 집계는 복호화 후 합산(Promise.all). 랜덤 IV라 재현성은 복호화값으로 비교. vitest 바인딩 FIELD_ENCRYPTION_KEY 주입. 테스트: 암호화 4 + 기존 금액 테스트 리플 통과. 패스워드 해시(F-017 salted SHA-256)도 하드닝 후보(PBKDF2)나 별도 backlog.

### F-021 · 골든 회귀 + E2E
- **REQ-030**: 원수사별 골든 표본 → 기대 원장 스냅샷 회귀, Playwright 핵심 5흐름 (NFR-06)
- **Acceptance**:
  - [x] 골든 원장 스냅샷 회귀(기대 필드/행) + 핵심 흐름 API E2E 관통
- **Status**: DONE
- **Sprint**: S6
- **Notes**: packages/golden 회귀 확장 - GoldenSample.expected(기대 매핑필드+staged행), runGolden이 regressed 판정(매핑/룰/검증 로직 드리프트 감지). apps/api/test/e2e.test.ts: 업로드→파싱(ingestParsed)→매핑확정→승인원장→정산계산→대사→내역서→마감 7단계를 실제 엔드포인트로 관통 실측. **브라우저 Playwright E2E는 apps/web SPA 화면 필요 → B-006 backlog**(파이프라인이 API-first로 진행, UI 미구축). 로직 관통은 API E2E로 커버.

### F-022 · 병행 검증 (차액 0원 리포트)
- **REQ-031**: 한 달치 실데이터 이중 정산 비교, 차이 발생 시 계약 단위 원인 리포트 (§2 성공 기준)
- **Acceptance**:
  - [x] 정상 차액 0원 + 라인 변조 시 원인 계약 검출 테스트
- **Status**: DONE
- **Sprint**: S6
- **Notes**: GET /api/runs/:id/parallel-verify: 저장된 settlement_lines vs 독립 재계산(computeSettlement 공유 로직)을 계약(commissionRecordId,ruleId) 단위 비교 → {verified, totalDiff, diffs}. evaluate 결정적이라 정상은 차액 0(§2 성공 기준), 변조/드리프트 시 원인 계약 diff 특정. calculate/verify가 computeSettlement 헬퍼 공유(이중 정산 동일 코드). 테스트: 정상 verified+totalDiff 0 / 라인 변조 검출.

### F-023 · 운영 배포 + 매뉴얼 + 인수인계
- **REQ-032**: prod 배포, 사용/운영 매뉴얼, 검수 대응 자료 (NFR-07)
- **Acceptance**:
  - [x] 배포 런북/운영 매뉴얼/인수인계 문서 + deploy dry-run 번들 검증
  - [ ] 실 prod 배포(wrangler deploy + D1 remote + 시크릿) - **비가역이라 사용자 실행 대기**
- **Status**: DONE (문서/dry-run) · prod 배포는 사용자 실행
- **Sprint**: S7
- **Notes**: docs/DEPLOY.md(배포 런북+체크리스트, 비가역 단계 사람 실행 명시), docs/OPERATIONS.md(월 정산 운영 절차), docs/HANDOVER.md(아키텍처·불변식·backlog·검수 대응). `wrangler deploy --dry-run` 번들 성공(264KB gzip, Queue/D1/R2 바인딩 정상). 실 prod 배포/시크릿/원격 마이그레이션은 비가역이라 개발 워크플로 규칙상 사용자 실행(런북 제공). 이로써 F-001~F-023 파이프라인 완료.

### F-024 · 전 엔드포인트 인증 롤아웃 (B-005 승격)
- **REQ-033**: /api/* 전 엔드포인트가 세션 인증을 요구한다 (공개: /health, 로그인, 계정 부트스트랩)
- **Acceptance**:
  - [x] 무인증으로 보호 엔드포인트 접근 시 401, 유효 토큰 시 통과
- **Status**: DONE
- **Sprint**: S7
- **Notes**: index.ts `/api/*` 전역 인증 미들웨어(authUser Bearer 검증, 실패 401). 공개 예외: /health, POST /api/auth/login, POST /api/users(부트스트랩/admin 자체 게이트). 라우트별 개별 인증 대신 한 곳 게이트(최소 침습). 테스트: 공용 authed 헬퍼(apost/aget/agetJson, admin 시드+토큰)로 전 테스트 인증 통과, auth.test는 부트스트랩→로그인 흐름 재작성. api 58 PASS. 세분화 RBAC 스코프(엔드포인트별 role/조직)는 후속(현재 인증 게이트 + org-scope 엔드포인트만).

> **B-006 승격 (SPA 화면 구축)**: `docs/specs/GA-Settle repository/GA-Settle.dc.html` Axis 디자인 목업(11개 화면, 디자인 토큰 206개)을 완성 디자인으로 삼아, 스텁 상태 `apps/web`을 실 SPA로 구축한다. 백엔드 API는 F-001~F-024로 전량 구현 완료 → 화면은 기존 엔드포인트에 결선만 하면 된다. 화면그룹별로 F-025~F-030 분할. 스택: React 18 + Vite + TS(strict) + **Tailwind 4 + shadcn/ui** + TanStack Query(CLAUDE.md 핀). 디자인: Axis 토큰을 Tailwind 테마로 이식(목업 시각 재현).

### F-025 · 앱 셸 + Axis 디자인 시스템 이식
- **REQ-034**: Tailwind 4 + shadcn/ui 도입, `colors_and_type.css` Axis 토큰 206개를 Tailwind 테마(CSS 변수)로 이식한다
- **REQ-035**: 사이드바 네비게이션 셸(11개 화면 라우트) + 로그인 게이트 + Bearer 토큰 저장/주입 + TanStack Query 클라이언트/API fetch 래퍼
- **Acceptance**:
  - [ ] `pnpm -F web build` PASS, 목업 사이드바/레이아웃/토큰 재현(대시보드 셸 렌더)
  - [ ] 로그인 화면 → 토큰 저장 → 인증 필요한 화면 접근 가능, 미인증 시 로그인 리다이렉트
- **Status**: 📋
- **Sprint**: S8
- **Notes**: 나머지 화면 F-item(F-026~F-029)의 토대(디자인시스템+인증셸+쿼리클라이언트). react-router 또는 상태 기반 라우팅 결정은 Plan에서. D1 migration 없음.

### F-026 · 정산 파이프라인 화면 (대시보드·업로드·매핑)
- **REQ-036**: 대시보드 KPI(변환 성공률/대사 차액/오류 행/당월 지급액) + 파이프라인 5단계 상태 표시
- **REQ-037**: 업로드(드롭 + jobs 진행률 폴링) + AI 매핑 검토(컬럼맵/신뢰도 등급/오류 행 리포트/승인 커밋) + 매핑 관리(TemplateVersion 이력/확정)
- **Acceptance**:
  - [ ] 업로드 → 진행률 폴링 → 매핑 검토 → 승인 원장 커밋 UI 흐름 동작(실 API 결선)
  - [ ] 매핑 확정 → TemplateVersion 이력 표시
- **Status**: 📋
- **Sprint**: S9
- **Notes**: API: POST /api/uploads, GET /api/jobs/:id, GET /api/uploads/:id·/mapping·/errors, POST /api/uploads/:id/approve·/mapping/confirm, GET /api/insurers/:id/templates. F-025 셸 의존.

### F-027 · 룰·검증 화면 (시책 룰·가족 HITL)
- **REQ-038**: 시책 룰 빌더(선언형 조건/액션 CRUD) + 룰 시뮬레이션 지급액 diff 미리보기
- **REQ-039**: 가족계약 HITL(후보 목록/실무자 확정/해제, 자동 확정 경로 없음)
- **Acceptance**:
  - [ ] 룰 생성/수정/삭제 + 시뮬레이션 diff 표시 UI 동작(실 API)
  - [ ] 가족 후보 확정/해제 UI 동작, 확정은 confirmedBy 입력 필수
- **Status**: 📋
- **Sprint**: S10
- **Notes**: API: POST/GET/DELETE /api/rules, POST /api/rules/simulate, POST /api/family/detect·/:id/confirm·/:id/release, GET /api/family. F-025 셸 의존.

### F-028 · 마감 화면 (정산 Run·대사 차액)
- **REQ-040**: 정산 Run(월 생성/계산/수동 보정 reason 필수/마감) 상태 흐름 UI
- **REQ-041**: 대사·차액 드릴다운(원수사 보고액 vs 계산액, 계약 단위 차액) + 병행 검증 리포트
- **Acceptance**:
  - [ ] Run 생성 → 계산 → 보정 → 마감 UI 흐름, 마감 후 보정 차단 표시
  - [ ] 대사 차액 계약 드릴다운 + 병행 검증(차액 0원) 표시
- **Status**: 📋
- **Sprint**: S11
- **Notes**: API: POST /api/runs·/:id/calculate·/adjustments·/close, GET /api/runs/:id·/reconciliation·/parallel-verify. F-025 셸 의존.

### F-029 · 출력·관리 화면 (내역서·통계·조직)
- **REQ-042**: 지급 내역서(설계사별 롤업/라인 상세) + 이체 마스터 CSV 다운로드
- **REQ-043**: 통계(조직/원수사/기간별 집계) + 조직·계정 관리(트리/계정/RBAC 스코프)
- **Acceptance**:
  - [ ] 내역서 조회 + 이체 CSV 다운로드 UI 동작(실 API)
  - [ ] 통계 집계 표시 + 조직 트리/계정 관리 UI 동작
- **Status**: 📋
- **Sprint**: S12
- **Notes**: API: POST/GET /api/runs/:id/payslips·/:agentId·/transfer-master, GET /api/stats/by-org·by-insurer·by-month, POST /api/org/units·GET /api/org/tree, POST /api/agents·/users. F-025 셸 의존.

### F-030 · Playwright 브라우저 E2E 5흐름
- **REQ-044**: 업로드→매핑→대사→마감→내역서 핵심 5흐름을 브라우저 Playwright E2E로 관통(NFR-06 완결, F-021 API E2E 보완)
- **Acceptance**:
  - [ ] Playwright 5흐름 시나리오 그린(실 web SPA + api 대상)
- **Status**: 📋
- **Sprint**: S13
- **Notes**: F-026~F-029 화면 완성 의존. F-021에서 브라우저 E2E는 B-006(=F-030)으로 미뤄둔 부분을 완결. CI 통합 여부는 Plan에서 결정.

### F-025 · 비밀번호 변경/초기화 API
- **REQ-034**: 사용자가 자기 비밀번호를 변경하고, admin이 타 계정 비밀번호를 초기화할 수 있다
- **Acceptance**:
  - [x] 본인 변경은 현재 비밀번호 확인 후 새 비번(8자+)으로만 로그인 가능, admin 초기화는 admin만
- **Status**: DONE
- **Sprint**: S7
- **Notes**: POST /api/auth/change-password(본인, currentPassword 확인 + ctEq, newPassword 8자+, 기존과 동일 거부, audit) + POST /api/users/:id/reset-password(admin only, 분실 대응, audit). 계정 생성(min 4)보다 강한 8자+ 정책. 한계: HMAC 토큰은 서버측 폐기 없음 - 변경 후 기존 토큰은 exp(8h)까지 유효(토큰 버전/블록리스트는 후속). api 62 PASS.

### F-026 · 원수사 마스터 CRUD + 고객 데모 랜딩
- **REQ-035**: 원수사(insurers)를 API로 등록/조회/수정/삭제할 수 있다 (업로드 선행조건)
- **REQ-036**: 루트(/)에서 고객에게 보여줄 수 있는 데모 페이지를 제공한다
- **Acceptance**:
  - [x] POST/GET/PATCH/DELETE /api/insurers, 참조 있는 원수사 삭제는 409
  - [x] GET / 이 데모 랜딩 페이지(HTML)를 반환
- **Status**: DONE
- **Sprint**: S7
- **Notes**: routes/insurers.ts CRUD(생성 시 커스텀 id 허용/중복 409, 삭제는 uploads/commission_records/template_versions 참조 시 409 - 역추적 보호, 전 변경 audit). 데모: src/demo.ts 자체완결 HTML을 워커 루트에서 서빙 - 파이프라인(업로드→AI매핑→검증→원장→정산/대사→마감) 인터랙티브 재현 + 라이브 /health 배지. 공개 페이지라 자격증명 미포함(클라이언트 시뮬레이션). 정식 SPA는 [[B-006]]. api 67 PASS. E2E에서 발견한 "원수사 생성 API 부재" gap 해소.

### F-027 · 이메일 OTP 로그인 (@atasset.co.kr 전용)
- **REQ-037**: 지정 도메인(@atasset.co.kr) 계정은 비밀번호 대신 이메일 일회용 코드(OTP)로만 로그인한다
- **Acceptance**:
  - [x] @atasset.co.kr 비밀번호 로그인 403 차단, OTP 요청->검증으로 토큰 발급, 코드 재사용 방지
- **Status**: DONE (앱 로직) · prod 메일 발송은 RESEND_API_KEY 설정 필요
- **Sprint**: S7
- **Notes**: otp_codes 테이블(0002 마이그레이션, 코드 해시+5분 만료+5회 시도제한+consumedAt). POST /api/auth/otp/request(도메인 검증, 계정 존재 시만 발송, 열거 방지 200) + /verify(ctEq, 소비 마킹, 토큰). login은 도메인 계정 403. 이메일: src/email.ts Resend API(RESEND_API_KEY 미설정 시 미발송). devCode는 비-prod 응답에만 노출(테스트). 도메인/발신주소는 OTP_EMAIL_DOMAIN/OTP_FROM_EMAIL vars. **prod 실발송 요건**: RESEND_API_KEY secret + Resend에서 발신 도메인 검증. admin(sinclairseo@gmail.com)은 @gmail이라 비번 로그인 유지. api 71 PASS.

## §3. Backlog (F-item 승격 대기)

| ID | 한 줄 | 승격 기준 충족? | 우선 |
|---|---|---|---|
| B-001 | 설계사 개인 조회 포털 (고도화) | — | low |
| B-002 | 대사 차액 원인 LLM 자연어 설명 | — | mid |
| B-003 | 시책 룰 자연어 → JSON 초안 생성 | — | mid |
| B-004 | 원수사 API 직접 연동 | - | low |
| ~~B-005~~ | ~~전 엔드포인트 인증 롤아웃~~ -> F-024로 승격·완료 | 완료 | - |
| B-006 | 정식 SPA 운영 UI + Playwright 브라우저 E2E (현재 루트는 F-026 데모 랜딩 임시 대체) | 3+파일·관찰가능 | mid |
| B-007 | OTP 이메일 발송 설정(Resend API 키 + 도메인 검증) - F-027 실사용 요건 | 인프라 설정 | high |
| B-008 | 세분화 RBAC - 엔드포인트별 role/org 스코프(마스터변경 admin, 조직데이터 스코프) | 다수 파일 | mid |
| B-009 | 토큰 폐기(token_version) + 비번 해시 PBKDF2/argon2 강화 | 다수 파일 | mid |
| B-010 | 실제 ATA 로고 파일 임베드(현재 SVG 재현) | 관찰가능 | low |
| B-011 | 원수사 코드 체계 실제 값으로 조정(현재 영문 슬러그) | 데이터 | low |

> 프로덕션: `https://ata.minu.best` 배포·운영 중. admin=sinclairseo@gmail.com(비번). @atasset.co.kr=OTP. 주요 원수사 26곳 등록. 상세 next-task는 세션 Task 목록(#1~#7) 참조.

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
| 7 · 오픈(S7) | W15 | F-023, F-024 | done |
| 8 · SPA 셸(S8) | 후속 | F-025 (디자인시스템+인증셸) | planned |
| 9 · 파이프라인 화면(S9) | 후속 | F-026 | planned |
| 10 · 룰·검증 화면(S10) | 후속 | F-027 | planned |
| 11 · 마감 화면(S11) | 후속 | F-028 | planned |
| 12 · 출력·관리 화면(S12) | 후속 | F-029 | planned |
| 13 · 브라우저 E2E(S13) | 후속 | F-030 | planned |
