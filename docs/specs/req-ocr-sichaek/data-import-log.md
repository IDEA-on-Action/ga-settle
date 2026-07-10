# 시상정의 데이터 반영 로그

- 일시: 2026-07-10
- 출처: `docs/specs/고객제공자료/260708/시상정의_생보.xlsx` (에이티에셋 제공)
- 반영 대상: 로컬 D1 + 프로덕션 D1(`ata.minu.best`, ga-settle-db)
- 임포터: `scripts/import-sisang-saengbo.mjs` (재현 가능)

## 반영 내용

| 항목 | 건수 | 비고 |
|------|------|------|
| 원수사(insurers) | 33 | 기존 26 + 신규 7(INSERT OR IGNORE). 신규: ABL생명·IBK연금보험·iM라이프·KDB생명·카디프생명·하나생명·AIG손해보험 |
| 시책룰(incentive_rules) | 9,227 | 생보 시상정의 11,258행 중 적용률 있는 9,227행. rate 8,052 / fixed 1,175 |

- 스킵 2,031행: 적용률(지급률) 값 없음(불완전 행). 손보 시상정의(318열 wide·2024.01)는 이번 반영 제외.

## 매핑 규칙

- **id**: `sib-{기준월}-{원본행번호}` (결정적 → 재적용 idempotent). created_by=`import:sisang-saengbo-260708`.
- **condition**: period(기준월 1일~말일), insurerIds([파일명→기존 id 매핑]), productPatterns([상품1]).
- **action**: 적용률 < 100 → `{kind:"rate", rate}` (보험료×배수), ≥ 100 → `{kind:"fixed", amount}` (구간 정액). 근거: rules 엔진 `amount = premium × rate`.
- **_source**: 현 스키마에 없는 차원(납입기간·지급시점·채널·적용지점·조건1~3·비고)을 conditionJson `_source`에 원형 보존(엔진은 무시, 감사/역추적용).
- **보험사명 정규화**: 파일의 축약명(DB손보·KB라이프·한화손보·MG손보·롯데손보·농협손보·하나손보·메트라이프)을 기존 영문 슬러그 id로 매핑, 신규 7개사만 생성.

## 재적용 방법

```bash
node scripts/import-sisang-saengbo.mjs "docs/specs/고객제공자료/260708/시상정의_생보.xlsx" /tmp/out
cd apps/api
for f in /tmp/out/00_insurers.sql /tmp/out/1?_rules_*.sql; do
  pnpm exec wrangler d1 execute ga-settle-db --remote --file "$f"   # 또는 --local
done
```

DELETE 헤더(첫 규칙 파일)가 created_by 일치분을 먼저 지우므로 재실행 안전.

## 주의/후속

- 9,227건 전부 active=1. 프로덕션엔 현재 커미션/정산 데이터가 없어 즉시 영향 없음. 향후 정산 run은 계약일이 속한 월(period)·상품 패턴이 맞는 룰만 평가.
- 현 스키마가 담지 못하는 차원(납기·지급시점·채널)은 `_source`에만 있어 엔진 평가에 반영 안 됨 → 정식 반영은 스키마 확장([[B-012]]).
- 손보 시상정의(2024.01, 318열) 정규화 반영은 미실시.
