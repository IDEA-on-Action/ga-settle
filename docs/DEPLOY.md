# 배포 런북 (F-023)

> ga-settle 프로덕션 배포 절차. **비가역 단계는 사람이 실행** (Claude/자동화 금지).
> Cloudflare 계정: 생각과 행동 (02ae9a2bead25d99caa8f3258b81f568).

## 사전 준비 (1회)

리소스는 생성 완료 (F-001): D1 `ga-settle-db`(6f2e9c25-...3101eb), R2 `ga-settle-uploads`, Queue `ga-settle-parse`.

## 배포 절차

### 1. 프로덕션 시크릿 설정 (비가역, 사람이 실행)

```bash
cd apps/api
wrangler secret put ANTHROPIC_API_KEY      # Claude API 키 (L2 매핑)
wrangler secret put FIELD_ENCRYPTION_KEY   # 금액/인적정보 AES-GCM 키 (32자 이상 랜덤). 분실 시 기존 암호문 복호화 불가 - 안전 보관
wrangler secret put SESSION_SECRET         # 세션 토큰 HMAC 키 (랜덤)
wrangler secret put ADMIN_IP_ALLOWLIST     # 계정 부트스트랩 허용 IP (쉼표 구분). 비우면 부트스트랩 IP 게이트 무효
```

> `FIELD_ENCRYPTION_KEY`는 **로테이션 시 기존 데이터 재암호화 필요**. 최초 설정 후 변경 주의.

### 2. D1 원격 마이그레이션 (비가역, 사람이 실행)

```bash
pnpm -F api d1:migrate:remote   # wrangler d1 migrations apply ga-settle-db --remote
```
0000(테이블 18) + 0001(마감/audit 트리거) 적용. 적용 후 `d1_migrations` 테이블로 확인.

### 3. Worker 배포

```bash
cd apps/api && npx wrangler deploy   # 또는 pnpm -F api deploy
```
번들 ~264KB gzip (Worker 한도 내). 배포 후 Version ID 기록.

### 4. 스모크 테스트 (배포 직후 필수)

```bash
curl https://ga-settle-api.<subdomain>.workers.dev/health   # {"ok":true}
# 부트스트랩 관리자 계정 (허용 IP에서)
curl -X POST .../api/users -H 'content-type: application/json' -d '{"email":"admin@...","name":"관리자","role":"admin","password":"..."}'
# 로그인 -> 토큰
curl -X POST .../api/auth/login -d '{"email":"admin@...","password":"..."}'
```

## 배포 전 체크리스트

- [ ] `pnpm typecheck && pnpm test && pnpm build` 그린 (CI 통과)
- [ ] `wrangler deploy --dry-run` 번들 성공
- [ ] 프로덕션 시크릿 4종 설정 (`wrangler secret list`로 확인)
- [ ] D1 원격 마이그레이션 적용 (`d1_migrations` 확인)
- [ ] 스모크: /health 200, 부트스트랩 계정 생성, 로그인
- [ ] 실샘플 업로드 -> 파싱 -> 매핑 -> 승인 -> 정산 -> 대사 -> 마감 1건 수동 검증

## 롤백

Worker: `wrangler rollback [version-id]`. D1 스키마 롤다운은 마이그레이션 역적용 스크립트 필요 (현재 미제공 - 마감 스냅샷 R2 보관으로 데이터 복구).
