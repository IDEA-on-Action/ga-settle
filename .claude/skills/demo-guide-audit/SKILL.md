---
name: demo-guide-audit
description: 데모 사이트(apps/api/src/demo.ts)와 도움말·가이드(apps/web/src/content/guide.ts, 가이드 PDF)가 현재 시스템 상태(라우트·기능·수치)를 제대로 반영하는지 점검하고 어긋난 부분을 갱신한다. 기능 배포·화면 추가·수치 변경 후, 그리고 세션 종료(/ax:session-end) 시 함께 실행한다. Use when 데모 점검, 가이드 점검, 도움말 최신화, content currency, demo/guide 동기화, 기능 배포 후 문서 점검.
---

# demo-guide-audit - 데모·도움말 현행성 점검

데모(`apps/api/src/demo.ts`)와 도움말/가이드(`apps/web/src/content/guide.ts` → Guide 화면·HelpPanel·Tour·PDF 공용 단일 소스)가 **현재 시스템 상태**를 반영하는지 점검하고, 어긋난 부분을 갱신한다.

## 왜 필요한가

- 데모·가이드는 고객 접점 산출물인데, 기능이 빠르게 추가되면(F-043~F-054 등) 문구가 뒤처진다.
- 특히 **새 필수 단계**(예: F-051 업로드 시 대분류 선택)가 가이드에 빠지면 고객이 막힌다.
- 이 스킬은 **구조 점검(결정적)** + **카피 리뷰(LLM)** 2단으로 drift를 잡는다.

## 언제 실행하나

1. 기능 배포/화면 추가/네비 변경 후 (수동: `/demo-guide-audit`)
2. `/ax:session-end` 시 코드 변경에 `apps/web/src/routes.tsx`·`apps/*/src/**` 기능 변경이 있으면 함께
3. 원수사/시상정의 등 **수치가 바뀐 뒤**

## Steps

### 1. 구조 점검 (자동, 결정적)

```bash
bash scripts/content-currency-check.sh
```

- `content currency: OK` → 구조 이상 없음. 2단계(카피 리뷰)만 가볍게.
- `content currency: N건` → 아래 유형별로 처리:

| 유형 | 의미 | 조치 |
|------|------|------|
| screenHelp 누락 | 라우트에 화면별 도움말 부재 | `guide.ts` screenHelp에 해당 경로 항목 추가 |
| 가이드 단계 라우트 무효 | guideStep.route가 실재 안 함 | 라우트 이름변경/삭제 반영 (step route 수정) |
| 기능 미반영 | 최근 기능 키워드가 데모·가이드에 없음 | 해당 기능을 guideStep/screenHelp/데모 카피에 반영 |
| 수치 확인 필요 | 데모 하드코딩 수치 | SPEC/운영 실측(원수사·시상정의 수)과 대조 후 수정 |

> `--json`으로 기계 판독 출력. session-end 등에서 `warn>0`이면 안내만 하고 자동 수정은 하지 않는다(카피는 사람/LLM 판단 필요).

**신규 기능 배포 시 커버리지 유지**: `scripts/content-currency-check.sh`의 `FEATURE_KW` 배열에 대표 키워드 1줄을 추가한다(예: 새 기능 X → `["X(F-0NN)"]="키워드"`). 이렇게 해야 다음 점검부터 그 기능의 문서 반영이 자동 추적된다.

### 2. 카피 리뷰 (LLM, 뉘앙스)

구조 점검이 못 잡는 "문구가 기능을 제대로 설명하는가"를 리뷰한다.

1. 최근 완료 기능 수집: `grep -nE "^### F-0" SPEC.md | tail -12` + 각 F-item의 사용자 관찰 가능한 변화 파악.
2. `apps/web/src/content/guide.ts`(guideSteps·screenHelp·tourSteps)와 `apps/api/src/demo.ts` 카피를 읽는다.
3. 대조 질문:
   - 새 화면/단계가 guideStep·screenHelp에 있는가?
   - 새 **필수 입력/단계**(예: 대분류 선택)가 절차에 반영됐는가?
   - 데모가 주장하는 능력/수치가 현재와 맞는가?
   - 삭제·이름변경된 화면이 문구에 남아있지 않은가?
4. 어긋난 항목을 목록화한다(파일·라인·현재문구·권장문구).

### 3. 갱신 (승인 후)

1. `guide.ts`/`demo.ts` 문구를 수정한다(단일 소스라 Guide 화면·HelpPanel·Tour에 자동 전파).
2. **가이드 PDF 재생성**(guide.ts 변경 시 필수):
   ```bash
   pnpm -F web guide:pdf
   ```
3. 검증: `bash scripts/content-currency-check.sh` 재실행 → `OK` 확인. `pnpm -F web exec tsc --noEmit`.
4. 커밋 → PR → 머지 → 배포(`pnpm -F api deploy:prod`). 데모/가이드 문구만 바뀌면 web 빌드 후 배포.

### 4. 결과 요약

```
## 데모·도움말 현행성 점검
- 구조 점검: OK / N건 (유형별)
- 카피 리뷰: N건 (파일:라인)
- 조치: 갱신 N건 / 확인 필요 N건 / PDF 재생성 여부
```

## Gotchas

- **단일 소스 원칙**: 도움말 문구는 `guide.ts` 한 곳만 고친다(Guide·HelpPanel·Tour·PDF 공용). demo.ts는 별도.
- **PDF 재생성 잊지 말 것**: guide.ts 문구를 고쳤는데 `guide:pdf`를 안 돌리면 다운로드 PDF만 구버전이 된다.
- **수치는 자동 판정 금지**: 원수사·시상정의 수는 운영 DB 실측값이라 스크립트는 "확인 필요"로만 플래그. SPEC/메모리 문서값 또는 prod 조회로 대조 후 수정.
- **/portal(F-054)은 별도 접점**: 데모·가이드는 `/app` 파이프라인 대상. 포털 콘텐츠(`portal.ts`)는 이 점검 범위 밖(포털은 자체 큐레이션 상수).
