# 운영 매뉴얼 (F-023)

> ga-settle 월 정산 운영 절차. 실무자/운영자용.

## 월 정산 사이클

원수사 30곳 엑셀 수신 -> 표준화 -> 정산 -> 대사 -> 마감 -> 내역서.

### 1. 원수사 등록 (최초 1회/신규 시)

원수사(insurers)는 DB에 등록. 조직도(본부>사업단>팀)와 설계사는 ERP 일괄 등록:
- `POST /api/org/units` (본부/사업단/팀 트리)
- `POST /api/erp/agents` (설계사 + 소속 배정 일괄)

### 2. 수수료 엑셀 업로드

- `POST /api/uploads` (multipart, xls/xlsx). 파일 해시 중복은 자동 반려(409).
- 진행률: `GET /api/jobs/:id` 폴링. 상태 queued -> parsing -> review.
- 오류 행: `GET /api/uploads/:id/errors` (행번호 + 사유).

### 3. 매핑 확인/확정

- `GET /api/uploads/:id/mapping` (L0~L4 자동 매핑 결과 + 검증 카운트).
- 신뢰도 등급: auto(자동확정)/review(확인필요)/manual(수동). 금액 필드는 보수적.
- 확정: `POST /api/uploads/:id/mapping/confirm` -> TemplateVersion 저장. 다음 달 동일 양식은 L0 캐시 자동 적용.

### 4. 승인 -> 원장 커밋

- 검증 통과 후 `POST /api/uploads/:id/approve`. **승인 후에만 원장(commission_records) 커밋** (역추적 upload_id+row_no 보장).

### 5. 정산 계산

- `POST /api/runs` (월 생성) -> `POST /api/runs/:id/calculate` (시책 룰 적용, settlement_lines 생성).
- 시책 룰: `POST /api/rules` (조건+액션 선언형). 변경 전 `POST /api/rules/simulate`로 영향 미리보기(실데이터 무영향).

### 6. 대사 + 병행 검증

- `GET /api/runs/:id/reconciliation` (원수사 보고액 vs 계산액, 차액 계약 드릴다운).
- `GET /api/runs/:id/parallel-verify` (저장 원장 vs 재계산 무결성, **차액 0원 확인**).

### 7. 보정 (필요 시)

- `POST /api/runs/:id/adjustments` (사유 필수, 이중 승인 옵션). 모든 보정은 감사 로그 동반.

### 8. 마감

- `POST /api/runs/:id/close`. **이중 잠금**(API + DB 트리거)으로 마감 후 수정 차단. 마감 스냅샷 R2 보관.

### 9. 지급 내역서 / 통계

- `POST /api/runs/:id/payslips` -> `GET /:agentId`(팀장용 내역서), `GET /transfer-master`(급여 이체 CSV).
- 통계: `GET /api/stats/by-org|by-insurer|by-month`.

## 가족계약 (HITL)

- `POST /api/family/detect` (성명+생년월일 매칭 후보). **확정은 실무자만**(`/:id/confirm`), 자동 확정 없음.

## 모니터링

- `wrangler tail` (실시간 로그). 파싱 실패(job failed)는 큐 재시도 3회 후 DLQ.
- 감사: audit_logs는 append-only(변조 불가).

## 권한 (RBAC)

- 직책: admin(전체) / manager(자기 조직+하위) / staff / viewer. 조직 스코프 밖 조회는 403.
- 계정 생성은 부트스트랩(허용 IP) 후 admin만.
