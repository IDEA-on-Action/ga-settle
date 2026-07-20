# 배포 런북 (F-023)

> ga-settle 프로덕션 배포 절차. **비가역 단계는 사람이 실행** (Claude/자동화 금지).
> Cloudflare 계정: 생각과 행동 (02ae9a2bead25d99caa8f3258b81f568).

## 프로덕션 환경

- **URL**: `https://z01.minu.best` (커스텀 도메인, wrangler.toml `[env.production]`)
- Worker: `ga-settle-api-production` (`--env production`). D1/R2/Queue는 dev와 동일 원격 리소스 공유(로컬 dev는 `--local`이라 미영향).
- **사전 요건**: `minu.best`가 이 Cloudflare 계정(생각과 행동)의 **zone**이어야 배포 시 DNS 레코드 + TLS 인증서가 자동 발급됨. zone 미등록 시 먼저 도메인을 CF에 추가.

## 배포 절차 (프로덕션)

### 1. 프로덕션 시크릿 설정 (비가역, 사람이 실행)

```bash
cd apps/api
wrangler secret put ANTHROPIC_API_KEY    --env production   # Claude API 키 (L2 매핑)
wrangler secret put FIELD_ENCRYPTION_KEY --env production   # 금액/인적정보 AES-GCM 키 (32자+ 랜덤). 분실 시 기존 암호문 복호화 불가 - 안전 보관
wrangler secret put SESSION_SECRET       --env production   # 세션 토큰 HMAC 키 (랜덤)
wrangler secret put ADMIN_IP_ALLOWLIST   --env production   # 계정 부트스트랩 허용 IP (쉼표 구분)
```

> `--env production` 필수. env마다 시크릿 저장소가 분리됨. `FIELD_ENCRYPTION_KEY`는 로테이션 시 기존 데이터 재암호화 필요 - 최초 설정 후 변경 주의.

### 2. D1 원격 마이그레이션 (비가역, 사람이 실행)

```bash
pnpm -F api d1:migrate:remote   # wrangler d1 migrations apply ga-settle-db --remote
```
0000(테이블 18) + 0001(마감/audit 트리거) 적용. 적용 후 `d1_migrations`로 확인. (D1은 db 단위라 env 무관 동일 ga-settle-db.)

### 3. Worker 배포 (커스텀 도메인 포함)

```bash
cd apps/api && pnpm deploy:prod    # wrangler deploy --env production
```
최초 배포 시 `z01.minu.best` 커스텀 도메인(DNS+cert) 자동 생성. 번들 ~264KB gzip. Version ID 기록.

### 4. 스모크 테스트 (배포 직후 필수)

```bash
curl https://z01.minu.best/health   # {"ok":true,"env":"production"}
# 부트스트랩 관리자 계정 (ADMIN_IP_ALLOWLIST 허용 IP에서)
curl -X POST https://z01.minu.best/api/users -H 'content-type: application/json' -d '{"email":"admin@...","name":"관리자","role":"admin","password":"..."}'
curl -X POST https://z01.minu.best/api/auth/login -H 'content-type: application/json' -d '{"email":"admin@...","password":"..."}'   # -> token
```

> 인증 롤아웃(F-024): `/api/*`는 로그인/부트스트랩 외 전부 Bearer 토큰 필수. 스모크의 이후 호출은 `-H "authorization: Bearer <token>"`.

### 5. 프론트(선택)

`apps/web`은 최소 스캐폴드(B-006). 배포 시 `VITE_API_BASE=https://z01.minu.best`로 빌드.

## 배포 전 체크리스트

- [ ] `pnpm typecheck && pnpm test && pnpm build` 그린 (CI 통과)
- [ ] `pnpm -F api deploy:prod:dry` 번들 성공 (ENV=production 확인)
- [ ] `minu.best` zone이 CF 계정에 등록됨
- [ ] 프로덕션 시크릿 4종 `--env production` 설정 (`wrangler secret list --env production`)
- [ ] D1 원격 마이그레이션 적용 (`d1_migrations` 확인)
- [ ] 스모크: https://z01.minu.best/health 200(env=production), 부트스트랩 계정, 로그인
- [ ] 실샘플 업로드 -> 파싱 -> 매핑 -> 승인 -> 정산 -> 대사 -> 마감 1건 수동 검증

## 트러블슈팅: z01.minu.best 403 "Attention Required" (WAF)

**증상**: 배포·도메인·TLS 정상인데 `curl https://z01.minu.best/health`가 Cloudflare `Attention Required! | Cloudflare` 403. 브라우저 UA로도 403(= UA/봇 기반 아님, 전면 차단).

**원인**: `minu.best` zone(Pro)의 Cloudflare 보안이 워커 도달 전 엣지에서 차단. 실측 2종:
1. **WAF 관리 규칙 집합** (Managed Ruleset) - `/health` 같은 단순 GET도 오탐 차단.
2. **Super Bot Fight Mode** - 세부 규칙 `manage definite bots`가 curl/Go-http-client 등 "명백한 자동화"를 차단. **API는 프로그램 호출이 정상**이라 이게 진짜 원인이었음. (보안 이벤트 로그 `서비스별 이벤트`에서 차단 주체 확인 가능: minu.best → Security → Analytics → 이벤트)

**해결**: 대상 호스트만 예외 처리하는 WAF Custom Rule(Skip). 나머지 minu.best 보호 유지.
- 경로: minu.best → Security → 보안 규칙 → 규칙 생성 → 사용자 지정 규칙
- 식: `(http.host eq "z01.minu.best")`
- 작업: 건너뛰기(Skip) → **☑ 모든 관리 규칙 + ☑ 모든 Super Bot Fight 모드 규칙** (둘 다 필수 - 관리 규칙만으론 SBFM이 계속 막음)
- 규칙 ID: `c2271915624d4dd1a8a4419d069c0e1a` (2026-07-08 `ata.minu.best`용 최초 생성 → 2026-07-21 도메인 변경으로 식을 `z01.minu.best`로 갱신)
- ⚠️ API 토큰에 zone WAF 권한이 없어 이 규칙 편집은 **대시보드 수동 작업** (2026-07-21 실측: rulesets API 10000 Authentication error)

**재배포/도메인 변경 시**: 도메인을 바꾸면 위 Skip 규칙의 식(`http.host`)도 갱신. 새 zone에 배포하면 그 zone의 SBFM/관리규칙 상태를 먼저 확인.

## 롤백

Worker: `wrangler rollback --env production [version-id]`. D1 스키마 롤다운은 역적용 스크립트 필요(미제공 - 마감 스냅샷 R2 보관으로 데이터 복구).
