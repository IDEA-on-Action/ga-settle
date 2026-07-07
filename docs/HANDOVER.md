# 인수인계 (F-023)

> ga-settle 개발 인수인계 + 검수 대응 자료. SPEC.md가 단일 진실원천(SoT).

## 아키텍처 요약

- 모노레포(pnpm + Turborepo). apps/web(React18+Vite), apps/api(Cloudflare Workers + Hono).
- packages: schema(Drizzle D1 스키마 SoT), mapping(온톨로지 매핑 코어 순수 TS), rules(시책 룰 평가기 순수 함수), golden(회귀 표본).
- 데이터: D1(18 엔티티), R2(원본/스테이징/마감 스냅샷), Queue(파싱 비동기).
- api 라우트 모듈: routes/{uploads,mapping,runs,org,rules,family,auth,payslips,stats}.

## 핵심 불변식 (위반 금지)

1. 역추적: commission_records = upload_id + row_no. 어떤 정산 숫자든 원본 행까지 2 join.
2. 마감 이중 잠금: closed run은 API 거부 + D1 트리거 차단.
3. AI는 후보/근거만: 정산 숫자는 결정적 코드(rules.evaluate)가 계산. LLM은 매핑 후보만.
4. 멱등: 파일 해시 중복 반려, 배치 재실행 안전(재현성).
5. 암호화: 금액/인적정보 *Enc 필드 AES-GCM(F-020). 키는 FIELD_ENCRYPTION_KEY.
6. 감사: audit_logs append-only(트리거), 모든 보정은 사유+감사 동반.

## F-item 현황

F-001~F-023 전부 구현 완료(SPEC.md §2 참조). 마일스톤 1(매핑 엔진)·2(대사) 달성.
테스트: api 58 + mapping 22 + rules 8 + schema 4 + golden 2 (pool-workers 실 D1/R2/Queue 통합).

## 남은 작업 (backlog, SPEC §3)

- **B-005 (high)**: 전 엔드포인트 인증 롤아웃. 현재 F-017 auth는 일부 라우트만 적용(대다수 신뢰 네트워크 전제). payslips/이체/정산 등 민감 엔드포인트 인증 필요.
- **B-006 (mid)**: SPA 화면 구축 + Playwright 브라우저 E2E 5흐름. 현재 apps/web 최소, 로직 관통은 API E2E로 검증됨.
- 패스워드 해시 PBKDF2/argon2 승격(현재 salted SHA-256).

## 주요 기술 결정

- Drizzle 0.36 유지 -> sqliteTable extraConfig 객체 반환형(배열형은 0.37+).
- 매핑/룰 코어는 순수 함수 -> 시뮬레이션·재계산·병행검증이 동일 코드 공유(재현성).
- xlsx는 SheetJS CDN 패치판(0.20.3, prototype pollution CVE 회피). workerd 환경편차로 테스트는 Grid 주입.
- 필드 암호화 랜덤 IV(semantic security) -> 재현성은 복호화 값으로 비교.
- 테스트: vitest-pool-workers(miniflare 실 바인딩). 시크릿은 vitest 바인딩 주입(CI .dev.vars 부재 대응).

## 검수 대응 포인트

- 변환 성공률: golden 합성 표본 100%(실샘플은 원수사별 골든 추가 시).
- 차액 0원: `GET /api/runs/:id/parallel-verify` (저장 원장 vs 재계산 무결성).
- 마감 무결성: 마감 후 API/DB 양쪽 쓰기 거부 실측(runs.test).
- 역추적: settlement_line -> commission_record -> upload/row 2 join.
