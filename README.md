# ga-settle

> GA 수수료·시책 통합 정산/대사 시스템 (위시켓 156459)
> harness-kit-template v0.1.1 규약 기반 · Cloudflare Workers + Hono + pnpm + Turborepo
> SoT: SPEC.md (F-001~F-023) · 상위: 위시켓_PRD_156459 / 위시켓_아키텍처_156459

## WSL 이관 + 셋업

```bash
cp -r "/mnt/c/Users/sincl/OneDrive/문서/Claude/Projects/위시켓(Wishket)/ga-settle" ~/work/idea-on-action/
cd ~/work/idea-on-action/ga-settle
bash scripts/setup.sh     # dot-* rename + git init + pnpm install
```

## ⚠ dot-* 폴더 rename (harness-kit 규약)

OneDrive/Cowork 워크스페이스에서 `.claude/`, `.github/`가 차단되므로 `dot-claude/`, `dot-github/`로 두었다. `scripts/setup.sh`가 자동 rename한다. 수동 시:

```bash
mv dot-claude .claude && mv dot-github .github
```

## 첫 실행

```bash
pnpm dev                          # web(5173) + api(8787)
curl http://localhost:8787/health # {"ok":true}
pnpm test                         # packages/mapping 검증 테스트 포함
```

## Cloudflare 리소스 (F-001에서 생성)

```bash
wrangler d1 create ga-settle-db
wrangler r2 bucket create ga-settle-uploads
wrangler queues create ga-settle-parse
# 생성된 id를 apps/api/wrangler.toml의 TODO에 기입
```

## Claude Code 운용

`/ax:session-start` → SPEC.md에서 F-item 선택 → `/ax:task start` 또는 `/ax:sprint` → 구현+테스트 → `/ax:code-verify` → `/ax:session-end`. 수치는 `/ax:daily-check`가 실측 (SPEC 하드코딩 금지).
