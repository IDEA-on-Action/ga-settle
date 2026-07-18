# OTP 이메일 발송 설정 런북 (B-007)

`@atasset.co.kr` 계정의 **이메일 OTP 실발송**을 활성화하는 운영 절차. F-033 앱 로직은 이미 구현·배포돼 있고(`sendEmail` via Resend + OTP 요청/검증 + `OTP_ENFORCED` 게이트), 이 문서는 **인프라 설정만** 다룬다.

> **거버넌스**: Resend 계정은 반드시 **생각과 행동(ATA)** 소유여야 한다. **ktds.io Resend 계정 사용 금지**(2026-07-08 ktds 키 임시설정 후 삭제한 선례). 계약 주체가 생각과 행동이므로 자산도 생각과 행동 소유로.

## 현재 상태 (2026-07-18 실측)

| 구성 | 값 |
|------|-----|
| 앱 로직 | ✅ 구현·배포됨 (F-033) |
| 발신 주소 | `no-reply@atasset.co.kr` (`OTP_FROM_EMAIL`, wrangler.toml) |
| OTP 도메인 | `atasset.co.kr` (`OTP_EMAIL_DOMAIN`) |
| `RESEND_API_KEY` (prod secret) | ⬜ 미설정 |
| `OTP_ENFORCED` (prod var) | ⬜ 미설정 = off (임시비번 로그인 허용) |
| atasset.co.kr 기존 메일 | MailPlug (MX `mx01/mx02.mailplug.com`, SPF `v=spf1 mx include:mailplug.com ~all`) |
| `send.atasset.co.kr` | 비어있음 (Resend 반송 도메인용 가용) |
| DNS 관리 | 누리호스팅 |

## ⚠️ 순서가 중요 (락아웃 방지)

`OTP_ENFORCED=true`는 `@atasset.co.kr` 계정의 **비밀번호 로그인을 차단**하고 OTP만 허용한다. **이메일 발송이 실제로 되기 전에 이 플래그를 켜면 해당 계정들이 로그인 불가**가 된다. 반드시 아래 순서를 지킨다:

```
1. Resend 계정 → 2. 도메인 추가 → 3. DNS 레코드 → 4. Resend 검증 통과
→ 5. RESEND_API_KEY 시크릿 → 6. 테스트 발송 성공 확인 → 그다음에야 → 7. OTP_ENFORCED=true
```

---

## 대안: 발신 도메인을 minu.best로 (고객 도메인 접근 불가 시) ⭐

> **2026-07-18 상황**: atasset.co.kr은 **고객(ATA) 소유 도메인**이라 생각과 행동이 DNS를 편집할 권한이 없다 → root 검증(Step 2~4) 불가로 B-007 보류. 아래 대안으로 **고객 DNS 없이** 활성화할 수 있다.

**핵심**: OTP를 **보내는 대상**은 `@atasset.co.kr` 메일함이지만, **발신(from) 도메인은 우리가 통제하는 아무 도메인**이나 된다. `minu.best`는 생각과 행동 **Cloudflare zone**(계정 `02ae9a2bead25d99caa8f3258b81f568`)이라 DNS를 자유롭게 편집할 수 있다. `no-reply@ata.minu.best`(또는 `@send.minu.best`)에서 @atasset 메일함으로 OTP를 보낸다.

**차이점(root 방식 대비)**:
- 발신 주소가 `no-reply@atasset.co.kr` → **`no-reply@ata.minu.best`**로 변경 (브랜딩만 다름, 기능 동일). `wrangler.toml`의 `OTP_FROM_EMAIL` 1줄 수정.
- Resend 도메인 검증 대상이 `atasset.co.kr` → **`minu.best`**(또는 `ata.minu.best` 서브도메인).
- **DNS는 우리 Cloudflare zone이라 자체 추가 가능** (누리호스팅/고객 개입 불요). Resend 계정 가입만 사용자 몫.
- 수신측(@atasset) 스팸 필터가 minu.best 발신을 걸 가능성은 낮음(정상 SPF/DKIM 검증 도메인이면). 우려되면 이체/공지 메일과 동일 도메인 평판 관리.

**대안 절차 요약**:
1. Resend 계정(생각과 행동) 가입 (Step 1 동일).
2. Resend에 **`minu.best`** 도메인 추가 → DNS 레코드 수령.
3. **Cloudflare 대시보드(또는 API/wrangler)로 minu.best zone에 레코드 추가**: 우리 zone이라 즉시 가능. Resend Verify.
4. `OTP_FROM_EMAIL = "no-reply@ata.minu.best"`로 `wrangler.toml` 수정 (코드/PR 경유).
5. 이후 Step 5(시크릿)에서 Step 8(테스트·플래그)은 동일.

> 고객이 나중에 atasset.co.kr DNS 접근을 열어주면 그때 root 방식(위 본문)으로 전환하고 `OTP_FROM_EMAIL`을 되돌리면 된다. 대안은 **접근 제약을 우회하는 임시/영구 경로**이지 기능 손실이 아니다.

---

## Step 1. Resend 계정 (생각과 행동)

1. https://resend.com 에서 **생각과 행동 소유** 계정으로 로그인/가입 (예: sinclairseo@gmail.com 또는 회사 공용 계정).
2. 무료 플랜: 월 3,000통 / 일 100통 (OTP 용도로 충분).

## Step 2. 도메인 추가 (root 방식 권장)

1. Resend 대시보드 → **Domains → Add Domain** → `atasset.co.kr` 입력 (root).
2. Resend가 아래 형태의 DNS 레코드를 제시한다 (**정확한 값은 대시보드에서 복사**):

| 유형 | 이름(호스트) | 값 | 용도 |
|------|-------------|-----|------|
| MX | `send.atasset.co.kr` | `feedback-smtp.<region>.amazonses.com` (우선순위 10) | 반송(bounce) 처리 |
| TXT | `send.atasset.co.kr` | `v=spf1 include:amazonses.com ~all` | 반송 도메인 SPF |
| TXT (또는 CNAME) | `resend._domainkey.atasset.co.kr` | `p=MIGf...`(DKIM 공개키) | DKIM 서명 |
| TXT | `_dmarc.atasset.co.kr` (선택) | `v=DMARC1; p=none;` | DMARC(없으면 Resend 기본 권장값) |

> **root 방식을 쓰는 이유**: 발신 주소가 `no-reply@atasset.co.kr`(root)라 DKIM을 root에 얹어야 DMARC 정렬(alignment)이 맞는다. Resend는 **반송/SPF를 `send.` 서브도메인**에 두므로, MailPlug의 **root MX·root SPF는 건드리지 않는다**. 발신 주소 변경 불필요(코드 0 변경).

## Step 3. 누리호스팅 DNS에 레코드 추가

1. 누리호스팅 DNS 관리에서 Step 2의 레코드를 **그대로** 추가한다.
2. **MailPlug와 공존 확인 (충돌 없음)**:
   - root `MX`(mailplug): **유지, 건드리지 않음** (Resend MX는 `send.` 서브도메인에만 추가)
   - root `TXT` SPF `v=spf1 mx include:mailplug.com ~all`: **유지, 건드리지 않음** (Resend SPF는 `send.` 서브도메인 별도)
   - `resend._domainkey` DKIM, `send.atasset.co.kr` MX/SPF: **신규 추가** (기존과 이름 겹치지 않음)
3. ⚠️ **root SPF에 Resend를 넣지 말 것**: Resend 반송 도메인은 `send.*`이라 root SPF 병합이 불필요하다. root SPF는 MailPlug 전용으로 둔다.
4. TTL은 기본값. 전파는 보통 수 분에서 수 시간.

## Step 4. Resend에서 도메인 검증

1. DNS 전파 후 Resend 대시보드 → 해당 도메인 → **Verify** 클릭.
2. 모든 레코드가 ✅(Verified)가 될 때까지 대기(전파 지연 시 재시도).
3. 검증 확인용 dig(로컬):
   ```bash
   dig +short TXT resend._domainkey.atasset.co.kr   # DKIM 공개키 보이면 OK
   dig +short MX send.atasset.co.kr                 # feedback-smtp... 보이면 OK
   dig +short TXT send.atasset.co.kr                # v=spf1 include:amazonses.com 보이면 OK
   # MailPlug 무영향 확인:
   dig +short MX atasset.co.kr                      # mx01/mx02.mailplug.com 그대로여야 함
   ```

## Step 5. RESEND_API_KEY prod 시크릿 설정

1. Resend → **API Keys → Create** (권한: Sending access). 키 복사(`re_...`).
2. 프로덕션 Worker 시크릿 등록:
   ```bash
   cd apps/api
   npx wrangler@4 secret put RESEND_API_KEY --env production
   # 프롬프트에 re_... 붙여넣기
   ```
   - ⚠️ **ktds 키 금지**: 반드시 생각과 행동 Resend 계정의 키.
3. 확인: `npx wrangler@4 secret list --env production` 에 `RESEND_API_KEY` 존재.
4. 로컬 테스트용은 `apps/api/.dev.vars`의 `RESEND_API_KEY=`에도 넣을 수 있다(gitignore, 커밋 금지).

## Step 6. 테스트 발송 (플래그 켜기 전 필수)

`OTP_ENFORCED`를 아직 켜지 **않은** 상태에서 발송만 검증한다(락아웃 방지).

1. 프로덕션에 실 `@atasset.co.kr` 계정이 있어야 함(없으면 admin이 `POST /api/users`로 생성).
2. OTP 코드 요청:
   ```bash
   curl -s -X POST https://ata.minu.best/api/auth/otp/request \
     -H 'content-type: application/json' \
     -d '{"email":"someone@atasset.co.kr"}'
   # 200 (계정 존재 여부와 무관하게 열거 방지로 200)
   ```
3. **해당 메일함에 "ATA 로그인 인증 코드" 메일이 실제 도착하는지 확인**(스팸함 포함).
4. 도착 안 하면: `wrangler tail --env production`으로 `이메일 발송 실패`/`RESEND_API_KEY 미설정` 로그 확인 → Resend 대시보드 **Logs**에서 반송/거부 사유 확인. 흔한 원인: 도메인 미검증, from 도메인 불일치, 수신측 스팸 필터.

## Step 7. OTP_ENFORCED=true (발송 성공 확인 후에만)

발송이 확인되면 강제 플래그를 켠다. `wrangler.toml` `[env.production.vars]`에 추가:

```toml
[env.production.vars]
ENV = "production"
OTP_EMAIL_DOMAIN = "atasset.co.kr"
OTP_FROM_EMAIL = "no-reply@atasset.co.kr"
OTP_ENFORCED = "true"          # 추가 (B-007)
```

- 이 변경은 **코드 변경**이므로 `feat/f-NNN` 또는 `chore` 브랜치 → PR → CI → merge → 자동배포(B-014) 경로로.
- 배포 후 `@atasset.co.kr` 비번 로그인이 **403 `{otp:true}`**로 차단되고 OTP 흐름으로 유도되는지 확인:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://ata.minu.best/api/auth/login \
    -H 'content-type: application/json' -d '{"email":"someone@atasset.co.kr","password":"x"}'
  # 403 기대 (OTP_ENFORCED=on)
  ```

## Step 8. 최종 확인 (E2E)

1. `@atasset.co.kr` 계정으로 `https://ata.minu.best/app` 로그인 시도 → 비번 대신 OTP 화면.
2. `otp/request` → 메일 수신 → 6자리 입력 → `otp/verify` → 로그인 성공.
3. admin(`sinclairseo@gmail.com`, @gmail)은 OTP 대상 아님 → 비번 로그인 유지 확인.

## 롤백 (락아웃 발생 시)

`OTP_ENFORCED=true` 후 발송이 안 돼 `@atasset` 계정이 로그인 못 하면:
1. **즉시 `OTP_ENFORCED` 제거**(또는 `"false"`)로 되돌려 PR→배포 → 임시비번 로그인 복구.
2. vars는 배포 반영이라 가장 빠른 복구는 `OTP_ENFORCED` 삭제 재배포.
3. admin(@gmail 비번)은 항상 로그인 가능하므로 admin으로 `reset-password`로 임시비번 재발급 가능.

## 완료 조건 (B-007 DONE 기준)

- [ ] Resend 도메인 `atasset.co.kr` Verified (생각과 행동 계정)
- [ ] `RESEND_API_KEY` prod 시크릿 설정
- [ ] 실 @atasset 계정 테스트 OTP 메일 **수신 확인**
- [ ] `OTP_ENFORCED=true` 배포 + 비번 로그인 403 차단 확인
- [ ] E2E OTP 로그인 성공 1건

## 참고

- 앱 코드: `apps/api/src/email.ts`(sendEmail·genOtpCode·otpEmailHtml), `apps/api/src/routes/auth.ts`(otp/request·otp/verify·login 게이트)
- 관련 F-item: F-033(OTP UI+로직), F-027(도메인 게이트)
- 배포는 `docs/DEPLOY.md`, 운영은 `docs/OPERATIONS.md` 참조
