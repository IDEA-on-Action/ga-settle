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
  - [x] `pnpm -F web build` PASS, 목업 사이드바/레이아웃/토큰 재현(대시보드 셸 렌더)
  - [x] 로그인 화면 → 토큰 저장 → 인증 필요한 화면 접근 가능, 미인증 시 로그인 리다이렉트
- **Status**: DONE
- **Sprint**: S8
- **Notes**: 나머지 화면 F-item(F-026~F-029)의 토대(디자인시스템+인증셸+쿼리클라이언트). react-router 또는 상태 기반 라우팅 결정은 Plan에서. D1 migration 없음.

### F-026 · 정산 파이프라인 화면 (대시보드·업로드·매핑)
- **REQ-036**: 대시보드 KPI(변환 성공률/대사 차액/오류 행/당월 지급액) + 파이프라인 5단계 상태 표시
- **REQ-037**: 업로드(드롭 + jobs 진행률 폴링) + AI 매핑 검토(컬럼맵/신뢰도 등급/오류 행 리포트/승인 커밋) + 매핑 관리(TemplateVersion 이력/확정)
- **Acceptance**:
  - [x] 업로드 → 진행률 폴링 → 매핑 검토 → 승인 원장 커밋 UI 흐름 동작(실 API 결선)
  - [x] 매핑 확정 → TemplateVersion 이력 표시
- **Status**: DONE
- **Sprint**: S9
- **Notes**: API: POST /api/uploads, GET /api/jobs/:id, GET /api/uploads/:id·/mapping·/errors, POST /api/uploads/:id/approve·/mapping/confirm, GET /api/insurers/:id/templates. F-025 셸 의존.

### F-027 · 룰·검증 화면 (시책 룰·가족 HITL)
- **REQ-038**: 시책 룰 빌더(선언형 조건/액션 CRUD) + 룰 시뮬레이션 지급액 diff 미리보기
- **REQ-039**: 가족계약 HITL(후보 목록/실무자 확정/해제, 자동 확정 경로 없음)
- **Acceptance**:
  - [x] 룰 생성/수정/삭제 + 시뮬레이션 diff 표시 UI 동작(실 API)
  - [x] 가족 후보 확정/해제 UI 동작, 확정은 confirmedBy 입력 필수
- **Status**: DONE
- **Sprint**: S10
- **Notes**: API: POST/GET/DELETE /api/rules, POST /api/rules/simulate, POST /api/family/detect·/:id/confirm·/:id/release, GET /api/family. F-025 셸 의존.

### F-028 · 마감 화면 (정산 Run·대사 차액)
- **REQ-040**: 정산 Run(월 생성/계산/수동 보정 reason 필수/마감) 상태 흐름 UI
- **REQ-041**: 대사·차액 드릴다운(원수사 보고액 vs 계산액, 계약 단위 차액) + 병행 검증 리포트
- **Acceptance**:
  - [x] Run 생성 → 계산 → 보정 → 마감 UI 흐름, 마감 후 보정 차단 표시
  - [x] 대사 차액 계약 드릴다운 + 병행 검증(차액 0원) 표시
- **Status**: DONE
- **Sprint**: S11
- **Notes**: API: POST /api/runs·/:id/calculate·/adjustments·/close, GET /api/runs/:id·/reconciliation·/parallel-verify. F-025 셸 의존.

### F-029 · 출력·관리 화면 (내역서·통계·조직)
- **REQ-042**: 지급 내역서(설계사별 롤업/라인 상세) + 이체 마스터 CSV 다운로드
- **REQ-043**: 통계(조직/원수사/기간별 집계) + 조직·계정 관리(트리/계정/RBAC 스코프)
- **Acceptance**:
  - [x] 내역서 조회 + 이체 CSV 다운로드 UI 동작(실 API)
  - [x] 통계 집계 표시 + 조직 트리/계정 관리 UI 동작
- **Status**: DONE
- **Sprint**: S12
- **Notes**: API: POST/GET /api/runs/:id/payslips·/:agentId·/transfer-master, GET /api/stats/by-org·by-insurer·by-month, POST /api/org/units·GET /api/org/tree, POST /api/agents·/users. F-025 셸 의존.

### F-030 · Playwright 브라우저 E2E 5흐름
- **REQ-044**: 업로드→매핑→대사→마감→내역서 핵심 5흐름을 브라우저 Playwright E2E로 관통(NFR-06 완결, F-021 API E2E 보완)
- **Acceptance**:
  - [x] Playwright 5흐름 시나리오 그린(실 web SPA + api 대상)
- **Status**: DONE
- **Sprint**: S13
- **Notes**: F-026~F-029 화면 완성 의존. F-021에서 브라우저 E2E는 B-006(=F-030)으로 미뤄둔 부분을 완결. CI 통합 여부는 Plan에서 결정.

### F-031 · 비밀번호 변경/초기화 API
- **REQ-045**: 사용자가 자기 비밀번호를 변경하고, admin이 타 계정 비밀번호를 초기화할 수 있다
- **Acceptance**:
  - [x] 본인 변경은 현재 비밀번호 확인 후 새 비번(8자+)으로만 로그인 가능, admin 초기화는 admin만
- **Status**: DONE
- **Sprint**: S7
- **Notes**: POST /api/auth/change-password(본인, currentPassword 확인 + ctEq, newPassword 8자+, 기존과 동일 거부, audit) + POST /api/users/:id/reset-password(admin only, 분실 대응, audit). 계정 생성(min 4)보다 강한 8자+ 정책. 한계: HMAC 토큰은 서버측 폐기 없음 - 변경 후 기존 토큰은 exp(8h)까지 유효(토큰 버전/블록리스트는 후속). api 62 PASS.

### F-032 · 원수사 마스터 CRUD + 고객 데모 랜딩
- **REQ-046**: 원수사(insurers)를 API로 등록/조회/수정/삭제할 수 있다 (업로드 선행조건)
- **REQ-047**: 루트(/)에서 고객에게 보여줄 수 있는 데모 페이지를 제공한다
- **Acceptance**:
  - [x] POST/GET/PATCH/DELETE /api/insurers, 참조 있는 원수사 삭제는 409
  - [x] GET / 이 데모 랜딩 페이지(HTML)를 반환
- **Status**: DONE
- **Sprint**: S7
- **Notes**: routes/insurers.ts CRUD(생성 시 커스텀 id 허용/중복 409, 삭제는 uploads/commission_records/template_versions 참조 시 409 - 역추적 보호, 전 변경 audit). 데모: src/demo.ts 자체완결 HTML을 워커 루트에서 서빙 - 파이프라인(업로드→AI매핑→검증→원장→정산/대사→마감) 인터랙티브 재현 + 라이브 /health 배지. 공개 페이지라 자격증명 미포함(클라이언트 시뮬레이션). 정식 SPA는 [[B-006]]. api 67 PASS. E2E에서 발견한 "원수사 생성 API 부재" gap 해소.

### F-033 · 이메일 OTP 로그인 (@atasset.co.kr 전용)
- **REQ-048**: 지정 도메인(@atasset.co.kr) 계정 로그인. OTP 강제(OTP_ENFORCED) 시 이메일 코드 전용, 미강제(기본) 시 임시 비밀번호 + 첫 로그인 강제 변경.
- **Acceptance**:
  - [x] OTP 앱 로직: 요청->검증 토큰 발급, 코드 재사용 방지, 5분 만료/5회 제한
  - [x] SPA 로그인 UI: 비번-우선 + 서버 403{otp:true} 폴백 시 OTP 코드 흐름 (Playwright E2E)
  - [x] 임시 비번 대체 흐름: OTP 미강제(기본) 시 @도메인 비번 로그인 허용, admin reset -> mustChangePassword -> 강제 변경 화면 (Playwright E2E)
- **Status**: DONE (앱 로직 + UI + 임시 비번 대체 흐름) · OTP 실발송은 ATA Resend 계정 + atasset.co.kr 도메인 검증 시 OTP_ENFORCED=true로 활성
- **Sprint**: S7
- **Notes**: otp_codes 테이블(0002), users.must_change_password(0003). OTP 엔드포인트(request/verify)는 그대로 보존. **OTP_ENFORCED env(기본 off)**: off면 @도메인 계정도 임시 비번 로그인 허용(login 403 게이트가 `isOtpEmail && otpEnforced`), on이면 비번 403{otp:true}->OTP 전용. **임시 비번 흐름**: admin `POST /api/users/:id/reset-password`가 mustChangePassword=true 세팅 -> login 응답에 플래그 -> 프론트 ProtectedLayout이 /change-password로 강제 -> `POST /api/auth/change-password`가 플래그 해제. UI: screens/Login.tsx(비번-우선, 403 폴백 OTP), screens/ChangePassword.tsx(강제 변경), lib/auth.tsx(requestOtp/verifyOtp/changePassword). E2E: e2e/06(OTP 폴백), e2e/07(임시 비번 강제변경). 이메일: src/email.ts Resend API. devCode는 비-prod 응답에만 노출. **OTP 실발송 재활성 요건**: ATA(생각과 행동) 소유 Resend 계정 + atasset.co.kr DNS 검증 + RESEND_API_KEY + OTP_ENFORCED=true. ⚠️ ktds.io 계정 키는 거버넌스(ktds 자산 금지)로 사용 불가. admin(@gmail)은 비번 로그인 유지. api 72 PASS + web E2E 9 PASS.

### F-034 · 데모 사용 가이드 + 인라인 온보딩
- **REQ-049**: 고객이 데모 사용법을 사이트에서 확인하고 문서(PDF)로 내려받을 수 있다
- **REQ-050**: 화면에서 사용자에게 인라인 가이드(화면별 도움말 + 첫 방문 투어)를 제공한다
- **Acceptance**:
  - [x] SPA `/app/guide` 화면: 전체 파이프라인 8단계 가이드 + 'PDF 내려받기' + '화면 투어 다시 보기'
  - [x] 가이드 PDF 공개 서빙(`/guide/GA-Settle-사용가이드.pdf`), 데모 랜딩(/)에서 다운로드 링크
  - [x] 화면별 인라인 도움말: TopBar '도움말' 팝오버(현재 경로별 요약+포인트)
  - [x] 첫 로그인 후 1회 자동 스포트라이트 투어(localStorage 플래그, 재시작 가능)
- **Status**: DONE
- **Sprint**: S8
- **Notes**: 고객 피드백("데모 사용 어려움") 대응. 단일 소스 `apps/web/src/content/guide.ts`(guideSteps 8단계 + screenHelp 화면별 + tourSteps)를 Guide 화면·HelpPanel·Tour가 공유. PDF는 `scripts/build-guide-pdf.mjs`(Node 타입스트리핑으로 guide.ts 직접 import + @playwright/test chromium, Noto Sans KR 웹폰트)로 생성 → `public/guide/`(vite가 dist 복사, 공개 자산). 인라인 가이드 무의존성 구현: Tour는 box-shadow 스포트라이트 + 뷰포트 클램프 위치계산, 사이드바 nav에 `data-tour="nav-{path}"` 앵커. routes.tsx에 'help' 그룹/`/guide` 라우트 추가(registry 단일 지점). API 변경 없음. 문구 수정 시 guide.ts 편집 후 `pnpm -F web guide:pdf` 재생성.

### F-035 · 원수사 선택 드롭다운 (입력 진입장벽 제거)
- **REQ-051**: 업로드·매핑관리에서 원수사를 id 손입력이 아닌 목록에서 선택한다
- **Acceptance**:
  - [x] 업로드 화면 insurerId 입력 → `GET /api/insurers` 기반 드롭다운(이름 표시/ id 전송)
  - [x] 매핑관리 화면 insurerId도 동일 드롭다운
  - [x] Upload.tsx 낡은 주석("GET /api/insurers 부재") 제거
- **Status**: DONE
- **Sprint**: S8
- **Notes**: PRD `docs/prd/demo-input-ux`. 프론트 전용(API 기존 F-032). 공용 선택기 `components/pickers/EntitySelects.tsx`(InsurerSelect) + `lib/pickers.ts` 훅. 브라우저 검증: AIA생명/삼성생명 이름 드롭다운 실동작.

### F-036 · 업로드 목록 API + 최근 업로드 선택기
- **REQ-052**: uploadId를 손으로 복사하지 않고 최근 업로드 목록에서 선택한다
- **Acceptance**:
  - [x] `GET /api/uploads` 신규: 최근 업로드(id, 원수사, 정산월, 상태, 시각) - 민감정보 제외
  - [x] AI매핑검토·매핑관리·대시보드의 uploadId 입력을 선택기로 대체(최근순 라벨)
- **Status**: DONE
- **Sprint**: S8
- **Notes**: PRD `docs/prd/demo-input-ux`. 목록 API 조회 전용(원수사명 조인, r2Key/해시 제외 - 테스트로 검증). 선택기 라벨 "원수사명·월·상태". 브라우저 검증: "AIA생명 · 2026-07 · review".

### F-037 · 정산 Run 목록 API + 월/Run 선택기
- **REQ-053**: run id를 손으로 복사하지 않고 월/Run 목록에서 선택한다
- **Acceptance**:
  - [x] `GET /api/runs` 신규: Run 목록(id, 정산월, 상태, 시각)
  - [x] 대사·내역서·대시보드의 run id 입력을 월·상태 라벨 선택기로 대체
- **Status**: DONE
- **Sprint**: S8
- **Notes**: PRD `docs/prd/demo-input-ux`. 목록 API 조회 전용. 브라우저 검증: "2026-07 · draft" 선택기.

### F-038 · 승인자·확정자 로그인 사용자 자동 반영
- **REQ-054**: 보정/마감/가족확정의 승인자·확정자를 로그인 사용자로 자동 기록한다
- **Acceptance**:
  - [x] 보정(등록자)·마감(closedBy)·가족확정(확정자) 자유입력 → 로그인 사용자 자동 기록
  - [x] 서버가 authUser로 신원 재확인 후 감사 필드 기록(신뢰 경계=서버)
- **Status**: DONE
- **Sprint**: S8
- **Notes**: PRD `docs/prd/demo-input-ux`. 서버(runs.ts close/adjustments, family.ts confirm)가 authUser().email로 기록 - 본문 입력 무시(스푸핑 방지). 보정 이중 통제(등록자=로그인, approvedBy=선택적 별도 승인자) 유지. api 테스트 4건 추가(목록 2 + F-038 2), 총 76 PASS.

### F-039 · 원수사 등록 UI
- **REQ-055**: 화면에서 새 원수사(id+이름)를 등록할 수 있다 (API/시드 없이)
- **Acceptance**:
  - [x] 매핑관리 화면에 '새 원수사 등록' 폼(id+name) → POST /api/insurers
  - [x] 등록 성공 시 원수사 드롭다운 목록 즉시 갱신(invalidate)
- **Status**: DONE
- **Sprint**: S8
- **Notes**: PRD `docs/prd/demo-input-ux` 후속. 프론트 전용(POST /api/insurers 기존 F-032). 브라우저 검증: 한화생명 등록 → 드롭다운 즉시 반영.

### F-040 · 설계사 목록 API + 선택기
- **REQ-056**: 설계사 ID를 손입력이 아닌 목록에서 선택한다
- **Acceptance**:
  - [x] `GET /api/agents` 신규: 설계사 목록(id, code, name, status) - 이름순
  - [x] 가족계약 감지 화면의 '설계사 ID' 입력을 이름 선택기로 대체
- **Status**: DONE
- **Sprint**: S8
- **Notes**: PRD `docs/prd/demo-input-ux` 후속. AgentSelect(EntitySelects.tsx). 라벨 "이름(코드)". 브라우저 검증: 김영희(FC1001)·홍길동(FC1000).

### F-041 · 계약 선택기 (보정 대상)
- **REQ-057**: 보정 대상 계약을 손입력이 아닌 run 계약 목록에서 선택한다
- **Acceptance**:
  - [x] `GET /api/runs/:id/contracts` 신규: 해당 run 월의 계약(contractNo, agentId, productName) - 금액 제외
  - [x] 보정 화면 targetType=contract일 때 '대상 ID'를 계약 선택기로 대체
- **Status**: DONE
- **Sprint**: S8
- **Notes**: PRD `docs/prd/demo-input-ux` 후속. 원장 조회 금액(암호화) 제외 화이트리스트(불변식 5, 테스트 검증). targetType도 Select화(contract/line), line은 수동 유지. 브라우저 검증: "C001·FC1000·종신보험". api 테스트 +2(agents, contracts), 총 78 PASS.

### F-042 · 목록 페이지네이션 + 선택기 검색
- **REQ-058**: 목록이 50개를 넘어도 검색·페이지로 원하는 항목에 도달할 수 있다
- **Acceptance**:
  - [x] 목록 API(uploads/runs/agents/contracts/insurers/family/adjustments)에 `?q`(검색)·`?limit`·`?offset` + 응답 total
  - [x] 선택기(원수사·업로드·Run·설계사·계약)에 검색창(type-to-filter, 서버 ?q 연동)
  - [x] 가족계약·보정 테이블에 Prev/Next + 페이지·총건수
- **Status**: DONE
- **Sprint**: S8
- **Notes**: PRD `docs/prd/demo-input-ux` §7 마지막 backlog 승격. 공용 `pagination.ts`(pageParams). family/adjustments는 bare array→`{items,total}` 전환(소비자 갱신). 그 외 named key 유지+total 추가. SearchableSelect 무의존성 콤보박스(검색창+debounce 서버 ?q, 선택라벨 캐시). 공용 Pager. api 테스트 +3(검색/페이지 total), 총 81 PASS. 브라우저 검증: "삼성" 검색 필터·보정 12건 "1/2·이전/다음". 부수: Runs.tsx 낡은 "GET /api/runs 없음" 안내 정정(F-037로 존재).

### F-043 · OCR 시책안 인식 → 시책룰 (데모 + 실 엔진 연동)
- **REQ-059**: 매월 이미지 포스터로 오는 보험사 시책안을 담당자가 손으로 옮겨 적지 않고, OCR 추출값을 확인·보정만 해서 시책룰로 확정할 수 있다
- **REQ-060**: 확정된 시책룰은 원본 시책안 이미지·추출 이력과 연결되어, 지급 건에서 금감원 감사 근거 원본까지 역추적된다
- **Acceptance**:
  - [x] 데모에 시책안 이미지 → 좌(원본 이미지 목업)/우(추출 룰 필드) 대조 화면
  - [x] 추출 필드(지급률·배수·적용기간·대상)별 신뢰도 색 표시(저신뢰 강조)
  - [x] 저신뢰 값 담당자 보정 → 확정 액션 → 시책룰 등록 표현(확정자·수정이력)
  - [x] 원본 이미지 ↔ 확정 룰 역추적 + 3중 검증(신뢰도·확정·원본 보관) 메시지 노출
  - [x] 대표 포스터 2종(KB손보 주차시상 표밀집형, 한화손보 여성시대 장식폰트형) 시나리오
  - [x] **실 엔진 연동**: POST /api/incentive-plans/ocr - CLOVA OCR + Upstage 구조화 + R2 원본 보관(SHA-256 멱등), 인증 게이트. 실 포스터 실측 검증(한화 0.963/DB손보 0.873, 저신뢰 필드 색표시)
- **Status**: DONE (데모 PoC + 실 엔진 연동). 손보 318열 구조화·감사 소명은 F-044로 완료(B-012 종결)
- **Sprint**: S14
- **Notes**: 근거 자료 `docs/specs/고객제공자료/260708/` + 고객 문의답변(Q2) + OCR 정확도 검증 PDF. PRD·인터뷰 `docs/specs/req-ocr-sichaek/`(prd-final, 스코어 94/100·Ambiguity 0.125). 인터뷰 결정: 하이브리드 엔진·추출+룰 구조화·제안 데모 반영. 구현: (1) `apps/api/src/demo.ts` 좌우 대조 인터랙티브 플로우(포스터 2종 상태머신: 검토→보정→확정→역추적). (2) **실 연동** `src/ocr.ts`(clovaOcr General OCR + structureRule Upstage Solar, blended 신뢰도=LLM×OCR평균, 임계 0.85) + `routes/incentive-plans.ts` POST /api/incentive-plans/ocr(multipart 이미지→R2 `incentive-plans/{sha}.{ext}` 불변 보관→OCR→구조화, /api/* 인증 게이트 뒤). 시크릿은 `.dev.vars`(CLOVA_OCR_INVOKE_URL/SECRET, UPSTAGE_API_KEY/BASE_URL/MODEL). wrangler dev E2E 검증(한화 4통과/2확인, DB손보 6통과, 무인증 401). 실 OCR 엔진 상시 구동 배포(prod secret)·손보 318열·감사 화면은 [[B-012]].

### F-044 · 시상정의 카탈로그 (스키마 확장, B-012 분리 승격)
- **REQ-061**: 원수사가 준 시상정의 원형(기준월·상품·납입기간·지급시점·채널·지점·조건·적용률)을 무손실로 보관·조회할 수 있다
- **REQ-062**: 시상정의는 정산 엔진 운영 룰(incentive_rules)과 분리되어, 정의는 참조/후보로만 두고 확정 시 운영 룰로 파생한다
- **Acceptance**:
  - [x] `incentive_plan_definitions` 테이블(migration 0004) - 16열 무손실 + rate/fixed + 원본이미지 링크(planImageKey, F-043 역추적)
  - [x] 생보 시상정의 9,227건 무손실 반영(로컬+prod), incentive_rules의 lossy import분 제거(정산엔진 정리)
  - [x] GET /api/incentive-plan-definitions(?insurerId·?month·?q + 페이지네이션) + /summary(월별 집계), 인증 게이트
  - [x] 로컬+prod 배포·검증(defs 9,227·rules 2·insurers 33, summary 월별, 필터/검색 동작)
  - [x] **OCR→정의 write 결선**: POST /api/incentive-plan-definitions - 담당자 확정 행을 planImageKey(F-043 OCR 원본 R2 키) 연결해 저장(source_type=ocr), 확정자(createdBy) 인증사용자 자동·감사로그. 역추적: 정의→plan_image_key→원본 이미지
  - [x] **손보 318열 구조화**: wide 매트릭스(158 시상유형 그룹×2컬럼) unpivot → 5,363건(로컬+prod). 시상유형→cond1, 대상상품/기준→cond2, 실적기준→cond3, 지급시점(익월/2차년/익익월/익분기)→pay_timing, 지급율=rate/지급액=fixed. 총 정의 14,590(생보 9,227+손보 5,363)
  - [x] **정의→운영룰 확정 UI**: SPA `/app/plan-definitions`(시상정의 확정) - 원수사·월·검색 필터, 목록에 승격상태(promoted) 배지, 체크박스 선택 → POST /api/incentive-plan-definitions/promote(정의→incentive_rules, rule-{defId} 결정적·idempotent, condition/action 매핑, 감사). Playwright E2E(선택→확정→배지 후보→운영룰 전환)
  - [x] **감사 소명 화면**: SPA `/app/audit`(감사 소명) - 지급건/운영룰/시상정의 앵커 → GET /api/audit/incentive-trace(지급건→실적원본[upload+row]→운영룰→시상정의→원본 시책안 체인) + GET .../:id/image(R2 원본 이미지 인증 스트림, blob→objectURL 인라인 표시). REQ-060 충족. Playwright E2E(OCR 정의 트레이스→실 포스터 인라인 렌더)
  - [x] **데모 카탈로그 반영**: 공개 랜딩(demo.ts)에 시상정의 카탈로그 섹션 추가 - 규모 stats(14,590·30원수사)·생보/손보 탭(실 샘플)·라이프사이클 스트립(원본→카탈로그→확정→운영룰→정산→감사). Playwright 렌더·탭전환 검증
- **Status**: DONE
- **Sprint**: S14
- **Notes**: [[B-012]] "스키마 확장" 부분 분리 승격(사용자 결정: 전용 테이블 신설). 기존 F-043 후속 데이터 반영에서 incentive_rules에 lossy 적재했던 것을 전용 카탈로그로 이관 - 납입기간·지급시점(익월/13차월/구간/연속/가동)·채널(FC/법인)·지점·조건을 1급 컬럼으로. rate_type: 적용률<100=rate(보험료×배수)/≥100=fixed(정액). 임포터 `scripts/import-sisang-saengbo.mjs`(def-sib-{월}-{행} 결정적 id, DELETE 헤더 idempotent). 정의↔운영룰 도메인 분리로 정산 엔진 무영향. **OCR 결선**: F-043 OCR(추출·후보) → 담당자 확정 → POST 정의 write(HITL, 불변식 #3 준수). wrangler dev E2E(한화 포스터 OCR→planImageKey→확정 3건→역추적 key 일치·감사로그 확인). **손보 구조화**: `scripts/import-sisang-sonbo.mjs`(158 그룹 unpivot, def-sonbo-{월}-{행}-{col} id). **정의→운영룰 UI**: `apps/web/src/screens/PlanDefinitions.tsx` + POST promote(routes/incentive-plan-definitions.ts). **감사 소명**: `apps/web/src/screens/Audit.tsx` + `routes/audit.ts`(incentive-trace) + `.../:id/image`(R2 스트림). **D1 함정**: 쿼리당 바운드 변수 100개 한도 → 배치 insert를 컬럼수 기준 청크(≤90). **B-012 전 항목 완료**(OCR 실연동 F-043 + 스키마 확장·OCR결선·손보 구조화·운영룰 확정 UI·감사 소명 F-044). 상세 `docs/specs/req-ocr-sichaek/data-import-log.md`.

### F-045 · 시책룰 목록 화면 표시 수정 (데모 피드백 AI-1)
- **REQ-063**: 담당자가 시상정의를 확정(운영룰 승격)하면, 시책룰 목록 화면에서 등록된 룰을 조회·확인할 수 있다
- **Acceptance**:
  - [x] 시책룰 목록이 등록된 incentive_rules를 정상 조회·표시(실측: seed 2건 렌더, 형태 일치 확인) + promote 룰도 동일 경로 표시
  - [x] 룰 0건일 때 빈 상태 안내 보강(운영룰/시상정의 승격 두 경로 안내), 로딩·에러 상태 처리
  - [x] 메뉴 노출·라우팅(routes.tsx `/rules` 등록)·조회 API(GET /api/rules) 결선 점검
  - [x] **시책룰↔시상정의 UX 브리지**: `_rules/DefinitionBridge.tsx` - 시상정의 카탈로그(14,590) 카운트 표시 + `/plan-definitions` 승격 링크. 고객 오인("확정했는데 시책룰에 안 보임") 갭 해소
- **Status**: DONE
- **Sprint**: S16
- **Notes**: 2026-07-10 에이티에셋 데모 통화(김혜경 차장) 피드백 AI-1(🔴). **근본원인(실측)**: 렌더 버그 아님 - incentive_rules 총 2건(seed, 형태 정상 렌더)·promote된 rule-* 0건인데 시상정의 카탈로그는 14,590건. F-044 도메인 분리(정의=참조/후보, 운영룰=HITL promote 파생)로 고객 확정 정의가 시책룰에 안 뜨는 **워크플로우/UX 갭**. **결정**: HITL 불변식(#3) 유지 + 시책룰 화면에 UX 브리지(사용자 선택). 백엔드 GET /api/rules(F-010) + promote(F-044)는 무변경. 파일: `apps/web/src/screens/_rules/DefinitionBridge.tsx`(신규) + `Rules.tsx`(결선·빈상태). 성격: UX 갭(초기 판정 Bug 정정).

### F-046 · 시책안 PDF/이미지 업로드 경로 (데모 피드백 AI-2)
- **REQ-064**: 업로드 화면에서 파일 유형(① 원수사 지급·명세 엑셀 ② 시책안 PDF/이미지)을 구분해 업로드할 수 있다
- **REQ-065**: 시책안 PDF/이미지 업로드 건은 OCR→시책룰 초안 생성 파이프라인으로 이어진다
- **Acceptance**:
  - [x] 업로드 화면에 파일 유형 토글(지급명세 엑셀 / 시책안 문서 OCR) 추가 - `Upload.tsx`
  - [x] 시책안 PDF/이미지 업로드 → POST /api/incentive-plans/ocr 파이프라인 연결 + 추출 시책룰 후보·저신뢰 표시(`_pipeline/IncentivePlanUpload.tsx`)
  - [x] 시책룰 초안 생성 흐름: OCR 결과 화면에서 `/plan-definitions`(시상정의 확정→운영룰 승격 HITL) 링크로 연결
  - [x] **PDF 지원**: OCR 엔드포인트 mime 게이트 확장(application/pdf 허용) + CLOVA format=pdf passthrough + 다중페이지 images[] flatMap 보강. api 유형게이트 테스트 4(415/400/pdf통과/png회귀)
  - [x] **실 CLOVA PDF OCR E2E 실측(2026-07-10)**: 실제 고객 시책안 PDF(`에이티에셋 3월 손보자체 시상.pdf`, 1p A4)로 실 CLOVA+Upstage 호출 → HTTP 200, format=pdf passthrough 정상(R2 `.pdf` 보관), OCR avgConf 0.942·293필드, 6개 시책룰 필드 전량 정확 추출·저신뢰 0건
- **Status**: DONE
- **Sprint**: S16
- **Notes**: 2026-07-10 데모 통화 피드백 AI-2(🔴, 통화 00:49~01:17). OCR 엔진 POST /api/incentive-plans/ocr(F-043) 기구현 → 업로드 화면 진입점만 부재였음. 구현: (1) `apps/api/src/routes/incentive-plans.ts` mime 게이트를 image+application/pdf로 확장, ext/에러문구 반영 (2) `apps/api/src/ocr.ts` clovaOcr가 전 페이지 필드 flatMap(다중페이지 PDF) (3) `apps/web/src/screens/Upload.tsx` 파일유형 토글 (4) `_pipeline/IncentivePlanUpload.tsx` 신규(OCR 업로드→후보 렌더→확정 링크). 고객 문의답변 Q2 직결. **✅ 실 PDF OCR 실측 완료(2026-07-10)**: 로컬 wrangler dev + prod 동일 CLOVA/Upstage 키로 실 고객 시책안 PDF 호출 → 200, format=pdf 정상, avgConf 0.942/293필드, insurer(9개)·planType(월초P)·period(2026년 3월)·targetProduct(장기보장성 인보험)·payout(500/300/200/100%)·retention(미유지 1~25회 환수) 전량 정확·저신뢰 0. 성격: Feature(UI 진입점 + PDF 백엔드).

### F-047 · 업로드 내역 삭제 기능 (데모 피드백 AI-4)
- **REQ-066**: 업로드 목록에서 업로드 파일을 삭제할 수 있고, 삭제 시 처리자·시각이 감사 로그에 기록된다
- **REQ-067**: 마감(잠금)된 정산월에 속한 업로드는 삭제가 차단되고 안내된다
- **Acceptance**:
  - [x] 업로드 내역 목록에서 삭제 기능(`DELETE /api/uploads/:id` 신규 + `_pipeline/UploadHistory.tsx` UI, 2단계 확인)
  - [x] 삭제 시 처리자(authUser)·시각 audit_logs 기록(`upload.delete`, 삭제 카운트 summary, 불변식 #4)
  - [x] 마감된 정산월 소속 업로드 삭제 차단(409) + 안내(불변식 #2, API+D1 트리거 이중)
  - [x] cascade: 원장(commission_records)·파생 정산라인(settlement_lines)·검증오류·jobs·R2 원본 연쇄 삭제, 삭제 카운트 응답
  - [x] 인가: 전역 /api/* 인증 게이트(미인증 401) + 파괴적 cascade라 admin 역할 요구(비관리자 403). tenant 스코프는 [[B-008]]
- **Status**: DONE
- **Sprint**: S17
- **Notes**: 2026-07-10 데모 통화 피드백 AI-4(🟡, 통화 01:50~01:55, 제공 확약). **정책(사용자 결정)**: 마감만 차단 + 나머지 cascade. 마감(closed run 존재) 월은 409, 그 외는 파생 정산라인→원장→검증오류→jobs→업로드→R2까지 연쇄(비마감이라 D1 트리거 미발동, settlement_lines 청크삭제 D1 100변수 한도). 구현: `apps/api/src/routes/uploads.ts`(DELETE 핸들러 + actorOf) + `apps/web/src/screens/_pipeline/UploadHistory.tsx`(신규, GET /api/uploads 목록 + 2단계 삭제 확인 + 삭제 카운트) + `Upload.tsx` 결선. 테스트 3(404·마감409보존·cascade+감사). AI-3(테스트 데이터)는 이제 화면에서 삭제 가능. 성격: Feature.

### F-048 · 시책안 등록 대장 (업로드 파일 영속 레코드 + 조회)
- **REQ-068**: 시책안 PDF/이미지를 업로드하면 파일 자체가 대장 레코드로 영속화되어(원수사·정산월·파일명·업로더·OCR결과·R2키·해시), 누가 언제 무엇을 올렸는지 조회할 수 있다
- **REQ-069**: 등록된 시책안은 R2 원본과 연결되어 감사 근거로 역추적된다 (F-043/F-044 감사 체인 보강)
- **Acceptance**:
  - [x] `incentive_plans` 테이블(migration 0005) - insurer_id·settlement_month nullable + file_name·r2_key·sha256·content_type·byte_size·ocr_status·ocr_avg_confidence·ocr_field_count·low_confidence_count·created_by·created_at. sha256 unique(멱등)
  - [x] **업로드 즉시 등록**(사용자 결정): `POST /api/incentive-plans/ocr`가 R2 put 직후 대장 레코드 생성(OCR 이전, status=pending) → OCR 성공 시 ocr_status(ok/low_confidence)+신뢰도+필드수 갱신·정산월 자동파싱, OCR 실패 시 status=failed. 확정자(created_by) 인증사용자 자동
  - [x] **원수사·월 태깅**(사용자 결정): 원수사 nullable(OCR 원수사 다중), 정산월은 OCR 적용기간에서 best-effort 파싱(예: "2026년 3월"→"2026-03")
  - [x] `GET /api/incentive-plans` 목록(원수사명 조인·?q·?limit·?offset+total, `{items,total}`) - 파일명·원수사·월·OCR상태·신뢰도·업로더·시각
  - [x] **목록 화면**(사용자 결정): 업로드 화면 '시책안 문서(OCR)' 탭 하단에 '시책안 등록 내역' 섹션(`_pipeline/PlanUploadHistory.tsx`) - 엑셀 UploadHistory 대칭. OCR 성공 시 목록 invalidate
  - [x] 인가: 전역 /api/* 인증 게이트(미인증 401). 목록/등록 모두 게이트 뒤
- **Status**: DONE
- **Sprint**: S18
- **Notes**: 2026-07-10 세션. F-046 시책안 OCR 업로드가 OCR 추출만 하고 파일 레코드 영속화·조회 대장이 없던 비대칭(엑셀은 uploads 테이블+UploadHistory 존재) 해소. **핵심: 시상정의(incentive_plan_definitions, 확정 카탈로그) ≠ incentive_plans(업로드 대장)**. 대장은 "업로드 사실"의 감사 기록, R2 원본 역추적 뿌리. 인터뷰 결정 3건: 생성=업로드 즉시(실패건도 추적), 태깅=nullable+월 자동파싱, 목록=업로드 화면 내 섹션. 구현: `packages/schema`(incentive_plans, migration 0005) + `routes/incentive-plans.ts`(업로드 즉시 등록+GET 목록+parseSettlementMonth) + `_pipeline/PlanUploadHistory.tsx`(신규) + `Upload.tsx`/`IncentivePlanUpload.tsx` 결선. 테스트 3(업로드 즉시 등록·sha 멱등·{items,total}+401), 전체 93 green. **실 CLOVA PDF OCR E2E 실측(2026-07-10)**: 실 고객 시책안 PDF 업로드→대장 1건·정상·정산월 2026-03 자동파싱·신뢰도 94.2%·293필드. PR #52 squash merge → main → **prod 배포(version 75cb4644, remote D1 0005 적용)**. prod 스모크: /health 200·GET /api/incentive-plans 401 게이트·/app 200. 성격: Feature.

### F-049 · CLOVA OCR 10페이지 초과 처리 (손보 다중 시상 PDF) 🔴
- **REQ-070**: 10페이지를 넘는 시책안 PDF(손보 12+ 시상)도 OCR 인식이 되어야 한다
- **Acceptance**:
  - [x] PDF 페이지 수 > 10이면 Worker에서 ≤10p 단위로 분할 → 각 청크 CLOVA 호출 → 필드 병합
  - [x] 12+p 손보 시책안 실 PDF로 200 응답 + 전 페이지 필드 인식(E2E 실측)
  - [x] 단일/≤10p PDF 회귀(기존 경로 무변경), 분할 실패/빈페이지 방어
- **Status**: ✅ DONE
- **Sprint**: S19
- **Notes**: 260710 고객 피드백. 실측 근본원인: `apps/api/src/ocr.ts` `clovaOcr`가 PDF 전체를 1요청(base64)으로 전송 → CLOVA General OCR **10p/요청 한도**(400 code 0011 "No more than 10 pages"). 손보 5월 1·2주차 시책안이 12+ 시상=12+p라 첫 요청부터 실패. Worker에서 PDF 분할 필요(pdf-lib류, 신규 dep 시 번들 PoC). 성격: 🔴 Bug(우리가 포지셔닝한 손보 OCR이 실사용 불가).

### F-050 · 시책룰 삭제 시 시상정의 확정→후보 복원 🔴
- **REQ-071**: 승격된 시책룰을 삭제하면 원본 시상정의가 "확정"에서 "후보"로 복원되어 재확정할 수 있어야 한다
- **Acceptance**:
  - [x] 시책룰(rule-{defId}) 삭제 후 시상정의 목록에서 promoted=false로 복원
  - [x] soft-delete(active=false) 룰은 promoted로 집계되지 않음(active=true 필터)
  - [x] 회귀 테스트(승격→삭제→후보복원→재승격)
- **Status**: ✅ DONE
- **Sprint**: S19
- **Notes**: 260710 고객 피드백. 실측 근본원인: `DELETE /api/rules/:id`는 soft-delete(`active=false, validTo`)인데 `incentive-plan-definitions.ts`의 `promoted` 판정 `EXISTS(SELECT 1 FROM incentive_rules WHERE id='rule-'||def.id)`가 **active 미필터** → 삭제해도 행이 남아 확정 유지. Fix: EXISTS에 `AND ir.active` 추가(~1줄). 성격: 🔴 Bug(소규모).

### F-051 · 시책룰 4대 대분류 + 업로드 시 대분류 선택
- **REQ-072**: 시책안 업로드 시 4대 대분류(손보설계사시상/손보자체시상/생보FC시상/생보법인시상)를 먼저 선택하고 업로드한다
- **Acceptance**:
  - [x] `incentive_plans`에 category 컬럼 추가(migration 0006) - sonbo_fc/sonbo_self/sengbo_fc/sengbo_corp
  - [x] 업로드 화면(IncentivePlanUpload)에 대분류 선택 필수 → POST /api/incentive-plans/ocr에 category 전달·저장
  - [x] 등록 대장(PlanUploadHistory)·목록 API에 대분류 표시/필터
- **Status**: ✅ DONE
- **Sprint**: S19
- **Notes**: 260710 고객 피드백. 시책룰이 총 4개 대분류로 정의됨. F-048 등록 대장 확장(category 컬럼). 성격: Feature.

### F-052 · 생보 납입기간별 지급율 다중행 추출
- **REQ-073**: 생보 시책안 OCR 시 상품의 납입기간별(5년납/7년납 등)·지급시점별(익월/13차월) 지급율이 각각 별도 행으로 추출·반영된다
- **Acceptance**:
  - [x] OCR 구조화(`structureRule`)가 (납입기간×지급시점)별 지급율 다중행 산출
  - [x] 예: ABL생명 5년납→익월150%/13차월0, 7년납→익월250%/13차월100% 각 행 분리
  - [x] OCR 결과 화면·시상정의 매핑에 납입기간별 행 반영, 골든 회귀 통과
- **Status**: ✅ DONE
- **Sprint**: S19
- **Notes**: 260710 고객 피드백. 실측 근본원인: `ocr.ts structureRule`이 단일 flat 6필드(payout 1개)만 추출 → 납입기간별 상이 지급율 손실. Upstage 구조화 프롬프트/출력스키마를 payoutRows[] 배열로 확장. 시상정의 카탈로그는 pay_term·pay_timing 컬럼 이미 보유(F-044). 성격: Improvement(추출 정확도).

### F-053 · 시책룰 등록 항목 확장 (실적인정·환수·예외·구간·브릿지)
- **REQ-074**: 시책룰에 실적인정기분·환수기준(1·2차년도)·예외적용·구간시상·브릿지시상 항목을 등록할 수 있다
- **Acceptance**:
  - [x] `conditionSchema`(zod)·룰 엔진(packages/rules)에 실적인정/환수/예외/구간/브릿지 필드 추가
  - [x] 시책룰 등록 UI(Rules)에 해당 항목 입력, GET/POST /api/rules 왕복
  - [x] 룰 엔진 변경이라 골든 회귀 테스트 필수 통과(불변식 #6)
- **Status**: ✅ DONE
- **Sprint**: S19
- **Notes**: 260710 고객 피드백. 참조자료 `2026년3월_손보시책안...xlsx`(챗GPT 변환)의 컬럼(실적 인정 및 제외 기준·1차년도 환수·2차년도(13회차) 환수·구간)과 정확히 매핑. 구간시상=실적 브라켓별 차등, 브릿지시상=연속 유지 조건. 성격: Feature(중~대, 룰 엔진 확장). 우선순위 P2(FB5·FB2 후행).

### F-054 · ata.minu.best 고객 협업 포털 IA 설계 (계약~운영 라이프사이클)
- **REQ-075**: 계약·개발·검수·운영 단계 전반을 고객과 함께 보고 소통할 협업 공간의 정보구조(IA)를 설계한다 - 사이트맵·화면구조·네비게이션·콘텐츠 모델·접근권한
- **REQ-076**: 고객 제공 자료·이메일 자료 백업·피드백·진행 상태 보고·주요 산출물(계획+다운로드)을 한 공간에서 관리·열람할 수 있는 구조를 정의한다
- **Acceptance**:
  - [x] 사이트맵/IA 트리 - 계약→개발→검수→운영 단계별 섹션 + 각 단계 산출물/커뮤니케이션 지점
  - [x] 화면 구조·네비게이션 설계(고객 뷰 기준 정보 위계, 진입 동선)
  - [x] 콘텐츠 모델 정의 - 5영역 엔티티: ① 이메일 자료 백업·피드백 정리 ② 고객 제공 자료 보관 ③ 프로젝트 진행 상태 보고 ④ 피드백 공간 ⑤ 주요 산출물 계획+다운로드
  - [x] 접근 권한 모델(사용자 결정: **공개 링크 + 일부 보호**) - 진행 상태·산출물은 공개 링크, 민감 자료/피드백은 인증 뒤. 현 /app 인증(F-024) 재활용 경계 명시
  - [x] 현행 자산과의 관계 정리 - 루트 데모 랜딩(F-032)·정식 SPA([[B-006]])·`docs/specs/고객제공자료/`(현 자료 보관 위치)와의 통합/분리 방침
  - [x] **공개 레이어 구현·배포**(사용자 지시로 범위 확대) - 홈·개요·진행현황·산출물 서버 렌더, 보호영역 로그인 유도
- **Status**: DONE (설계 + 공개 레이어)
- **Sprint**: S20
- **Notes**: 2026-07-11 등록·완료. 요청: `https://ata.minu.best/` IA 구조 설계. 최초 범위=설계 산출물까지였으나 사용자 지시("IA 설계에 맞춰 작업 완료")로 **공개 레이어 구현+배포까지 확대**. **설계**: `docs/specs/portal-ia/ia-design-v0.1.md`(사이트맵·화면구조·콘텐츠모델 5영역·접근권한 매트릭스·현행자산 관계·와이어프레임 2종·오픈이슈 4건). **구현**: `apps/api/src/portal.ts` + `index.ts` 라우팅(포털홈 `/portal`·`/overview`·`/status`·`/deliverables` 공개, `/assets`·`/comms` 로그인 유도, 데모는 `/demo`로 이동). 데모와 동일 다크/브랜드 테마 서버 렌더. 접근 모델 공개+일부보호(사용자 결정): 진행/산출물 공개, 다운로드/자료/소통 인증(F-024). PR #55 → prod 배포(c3287bdf) 후 **사용자 요청으로 루트 원복(PR #56, prod 767b7d06): `/`=데모 랜딩, 포털은 `/portal`로 이동**(계약 미체결 감안). prod 스모크: /=데모·/portal=포털·/status·/deliverables·/app·/demo 200. 테스트 portal 6(전체 149 green). **후속 F-item 후보**: 보호영역 상세 콘텐츠 관리(자료실 Asset·소통 CommunicationLog·피드백 FeedbackThread), 진행현황 SPEC 자동 롤업 - 계약 확정 후. WAF(Super Bot Fight Mode) 경계는 공개 HTML이라 데모(기존 공개)와 동일하게 통과.

### F-055 · 데모·도움말 현행성 점검 스킬 + 최근 기능 반영
- **REQ-077**: 데모·도움말이 현재 시스템 상태(라우트·기능·수치)를 반영하는지 점검하고, 어긋난 부분을 갱신한다. 이 점검은 시스템 업데이트 시 함께 돌 수 있게 스킬로 상시화한다
- **Acceptance**:
  - [x] `.claude/skills/demo-guide-audit` 스킬(구조 점검 + 카피 리뷰 2단) + CLAUDE.md 프로젝트 스킬 등록·실행시점 명시
  - [x] `scripts/content-currency-check.sh`(라우트↔도움말 커버리지·가이드 라우트 유효성·최근 DONE F-item 키워드·데모 수치 플래그, --json)
  - [x] 점검 발견 갭 반영: F-051 대분류(업로드 필수)·F-052 납입기간별 지급율·F-048 등록 내역·F-053 시책룰 항목 → guide.ts guideStep/screenHelp
  - [x] 데모 수치 정정(원수사 데이터 stat 30→33, 헤드라인 framing 30여 개) + 가이드 PDF 재생성
- **Status**: ✅ DONE
- **Sprint**: S21
- **Notes**: 2026-07-11. 사용자 요청("데모·도움말 현행성 점검 + 루틴 스킬화"). content currency: OK, 전체 113 api tests green. PR #57 → prod fb94fb8c. **유지보수**: 신규 기능 배포 시 `content-currency-check.sh` `FEATURE_KW`에 키워드 1줄 추가. 가이드 문구 수정 시 `pnpm -F web guide:pdf` 재생성 필수. 단일 소스=`guide.ts`(Guide·HelpPanel·Tour·PDF 공용). ⚠️ 데모 루트(`/`) HTML은 CF 엣지 캐시되므로 배포 후 하드 리프레시/캐시 만료까지 구버전 보일 수 있음(내용은 정상 배포).

### F-056 · 시책안 대분류별 시상정의 필터
- **REQ-078**: 시상정의 확정 화면에서 시책안 4대 대분류(생보FC·생보법인·손보)로 목록을 필터링할 수 있다
- **Acceptance**:
  - [x] GET /api/incentive-plan-definitions에 ?category 필터(파생: sengbo_fc=생보+FC, sengbo_corp=생보+법인, sonbo=손보 전체)
  - [x] PlanDefinitions 화면 대분류 셀렉터(전체/생보FC/생보법인/손보) + insurerId·month·q와 병행
  - [x] 실데이터 검증: 생보FC 5,470·생보법인 3,749·손보 5,366 / 테스트 5
- **Status**: ✅ DONE
- **Sprint**: S22
- **Notes**: 2026-07-11. 사용자 요청. **데이터 제약(실측)**: 대분류(category)는 incentive_plans(업로드)에 있고 시상정의는 별도 테이블 → line_type+channel로 파생. **생보는 channel로 FC/법인 정확 분리되나 손보 xlsx는 channel=null이라 설계사/자체 미구분**(전부 5,363건 손보 한 덩어리). 사용자 결정: **파생 3-way**(손보 세분화는 원본 데이터 확보 시 후속). 스키마 변경 없음. 구현: `routes/incentive-plan-definitions.ts` CATEGORY_FILTER + `screens/PlanDefinitions.tsx` 셀렉터. E2E(UI 손보 선택→5,366·전 행 손보 확인). PR 예정 → 배포.

### F-057 · 손보 설계사/자체 시상정의를 시책안 대분류로 연결
- **REQ-079**: 손보 시상정의를 설계사시상/자체시상으로 구분하되, 그 구분을 원본 시책안 업로드의 대분류(category)로부터 상속받아 필터할 수 있다
- **Acceptance**:
  - [x] 대분류 필터에 sonbo_planner(손보설계사)·sonbo_self(손보자체) 추가 - `plan_image_key = incentive_plans.r2_key` EXISTS 조인으로 업로드 category 연결
  - [x] PlanDefinitions 셀렉터에 손보설계사시상·손보자체시상 옵션(손보시상 전체와 병존)
  - [x] 테스트 7(설계사/자체 링크 분리) + 실데이터 검증(OCR 손보 정의 3건을 sonbo_planner 연결 시 손보설계사=3)
- **Status**: ✅ DONE
- **Sprint**: S22
- **Notes**: 2026-07-11. 사용자 요청("손보 설계사/자체 구분은 시책안 대분류로 연결"). F-056 파생 3-way 손보 한계(xlsx channel=null) 보완. **연결 경로**: OCR로 확정한 시상정의는 원본 시책안(incentive_plans)의 category 상속(plan_image_key=r2_key). 새 컬럼/마이그레이션 없이 EXISTS 조인. **적용 범위**: F-051 이후 대분류 붙여 업로드→OCR 확정한 손보 시상정의부터 분류(xlsx 손보·과거 OCR분은 미연결이라 손보 전체에만). 구현: routes/incentive-plan-definitions.ts linkedCategory + PlanDefinitions.tsx 옵션 2개. **소급 분류 결정(2026-07-11, 사용자)**: 기존 손보 시상정의 5,363건(전부 `AT에셋_시상정의(손보).xlsx` 단일 파일 출처)에 설계사/자체 신호가 없음을 실측 확인(cond1은 시상유형=월간가동·주간·기본·브릿지·추가·주력상품; 전 필드 '자체'/'설계사' 키워드 0건). 원수사·상품만으로 소급 분류 불가(한 원수사가 둘 다 보유) → **소급 보류·전방 축적** 결정. 향후 신뢰할 분류 근거(시상유형 매핑/원수사 매핑/원본 재제공)가 생기면 재개.

### F-058 · 손보 시상정의 시상유형 기반 소급 분류 (설계사/자체)
- **REQ-080**: 기존 xlsx 손보 시상정의를 시상유형(cond1) 매핑으로 설계사/자체 대분류에 소급 분류해 필터할 수 있다
- **Acceptance**:
  - [x] 소급 규칙(사용자 결정): 설계사=가동·주간·기본·연속·브릿지(활동/실적), 자체=그 외(주력·전략·신상품·특별·분기·추가·기타·null)
  - [x] 필터 2단: OCR 확정분은 시책안 대분류 링크 우선(F-057), xlsx는 cond1 소급(F-058). plan_image_key 유무로 분기, null-safe(COALESCE)
  - [x] 실데이터: 손보설계사 3,694·손보자체 1,669(합 5,363 xlsx). 테스트 7(링크 우선 precedence 포함)
- **Status**: ✅ DONE
- **Sprint**: S22
- **Notes**: 2026-07-11. 사용자 요청("시상유형 매핑 규칙으로 소급 분류"). **한계 명시**: 시상유형(cond1)은 "무엇을 시상하나"이지 "설계사/자체"가 아니라 같은 유형이 양쪽 문서에 나올 수 있어 **근사치**(사용자 인지·수용). 정확한 건 문서 단위(F-057 전방 축적). 152 distinct cond1 → 11 키워드 패밀리로 축약 후 활동/상품 이분. 스키마 변경·데이터 변형 없음(쿼리 규칙, `routes/incentive-plan-definitions.ts` PLANNER_COND1). 프론트 셀렉터는 F-057 옵션(손보설계사/손보자체) 재사용. **재분류 시**: PLANNER_COND1 패턴만 수정하면 즉시 반영. **매핑 규칙 문서**: `docs/reference/sonbo-시상유형-대분류-매핑.md`(설계사 패턴·패밀리 분포·우선순위·실측·변경법).

### F-059 · 시책안 OCR Upstage 구조화 견고성 보강 (P1)
- **REQ-081**: 손보 다중 시상 PDF처럼 OCR 텍스트가 긴 경우에도 Upstage 구조화가 "JSON을 찾지 못했어요"(502) 없이 안정적으로 결과를 반환한다
- **Acceptance**:
  - [x] Upstage 요청에 JSON 강제 응답(response_format json_object) 적용 - 미지원 모델(solar-mini)은 400 감지 시 무모드 fallback
  - [x] 긴 OCR 텍스트(>8,000자) 청크 분할 구조화 + 병합(rule=신뢰도 최고값, payoutRows=concat+dedupe), 짧은 문서 회귀 무변경(단일 청크 동일 경로)
  - [x] 실패 시 오류 메시지에 재시도 안내 포함 + 비-JSON 응답 1회 자동 재시도 + 절단 JSON도 502 OcrError(500 방지). 대장 failed·멱등 재시도는 기존 F-048 경로 실측 확인
  - [ ] 고객 재현 케이스([손해보험]26.05월 1주차 시상 유형의 다중 페이지 손보 PDF) 성공 처리 - **재현 실패의 근본 원인 규명 완료(2026-07-17, F-064 진단 컬럼 활용)**: F-059가 고친 JSON 견고성 단계가 아니라 그 앞 Upstage `fetch failed`(네트워크 hang)가 원인. **진짜 fix는 B-015로 분리** - 본 항목은 그 fix 후 재확인
- **Status**: 🔧 IN_PROGRESS (원인 규명 완료, 실 수정은 B-015 선행 의존)
- **Sprint**: S23 (예정)
- **Notes**: 2026-07-14 고객(김혜경) 테스트 리포트. 손보설계사시상 PDF 업로드 시 `ocr.ts parseJsonLoose`에서 502. CLOVA 10p 분할(F-049)은 통과했으나 구조화 단계는 텍스트 길이 무방비. 실패 건은 F-048 대장에 failed로 기록됨(멱등 재시도 가능) 확인. **구현(2026-07-14)**: `ocr.ts` - splitTextForStructure(8,000자, 공백 경계)·mergeStructured·structureChunk(JSON 모드→400 fallback→파싱 실패 1회 재시도). Upstage 문서상 response_format은 solar-pro-2 이상 지원이나 **실호출 실측(2026-07-14): solar-mini-250422도 200 + 유효 JSON 반환** - JSON 강제가 1차 경로로 즉시 작동, 400 fallback은 방어층으로 유지. 테스트 10건 신규(ocr-structure-robust), 전체 130 PASS. **2026-07-16 프로덕션 실측 - 배포 후에도 재현 실패**: F-059 배포(2026-07-14 07:50 UTC) 이후인 **07-15 04:11 UTC 업로드된 `sonbo_planner`(손보설계사시상) 32p·3.4MB PDF가 04:15에 `ocr_status=failed`** (배포 20시간 후 = 수정본 경유 확정). 07-14 05:18 업로드된 `sonbo_self` 39p·4.2MB 건도 07-15 04:00에 재시도됐으나 여전히 failed. 즉 잔여 항목은 "고객 재업로드 대기"가 아니라 **"재현 시도했고 실패"** 상태. 시책안 전수 7건 중 실패 2건이 모두 대용량 스캔본(39p/32p)이고, 통과한 5건은 3·4·27·29p(다만 27·29p는 low_confidence)라 **페이지 수·스캔 여부와의 상관**이 보인다(n=7이라 상관일 뿐 인과 미확정). **원인 미확정 - 관측 공백**: `incentive_plans`에 오류 메시지 컬럼이 없어 `failed`만 남고 사유가 유실된다(F-061이 `jobs.message`에 원인을 넣은 것의 OCR 경로 대응 부재). 진단 가능화는 **F-064로 분리 등록(2026-07-16, Sprint S25)** - F-064가 실패 단계·사유를 저장·노출하고, 그 뒤 R2 보존 원본 2건 재시도로 근본 원인을 규명해 결과를 본 항목에 반영한다. 즉 **F-059 잔여 항목은 F-064 선행 의존**. 원본은 R2 보존 중(`incentive-plans/{sha}.pdf`, 멱등 재시도 가능).

### F-060 · 시상정의 만기기간 차원 추가 (P1)
- **REQ-082**: 생보 시상정의에서 상품명이 같아도 납입기간·만기기간에 따라 지급율이 다른 경우를 구분해 확정할 수 있다
- **Acceptance**:
  - [ ] incentive_plan_definitions에 만기기간(maturity_term) 컬럼 추가 (D1 migration)
  - [ ] OCR 구조화(payoutRows)와 xlsx 인입 경로에 만기기간 추출/저장 반영
  - [ ] 시상정의 확정 화면·목록 API에 만기기간 노출 + 검색 대상 포함
  - [ ] 감사 역추적(_source)에 만기기간 포함
- **Status**: 📋 PLANNED
- **Sprint**: S23 (예정)
- **Notes**: 2026-07-14 고객(김혜경) 요청 - ABL생명 동일 상품명에서 납입기간·만기기간별 지급율 상이. 납입기간(pay_term)은 모델·API에 기존재하나 확정 화면 미노출이었음 → 컬럼 노출은 F-item 없이 즉시 반영(같은 날 커밋). 만기기간은 모델 자체 부재라 본 항목에서 신규.

### F-061 · 업로드 검증 오류 대량 파일 파싱 실패 수정 (P0, Bug)
- **REQ-083**: 검증 오류가 대량(수천 건)인 엑셀도 "파싱 실패" 없이 review 상태에 도달하고 오류 리포트가 전량 기록된다
- **Acceptance**:
  - [x] 근본 원인 실측: upload_errors 단일 insert가 D1 바인딩 한도(쿼리당 100개) 초과 - 오류 20행 초과 시 `too many SQL variables`로 job 실패 (삼성화재 시책지급내역 963행 x 105열 -> 오류 2,911건 = 파라미터 14,555개, 로컬 D1 재현 확인)
  - [x] upload_errors insert를 18행(90 파라미터) 단위 분할 + 단일 db.batch(원자적) 기록. 상세 행 상한 MAX_ERROR_DETAIL_ROWS=5000(총계 errorCount는 전량 유지)
  - [x] jobs.message에 실패 원인 포함("파싱 실패: {cause}") - 사후 진단 가능화
  - [x] 회귀 테스트: 오류 302건 grid -> review + 전량 기록 (구코드에서 실패 재현 확인) + 삼성화재 실파일 grid 로컬 검증(933행/오류 2,911건 review 도달)
  - [ ] 프로덕션 배포 후 고객 삼성화재 파일 재업로드 성공 확인 (기존 실패 업로드는 멱등 해시 충돌 방지 위해 정리)
- **Status**: 🔧 IN_PROGRESS
- **Sprint**: S24
- **Notes**: 2026-07-15 고객 피드백("삼성화재 시책지급내역 파싱실패, 공백과 항목 300개 이상"). 파싱·헤더감지(6행째)·프로파일링은 전부 정상이었고 실패 지점은 오류 리포트 bulk insert. 고객 추정(공백·항목 수)은 간접 원인 - 공백 많은 필수 필드(설계사명 444건 누락 등)가 오류 건수를 키워 한도 초과 유발. 참고: 이 파일은 시책지급내역이라 수수료 온톨로지와 안 맞아(지급수수료 미매핑) staged 0건 - 파싱 성공 후 매핑 HITL(review)에서 다뤄야 하는 별개 주제.

### F-062 · 시책지급내역 문서유형 인입 (P1)
- **REQ-084**: 원수사 시책지급내역(시상금) 엑셀을 문서유형 선택으로 업로드하면 시책 전용 온톨로지로 매핑·검증되어 시책 지급 원장(incentive_payout_records)까지 적재된다
- **Acceptance**:
  - [x] uploads.doc_type(commission|incentive, 기본 commission) + POST /api/uploads docType 수용 (기존 호출 무변경)
  - [x] 시책 온톨로지(INCENTIVE_ONTOLOGY): 계약번호·시상금 필수, 설계사코드/명·상품명·실적일자·보험료·시상율·시상항목 선택. 매핑 함수군 온톨로지 파라미터화(기본값=기존 ONTOLOGY, 골든 회귀 무변경)
  - [x] 다중 블록 시트 절단: 헤더 이후 새 헤더성 행/■마커 감지 시 첫 블록만 파싱(삼성화재 실파일: 9개+ 하위 표 중 상세 87행만) - incentive 유형에서만 적용
  - [x] 다단 헤더 그룹 라벨(헤더 위 1~2행)을 프로파일·매핑에 반영("시상금 합계" 그룹 아래 "설계사" 열 → 시상금 후보)
  - [x] incentive는 계약번호+회차 중복 검증 미적용(동일 증권번호 복수 시상 행 정상)
  - [x] 승인 시 incentive_payout_records 커밋(upload_id+row_no 역추적 불변식 #1, 시상금/보험료 암호화 #5), 업로드 삭제 cascade 포함
  - [x] UI: 업로드 화면 문서유형 선택 + 업로드 내역 유형 표시
  - [x] 실파일(삼성화재 시책지급내역) grid 기반 테스트: 블록 절단·시책 매핑·원장 커밋
- **Status**: ✅ DONE
- **Sprint**: S24
- **Notes**: 2026-07-15 고객 피드백(F-061 후속) + 인터뷰 결정 4건: 목표=시책 대사까지(F-063 분리)·기존 업로드 파이프라인 확장·1블록+합계 시상금 MVP(시상항목별 unpivot은 후속)·P1 바로 착수. 실측 근거: 삼성화재 "장기 건별 시상금" 963행 x 105열 = 서로 다른 헤더의 하위 표 9개+ 이어붙임(상세는 r6~92 87행), 3단 헤더(그룹→중그룹→리프), 시상율/시상금 4쌍 + 합계 열(그룹 "시상금 합계"). wide unpivot·시상항목별 정밀 대사는 Backlog(후속 승격).

### F-063 · 시책 대사 (보고 시상금 vs 계산) (P1)
- **REQ-085**: 정산 run에서 원수사 보고 시상금(incentive_payout_records)과 시책룰 계산액(settlement_lines)을 원수사별·계약별로 비교(diff)할 수 있다
- **Acceptance**:
  - [x] GET /api/runs/:id/incentive-reconciliation: 원수사별 보고/계산/차액 집계 + 계약 단위 드릴다운 (조회 전용 MVP, 저장 없음 - F-014 reconciliations와 분리)
  - [x] UI: 대사 화면에 시책 대사 섹션
  - [x] 테스트: 시책 원장 + 룰 계산 diff 시나리오
- **Status**: ✅ DONE
- **Sprint**: S24
- **Notes**: F-062 의존. 계산측은 기존 settlement_lines(시책룰 evaluate) 재사용 - F-014(수수료 대사)와 계산측 공유, 보고측만 시책 원장으로 대체한 대칭 설계. 마감 스냅샷/저장 대사 반영은 후속. **배포(2026-07-15, PR #62, version 11a08ed2, migration 0007 remote 적용)**: prod 스모크 = /health·/app 200, 신규 endpoint 401 게이트, 번들 시책 UI 문자열, D1 테이블/컬럼 확인. 실파일(삼성화재) 실측 = 963행→89행 절단·81행 staged·9필드 후보. 잔여 관찰: 고객 실업로드(인증 실사용은 자격증명 부재로 F-048 선례처럼 로컬 동일코드 검증으로 갈음). localMap은 첫 시상항목 "시상금" 열을 잡음 - 합계 열(그룹 "시상금 합계") 교정은 매핑 검토 HITL에서, AI 매핑은 그룹 라벨을 프롬프트로 받음.

### F-064 · 시책안 OCR 실패 사유 저장 + 노출 (P1)
- **REQ-086**: 시책안 OCR이 실패하면 등록 대장에 **실패 단계와 사유**가 남아, 업로드 시점이 지난 뒤에도 원인을 규명할 수 있고 담당자가 화면에서 직접 확인할 수 있다
- **Acceptance**:
  - [x] `OcrError`에 단계 식별자 추가(`clova`|`upstage`|`parse`) - 기존 throw 8곳 태깅(CLOVA `ocr.ts:96,107` / parse `129,134` / Upstage `267,273,292` / 빈결과 `304`=clova). OcrError 아닌 예외는 `unknown`
  - [x] `incentive_plans`에 `ocr_error_stage`·`ocr_error_message` 컬럼 추가 (D1 migration 0008, 기존 행 nullable)
  - [x] `incentive-plans.ts` catch에서 stage+message 저장 - **현재는 `e`를 손에 쥐고도 버리고 `ocrStatus='failed'`만 기록**(HTTP 응답엔 `e.message`를 담으면서 대장엔 미보존 = 관측 공백의 실체)
  - [x] `GET /api/incentive-plans` 응답에 실패 단계·사유 포함
  - [x] UI: `PlanUploadHistory` failed 행에 단계+사유 표시 (담당자가 문의 없이 자가 판단)
  - [x] 테스트: 단계별 실패 시나리오(CLOVA 오류·Upstage 오류·parse 실패)가 각각 올바른 stage로 기록
  - [x] 배포 후 **R2 보존 원본 재시도로 F-059 실패 단계 규명 완료(2026-07-17 실측)** → 결과 F-059 반영. **근본 원인 확정**: 실패 단계는 `structureRule`(Upstage), 실패 모드는 `fetch failed`(stage=unknown, OcrError 아닌 raw 예외, 정확히 5분=undici headersTimeout 300s). 인과=대용량 문서가 8,000자 청크 다분할→Upstage 다회 호출 중 하나가 hang. 대조 실측: 실패건 32p textLen=32,153→Upstage 4회→5분 fetch failed / 정상건 4p textLen=4,270→Upstage 1회→14초 성공. clovaOcr는 66초 걸리나 통과(실패 아님). 진짜 fix는 B-015.
- **Status**: ✅ DONE (코드/스키마/테스트 완료·배포·prod 스키마 적용·F-059 규명까지 완결. F-059 실패의 진짜 원인은 F-059/F-064 범위 밖 = Upstage fetch 견고성, B-015로 분리)
- **Notes(2026-07-16 Master 실측)**: autopilot이 PR #63(f223384)으로 10파일 구현·머지·CI green, 로컬 typecheck + F-064 테스트 18건 전량 통과 확인. **⚠️ 프로덕션 D1 migration 0008 미적용 발견 → Master가 수동 적용**: `deploy.yml`에 D1 migration 단계가 없어(grep 0건) autopilot의 CI green이 Worker 코드만 배포하고 스키마는 누락. prod `incentive_plans`에 `ocr_error_*` 컬럼 0개였음(배포 직후 실제로는 500 위험). MCP D1로 `ALTER TABLE ADD COLUMN` 2건 + `d1_migrations`에 0008 수동 기록(wrangler 미경유라 drift 방지). autopilot이 6/7 체크에서 ✅ DONE 마킹한 것을 🔧로 정정(마지막 Acceptance = R2 재시도 규명 미수행). **후속 2건**: ① `deploy.yml` D1 migration 자동화(신규 backlog, 매 migration 재발) ② R2 원본 2건 재시도로 F-059 stage 규명(별도 세션, 유료 OCR 호출).
- **Sprint**: S25
- **Notes**: 2026-07-16 세션에서 F-059 잔여 항목을 실측하다 발견. **F-059 근본 원인 규명의 선행 조건** - 현재 prod 실패 2건이 `failed`로만 남아 "왜"를 알 수 없다(F-061이 `jobs.message`에 원인을 넣은 것의 OCR 경로 대응 부재 = 비대칭). 단계만 알아도 "F-059가 고친 Upstage 구조화 경로인가, 그 앞의 CLOVA인가"가 즉시 갈려 다음 수를 정할 수 있다. 실패 2건은 전수 7건 중 유이한 대용량 스캔본(39p/32p)이고 통과 5건은 3·4·27·29p(27·29p는 low_confidence) - 페이지수/스캔 상관이 보이나 n=7이라 인과 미확정, 본 F-item의 단계 데이터가 그 판정 재료. 승격 근거: D1 migration + 5파일 이상(schema·migration·ocr.ts·routes·web) + 사용자 관찰 가능. **완료(PR #63 Match 100%, 2026-07-16)** - OcrError.stage 8곳 태깅(clova/upstage/parse) + D1 migration 0008(ocr_error_stage/ocr_error_message) + route catch 저장·목록 노출 + UI failed 행 단계·사유 표시 + 신규 테스트 7건(ocr-error-stage.test.ts)+통합 1건, 전체 api 143 PASS. 잔존 항목(R2 원본 2건 재시도)은 배포 후 prod 자격증명 필요 - Master가 배포 확인 후 수행하고 결과를 F-059에 반영한다.

### F-065 · 시책안 OCR Upstage 호출 견고성 (F-059 진짜 fix) (P0, Bug)
- **REQ-087**: 대용량 시책안(손보 다중 시상, OCR 텍스트 8,000자 초과 다청크)도 Upstage 구조화 단계에서 네트워크 hang 없이 완료되거나, 실패해도 5분 매달림 없이 즉시 명확한 실패 사유(stage=upstage)로 종료된다
- **Acceptance**:
  - [ ] `callUpstage`에 `AbortController` 기반 호출당 타임아웃(기본 60s, env 조정 가능) - 무한 hang(현 undici 300s) 차단
  - [ ] 네트워크 실패(`fetch failed`)·타임아웃 시 재시도(1회, 짧은 백오프) - 상류 일시 장애 흡수
  - [ ] 재시도 후에도 실패하면 raw 예외가 아니라 `OcrError(stage=upstage)`로 승격 - 현재 `stage=unknown`으로 유실되던 진단성 확보(F-064 컬럼과 정합)
  - [ ] 단위 테스트: fetch hang(무응답) mock → 타임아웃 발동 + 재시도 + 최종 `OcrError.stage='upstage'`. 정상 응답 회귀 무변경
  - [ ] **실 원본 검증**: F-059 실패 원본(32p `43294869…`)을 진단 하니스(`scripts/diagnose-f059.mjs`)로 재시도 → 성공 또는 5분 미만 명확 실패. 39p 건도 확인
  - [ ] 배포 후 프로덕션 재현: 실패 원본 재업로드 → 성공 또는 대장에 stage=upstage 명시 → F-059 잔여 항목 종결
- **Status**: 🔧 IN_PROGRESS
- **Sprint**: S26
- **Notes**: 2026-07-17 F-064 진단으로 F-059 근본 원인 확정 후 즉시 착수(B-015 승격). 근본 원인=대용량이 8,000자 청크 다분할→Upstage 다회 호출 중 하나 fetch hang(정확히 5분=undici headersTimeout). **F-059는 맞는 단계(structureRule)·틀린 실패모드(JSON 파싱 vs fetch hang)를 고쳤다** → 본 항목이 진짜 fix. 스코프=Upstage만(clovaOcr는 66초 걸리나 통과, 무관). Master pane 직접 구현+진단 하니스 실측 검증(autopilot 미경유: "고쳤는데 실제 되나"가 핵심이라 실 원본 재현이 필수).

## §3. Backlog (F-item 승격 대기)

| ID | 한 줄 | 승격 기준 충족? | 우선 |
|---|---|---|---|
| B-001 | 설계사 개인 조회 포털 (고도화) | — | low |
| B-002 | 대사 차액 원인 LLM 자연어 설명 | — | mid |
| B-003 | 시책 룰 자연어 → JSON 초안 생성 | — | mid |
| B-004 | 원수사 API 직접 연동 | - | low |
| ~~B-005~~ | ~~전 엔드포인트 인증 롤아웃~~ -> F-024로 승격·완료 | 완료 | - |
| B-006 | 정식 SPA 운영 UI + Playwright 브라우저 E2E (현재 루트는 F-032 데모 랜딩 임시 대체) | 3+파일·관찰가능 | mid |
| B-007 | OTP 이메일 발송 설정(Resend API 키 + 도메인 검증) - F-033 실사용 요건 | 인프라 설정 | high |
| B-008 | 세분화 RBAC - 엔드포인트별 role/org 스코프(마스터변경 admin, 조직데이터 스코프) | 다수 파일 | mid |
| B-009 | 토큰 폐기(token_version) + 비번 해시 PBKDF2/argon2 강화 | 다수 파일 | mid |
| B-010 | 실제 ATA 로고 파일 임베드(현재 SVG 재현) | 관찰가능 | low |
| B-011 | 원수사 코드 체계 실제 값으로 조정(현재 영문 슬러그) | 데이터 | low |
| ~~B-012~~ | ~~OCR 시책안 정식 구현~~ -> F-043(OCR 실연동)+F-044(스키마 확장·OCR결선·손보 구조화·운영룰 확정 UI·감사 소명)로 전량 완료 | 완료 | - |
| ~~B-015~~ | ~~시책안 OCR Upstage 호출 견고성(F-059 진짜 fix)~~ -> **F-065로 승격**(P0, Sprint S26) | 승격 | - |
| B-014 | `deploy.yml`에 D1 migration 자동 적용 단계 추가 - **2026-07-16 F-064(migration 0008) 배포 시 CI green인데 prod 스키마 미적용 발견**(deploy가 Worker 코드만 배포, migration은 수동 `d1:migrate:remote` 규약). 매 migration 재발 구조. `d1_migrations` 자동 기록으로 drift도 해소. ⚠️ CLAUDE.md의 "트리거는 0001 수동 유지"와 상충 없는지 확인 필요(트리거 SQL만 수동, 컬럼 migration은 자동화 가능) | CI 신뢰성 | high |
| B-013 | 시책안 PDF 사전 선별(TextBased면 OCR 생략, [pdf-inspector](https://github.com/firecrawl/pdf-inspector) 류) - **조건부 보류**: 2026-07-16 프로덕션 전수 7건 실측에서 전제 붕괴. TextBased 1/7(14%)뿐이고 6건은 추출 문자 0(페이지당 전면 이미지 = 순수 스캔본). 참고글 주장 54%는 웹 크롤링 PDF 분포라 본 도메인(원수사 판촉 편집물) 미전이. 실패 2건은 전부 대용량 스캔본(39p·32p)이라 선별로 해소 불가(이미 OCR 경로로 감). Rust 네이티브라 Workers 미실행(WASM/별도 서비스 필요). **재검토 조건**: 시책안 월 볼륨 100건+ 또는 TextBased 비율 40%+ 관측 시 | 미충족(이득 14%·총 7건) | low |

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
| 7 · 오픈(S7) | W15 | F-023, F-024, F-031~F-033(auth/CRUD 보강) | done |
| 8 · SPA 셸(S8) | 후속 | F-025 (디자인시스템+인증셸) | done |
| 9 · 파이프라인 화면(S9) | 후속 | F-026 | done |
| 10 · 룰·검증 화면(S10) | 후속 | F-027 | done |
| 11 · 마감 화면(S11) | 후속 | F-028 | done |
| 12 · 출력·관리 화면(S12) | 후속 | F-029 | done |
| 13 · 브라우저 E2E(S13) | 후속 | F-030 | done |
| 14 · 시책안 OCR(S14) | 후속 | F-043 (데모 + CLOVA/Upstage 실 연동, 정식은 [[B-012]]) | done |
| 15 · 시상정의 카탈로그(S15) | 후속 | F-044 (전용 테이블 14,590건[생보9,227+손보5,363] + OCR결선 + 운영룰 확정 UI + 감사 소명) | done |
| 16 · 데모 피드백 SPA 결선(S16) | 후속 | F-045(시책룰↔시상정의 UX 브리지), F-046(시책안 PDF/이미지 OCR 업로드) | done |
| 17 · 업로드 삭제(S17) | 후속 | F-047 (업로드 삭제 + 감사·마감차단·cascade) | done |
| 18 · 시책안 등록 대장(S18) | 후속 | F-048 (incentive_plans 테이블 + 업로드 즉시 등록 + 목록 화면) | done |
| 19 · 260710 시책 피드백 배치(S19) | 후속 | F-049(OCR 10p 분할)·F-050(삭제→복원)·F-051(4대 대분류)·F-052(납입기간별 지급율)·F-053(시책룰 항목 확장) | done |
| 20 · 고객 협업 포털 IA 설계(S20) | 후속 | F-054 (계약~운영 라이프사이클 IA 설계 + 공개 레이어 구현·배포, P1) | done |
| 21 · 데모·도움말 현행성 점검 스킬(S21) | 후속 | F-055 (demo-guide-audit 스킬 + 최근 기능 반영, 배포 fb94fb8c) | done |
| 22 · 시책안 대분류 시상정의 필터(S22) | 후속 | F-056(파생 3-way)·F-057(대분류 연결)·F-058(손보 시상유형 소급 분류) | done |
