#!/usr/bin/env node
// 시연용 실데이터 시드 (프로덕션 SPA 전 화면 구성).
// 기존 업로드(2026-07, aia-life, 설계사 FC1000~FC1022, 원장 180행)에 연결되게
// 조직 -> 설계사/소속 -> 시책 룰 -> 정산 run -> 계산 -> 대사 -> 내역서를 API로 end-to-end 시드한다.
//
// 실행:
//   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=... node scripts/seed-demo.mjs
// 옵션:
//   BASE (기본 https://z01.minu.best), RUN_ID (재실행 시 기존 run id 재사용), MONTH (기본 2026-07)
//
// 멱등: 이미 있는 org/agent/rule은 409를 무시하고 계속. calculate/payslips는 서버가 delete+재생성이라 재실행 안전.

const BASE = (process.env.BASE || "https://z01.minu.best").replace(/\/$/, "");
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const MONTH = process.env.MONTH || "2026-07";
const VALID_FROM = `${MONTH.slice(0, 4)}-01-01`;

if (!EMAIL || !PASSWORD) {
  console.error("ADMIN_EMAIL, ADMIN_PASSWORD 환경변수가 필요해요. 예:");
  console.error("  ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... node scripts/seed-demo.mjs");
  process.exit(1);
}

// 원장의 설계사 23명 (commission_records.agent_id와 일치해야 정산이 귀속됨)
const AGENT_IDS = Array.from({ length: 23 }, (_, i) => `FC${1000 + i}`);
const NAME_POOL = ["김서준", "이하윤", "박도윤", "최지우", "정예준", "강시우", "조하은", "윤지호",
  "장수아", "임건우", "한서연", "오유준", "서지민", "신아린", "권민재", "황서윤",
  "안하준", "송지아", "전우진", "홍채원", "고은우", "문서현", "양지안"];

// 조직 트리: 본부 > 사업단 2 > 팀 3
const ORG = {
  hq: { id: "hq-ata", name: "ATA 영업본부", kind: "headquarters", parentId: null },
  divisions: [
    { id: "div-metro", name: "수도권사업단", kind: "division", parentId: "hq-ata" },
    { id: "div-yeongnam", name: "영남사업단", kind: "division", parentId: "hq-ata" },
  ],
  teams: [
    { id: "team-gangnam1", name: "강남1팀", kind: "team", parentId: "div-metro" },
    { id: "team-gangnam2", name: "강남2팀", kind: "team", parentId: "div-metro" },
    { id: "team-busan1", name: "부산1팀", kind: "team", parentId: "div-yeongnam" },
  ],
};
const TEAM_IDS = ORG.teams.map((t) => t.id);

let token = "";
async function api(method, path, body, { ok409 = false } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    if (ok409 && res.status === 409) return { skipped: true, status: 409, json };
    throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  }
  return { json, status: res.status };
}

async function main() {
  // 1) 로그인
  const login = await api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  token = login.json.token;
  if (!token) throw new Error(`로그인 실패: ${JSON.stringify(login.json)}`);
  console.log(`✓ 로그인 (role=${login.json.role})`);

  // 2) 조직 트리
  for (const u of [ORG.hq, ...ORG.divisions, ...ORG.teams]) {
    const r = await api("POST", "/api/org/units", u, { ok409: true });
    console.log(`  org ${r.skipped ? "= 존재" : "+ 생성"}: ${u.name} (${u.id})`);
  }

  // 3) 설계사 23명 + 팀 배정 (원장 agent_id와 동일 id)
  for (let i = 0; i < AGENT_IDS.length; i++) {
    const id = AGENT_IDS[i];
    const name = NAME_POOL[i % NAME_POOL.length];
    await api("POST", "/api/agents", { id, code: id, name }, { ok409: true });
    const teamId = TEAM_IDS[i % TEAM_IDS.length];
    await api("POST", `/api/agents/${id}/assignments`, { orgUnitId: teamId, validFrom: VALID_FROM });
  }
  console.log(`✓ 설계사 ${AGENT_IDS.length}명 + 소속 배정 (${VALID_FROM}~)`);

  // 4) 시책 룰 (stack: 기본 지급률 + 고액계약 보너스)
  const rules = [
    {
      name: "기본 시책 지급률 12%",
      priority: 10,
      overlapPolicy: "stack",
      condition: { period: { from: `${MONTH.slice(0, 4)}-01-01`, to: `${MONTH.slice(0, 4)}-12-31` } },
      action: { kind: "rate", rate: 0.12 },
    },
    {
      name: "고액계약 보너스(보험료 10만↑ 정액 5천)",
      priority: 20,
      overlapPolicy: "stack",
      condition: {
        period: { from: `${MONTH.slice(0, 4)}-01-01`, to: `${MONTH.slice(0, 4)}-12-31` },
        performanceBand: { minPremium: 100000 },
      },
      action: { kind: "fixed", amount: 5000 },
    },
  ];
  for (const rule of rules) {
    const r = await api("POST", "/api/rules", rule, { ok409: true });
    console.log(`  rule ${r.skipped ? "= 존재" : "+ 생성"}: ${rule.name}`);
  }

  // 5) 정산 run (없으면 생성)
  let runId = process.env.RUN_ID;
  if (!runId) {
    const run = await api("POST", "/api/runs", { settlementMonth: MONTH }, { ok409: true });
    if (run.skipped) {
      throw new Error(`${MONTH} run이 이미 있어요. 재실행 시 RUN_ID 환경변수로 기존 run id를 넘겨주세요.`);
    }
    runId = run.json.id;
    console.log(`✓ 정산 run 생성: ${MONTH} (${runId})`);
  } else {
    console.log(`✓ 기존 run 재사용: ${runId}`);
  }

  // 6) 계산 -> 7) 대사 -> 8) 내역서 -> 9) 병행검증
  await api("POST", `/api/runs/${runId}/calculate`);
  const recon = await api("GET", `/api/runs/${runId}/reconciliation`);
  const pay = await api("POST", `/api/runs/${runId}/payslips`);
  const verify = await api("GET", `/api/runs/${runId}/parallel-verify`);
  const runInfo = await api("GET", `/api/runs/${runId}`);

  console.log("✓ 계산/대사/내역서/병행검증 완료");
  console.log("\n── 시연 데이터 요약 ──");
  console.log(`  정산월      : ${MONTH}`);
  console.log(`  run id      : ${runId} (status=${runInfo.json?.status ?? "?"})`);
  console.log(`  내역서      : ${pay.json?.payslips ?? "?"}명, 총 지급 ${fmt(pay.json?.totalAmount)}`);
  console.log(`  병행검증    : verified=${verify.json?.verified} totalDiff=${fmt(verify.json?.totalDiff)}`);
  const diffs = recon.json?.contracts?.filter?.((x) => x.diff && x.diff !== 0)?.length;
  console.log(`  대사 차액   : ${diffs != null ? diffs + "건" : "(recon 응답 확인)"}`);
  console.log(`\n로그인: ${BASE}/app/login  (계정: ${EMAIL})`);
  console.log(`정산 run 화면에서 run id ${runId} 조회 -> 대사/내역서 확인`);
}

function fmt(n) {
  return typeof n === "number" ? "₩" + n.toLocaleString("ko-KR") : String(n);
}

main().catch((e) => { console.error("❌ 시드 실패:", e.message); process.exit(1); });
