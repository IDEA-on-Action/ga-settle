# 시상정의 데이터 반영 로그

- 일시: 2026-07-10
- 출처: `docs/specs/고객제공자료/260708/시상정의_생보.xlsx` (에이티에셋 제공)
- 반영 대상: 로컬 D1 + 프로덕션 D1(`ata.minu.best`, ga-settle-db)
- 임포터: `scripts/import-sisang-saengbo.mjs` (재현 가능)

> **갱신(F-044)**: 최초 반영은 `incentive_rules`에 lossy 적재였으나, 스키마 확장(F-044, migration 0004)으로 **전용 테이블 `incentive_plan_definitions`에 무손실 이관**했다. incentive_rules의 lossy import분(9,227)은 제거해 정산 엔진을 정리했다. 아래는 최종(F-044) 기준.

## 반영 내용

| 항목 | 건수 | 비고 |
|------|------|------|
| 원수사(insurers) | 33 | 기존 26 + 신규 7(INSERT OR IGNORE). 신규: ABL생명·IBK연금보험·iM라이프·KDB생명·카디프생명·하나생명·AIG손해보험 |
| 시상정의(incentive_plan_definitions) | 9,227 | 생보 시상정의 11,258행 중 적용률 있는 9,227행. rate 8,052 / fixed 1,175 |
| ~~incentive_rules lossy분~~ | ~~9,227~~ | F-044에서 제거(전용 테이블로 이관). 정산 엔진은 원래 2건만 잔존 |

- 스킵 2,031행: 적용률(지급률) 값 없음(불완전 행). 손보 시상정의(318열 wide·2024.01)는 이번 반영 제외.

## 매핑 규칙 (F-044 최종)

- **id**: `def-sib-{기준월}-{원본행번호}` (결정적 → 재적용 idempotent). created_by=`import:sisang-saengbo-260708`.
- **컬럼(무손실)**: insurer_id, base_month, line_type, product, pay_term(납입기간), pay_timing(지급시점: 익월/13차월/15차월/구간/연속/가동), channel(FC/법인), branch(적용지점), cond1~3, rate_type, rate_value, note, source_type(xlsx), source_ref, plan_image_key(OCR 역추적용, xlsx는 NULL).
- **rate_type**: 적용률 < 100 → `rate`(보험료×배수), ≥ 100 → `fixed`(구간 정액). 근거: rules 엔진 `amount = premium × rate`.
- **보험사명 정규화**: 파일의 축약명(DB손보·KB라이프·한화손보·MG손보·롯데손보·농협손보·하나손보·메트라이프)을 기존 영문 슬러그 id로 매핑, 신규 7개사만 생성.
- **조회**: GET /api/incentive-plan-definitions(?insurerId·?month·?q+페이지) · /summary(월별 집계).

## 재적용 방법

```bash
# 1) migration 0004 적용 (전용 테이블)
cd apps/api && pnpm exec wrangler d1 migrations apply ga-settle-db --remote   # 또는 --local
# 2) SQL 생성 + 적용
node scripts/import-sisang-saengbo.mjs "docs/specs/고객제공자료/260708/시상정의_생보.xlsx" /tmp/out
for f in /tmp/out/00_insurers.sql /tmp/out/1?_defs_*.sql; do
  pnpm exec wrangler d1 execute ga-settle-db --remote --file "$f"   # 또는 --local
done
```

DELETE 헤더(첫 정의 파일)가 created_by 일치분을 먼저 지우므로 재실행 안전.

**함정**: `wrangler d1 execute --file`에서 다행 INSERT 문이 250행이면 `SQLITE_TOOBIG`(문 길이 한도) → **50행/문**(~24KB)으로 청크(임포터 기본).

## 주의/후속

- 시상정의는 참조 카탈로그(정산 엔진 평가 대상 아님). 정산에 쓰려면 정의→운영룰(incentive_rules) 확정 흐름 필요([[B-012]]).
- 손보 시상정의(2024.01, 318열) 정규화 반영은 미실시([[B-012]]).
- OCR(F-043)→정의 write 결선, 정의→운영룰 확정 UI, 감사 소명 화면은 [[B-012]] 잔여.
