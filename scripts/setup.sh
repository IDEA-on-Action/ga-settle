#!/usr/bin/env bash
# ga-settle 셋업 (harness-kit-template 규약: dot-* rename + git init + install)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[1/4] dot-* rename"
[ -d dot-claude ] && mv dot-claude .claude && echo "  dot-claude -> .claude"
[ -d dot-github ] && mv dot-github .github && echo "  dot-github -> .github"
[ -f .claude/hooks/*.sh ] 2>/dev/null && chmod +x .claude/hooks/*.sh || true

echo "[2/4] 로컬 시크릿 템플릿"
[ -f apps/api/.dev.vars ] || cp .dev.vars.example apps/api/.dev.vars
[ -f apps/web/.env ] || cp .env.example apps/web/.env

echo "[3/4] git init"
if [ ! -d .git ]; then
  git init -b main
  git add -A && git commit -m "chore: bootstrap ga-settle from harness-kit conventions"
fi

echo "[4/4] pnpm install"
command -v pnpm >/dev/null || { echo "pnpm 없음 - corepack enable 후 재실행"; exit 1; }
pnpm install

echo ""
echo "완료. 다음 단계:"
echo "  1) apps/api/.dev.vars 채우기 (ANTHROPIC_API_KEY 등)"
echo "  2) wrangler d1/r2/queues 생성 후 apps/api/wrangler.toml TODO 기입"
echo "  3) pnpm dev  ->  curl localhost:8787/health"
echo "  4) Claude Code에서 /ax:session-start 후 SPEC.md F-001 착수"
