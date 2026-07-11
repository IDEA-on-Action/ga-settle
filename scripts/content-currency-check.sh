#!/usr/bin/env bash
# 데모·도움말이 현재 시스템 상태를 반영하는지 구조 점검 (demo-guide-audit 스킬의 자동 점검부).
# 결정적 검사만 수행: 라우트↔도움말 커버리지, 가이드 라우트 유효성, 최근 DONE F-item 키워드 반영,
# 데모 하드코딩 수치 플래그. 카피 뉘앙스(문구가 기능을 제대로 설명하는가)는 스킬의 LLM 리뷰가 담당.
#
# exit 0 = drift 없음(OK) / exit 1 = drift 감지(WARN) / exit 2 = 소스 파일 부재
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

ROUTES_FILE="apps/web/src/routes.tsx"
GUIDE_FILE="apps/web/src/content/guide.ts"
DEMO_FILE="apps/api/src/demo.ts"
SPEC="SPEC.md"

JSON_MODE=0
[ "${1:-}" = "--json" ] && JSON_MODE=1

for f in "$ROUTES_FILE" "$GUIDE_FILE" "$DEMO_FILE"; do
  [ -f "$f" ] || { echo "ERROR: 소스 파일 부재: $f"; exit 2; }
done

WARN=0
declare -a FINDINGS=()
note() { FINDINGS+=("$1"); WARN=$((WARN + 1)); }

# ── 1) 라우트 목록 (routes.tsx의 path:"...") ──────────────────
ROUTES=$(grep -oP 'path:\s*"\K[^"]+' "$ROUTES_FILE" | sort -u)
# screenHelp 키: guide.ts의 `"/x": {` (screenHelp 객체 내부). route: 값과 구분 위해 앞에 콜론 없는 형태.
HELP_KEYS=$(grep -oP '^\s*"\K/[a-z0-9-]*(?"?)' "$GUIDE_FILE" 2>/dev/null | sed 's/"$//' | sort -u)
# 위 패턴이 취약하므로 보강: `"path": {` 형태 명시 추출
HELP_KEYS=$(grep -oP '"\K/[a-z0-9-]*(?="\s*:\s*\{)' "$GUIDE_FILE" | sort -u)
# guideSteps의 route 값
STEP_ROUTES=$(grep -oP 'route:\s*"\K[^"]+' "$GUIDE_FILE" | sort -u)

# ── 2) 커버리지: 모든 라우트가 screenHelp를 갖는가 ──────────────
# /guide(사용 가이드 화면 자체)는 HelpPanel 대상이 아니므로 제외.
HELP_EXCLUDE="^(/guide)$"
while IFS= read -r r; do
  [ -z "$r" ] && continue
  [[ "$r" =~ $HELP_EXCLUDE ]] && continue
  if ! echo "$HELP_KEYS" | grep -qxF "$r"; then
    note "screenHelp 누락: 라우트 '$r' 에 화면별 도움말이 없어요 (guide.ts screenHelp)"
  fi
done <<< "$ROUTES"

# ── 3) 가이드 라우트 유효성: guideStep.route가 실재 라우트인가 ────
while IFS= read -r sr; do
  [ -z "$sr" ] && continue
  if ! echo "$ROUTES" | grep -qxF "$sr"; then
    note "가이드 단계 라우트 무효: guideStep route '$sr' 가 routes.tsx에 없어요 (삭제/이름변경?)"
  fi
done <<< "$STEP_ROUTES"

# ── 4) 최근 DONE F-item 키워드가 데모/가이드에 반영됐는가 (휴리스틱) ─
# SPEC의 최근 완료 기능에서 대표 키워드를 뽑아 guide.ts+demo.ts 어디에도 없으면 WARN.
# 키워드는 유지보수 지점: 새 기능 배포 시 여기 1줄 추가하면 점검 커버리지가 따라온다.
declare -A FEATURE_KW=(
  ["시책안 대분류(F-051)"]="대분류"
  ["납입기간별 지급율(F-052)"]="납입기간"
  ["구간시상(F-053)"]="구간시상"
  ["시책안 등록 대장(F-048)"]="등록 내역"
)
CONTENT="$(cat "$GUIDE_FILE" "$DEMO_FILE" 2>/dev/null)"
for feat in "${!FEATURE_KW[@]}"; do
  kw="${FEATURE_KW[$feat]}"
  if ! grep -qF "$kw" <<< "$CONTENT"; then
    note "기능 미반영: $feat - 키워드 '$kw' 가 데모·가이드 어디에도 없어요"
  fi
done

# ── 5) 데모 하드코딩 수치 플래그 (SPEC/운영 실측과 대조 필요) ──────
# "N개 원수사" 류 하드코딩을 뽑아 사람이 실측과 대조하도록 안내(자동 판정 아님).
NUM_CLAIMS=$(grep -oE '[0-9][0-9,]*개? ?원수사|원수사 [0-9][0-9,]*곳?' "$DEMO_FILE" | sort -u)
if [ -n "$NUM_CLAIMS" ]; then
  while IFS= read -r claim; do
    [ -z "$claim" ] && continue
    note "수치 확인 필요(데모): '$claim' - SPEC/운영 실측 원수사 수와 일치하는지 확인 (하드코딩)"
  done <<< "$NUM_CLAIMS"
fi

# ── 출력 ──────────────────────────────────────────────────
if [ "$JSON_MODE" = "1" ]; then
  printf '{"warn":%d,"findings":[' "$WARN"
  for i in "${!FINDINGS[@]}"; do
    esc=$(printf '%s' "${FINDINGS[$i]}" | sed 's/\\/\\\\/g; s/"/\\"/g')
    [ "$i" -gt 0 ] && printf ','
    printf '"%s"' "$esc"
  done
  printf ']}\n'
else
  if [ "$WARN" -eq 0 ]; then
    echo "content currency: OK (라우트↔도움말 커버리지·가이드 라우트·최근기능·수치 이상 없음)"
  else
    echo "⚠️  content currency: ${WARN}건 점검 필요"
    for f in "${FINDINGS[@]}"; do echo "  - $f"; done
  fi
fi

[ "$WARN" -eq 0 ] && exit 0 || exit 1
