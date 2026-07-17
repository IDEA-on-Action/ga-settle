// 고객 협업 포털 (F-054, ata.minu.best 루트). IA 설계 docs/specs/portal-ia/ia-design-v0.1.md 구현.
// 공개 레이어(홈·개요·진행현황·산출물 목록)는 서버 렌더 HTML(자격증명 미포함), 보호 영역(자료실·소통)은
// 로그인(/app, F-024)으로 유도. 진행 현황은 프로젝트 실상태를 큐레이션(SoT는 SPEC.md, 여기선 고객 대상 요약).

type StageStatus = "done" | "active" | "planned";
interface Stage {
  key: string;
  label: string;
  status: StageStatus;
  note: string;
}
interface Milestone {
  stage: string; // 라벨
  date: string;
  title: string;
}
interface Deliverable {
  title: string;
  kind: string; // 문서|데이터|시스템|가이드
  status: "planned" | "wip" | "done";
  note: string;
  href?: string; // 공개 다운로드/링크
  gated?: boolean; // 로그인 필요
}

const STAGES: Stage[] = [
  { key: "contract", label: "계약", status: "active", note: "제안·데모 완료, 계약 협의 중" },
  { key: "dev", label: "개발", status: "active", note: "정산 파이프라인 구축 (F-001~F-054)" },
  { key: "qa", label: "검수", status: "active", note: "데모 피드백 반영 진행" },
  { key: "ops", label: "운영", status: "planned", note: "배포·모니터링·이관 예정" },
];

const MILESTONES: Milestone[] = [
  { stage: "검수", date: "2026-07-11", title: "데모 통화 피드백 5건 반영 완료 (OCR 10p·납입기간별 지급율·시책룰 항목·삭제 복원·대분류)" },
  { stage: "개발", date: "2026-07-10", title: "시책안 등록 대장 + 업로드 즉시 영속화 배포" },
  { stage: "개발", date: "2026-07-10", title: "시상정의 카탈로그 14,590건 구축 + 감사 역추적" },
  { stage: "개발", date: "2026-07-10", title: "시책안 OCR 실 연동 (CLOVA + Upstage)" },
  { stage: "개발", date: "2026-07-09", title: "전역 인증·업로드 삭제·데모 사용 가이드" },
  { stage: "계약", date: "2026-07-08", title: "데모 시연 + 고객 피드백 수렴 시작" },
];

const DELIVERABLES: Deliverable[] = [
  { title: "사용 가이드", kind: "가이드", status: "done", note: "전체 파이프라인 10단계 안내 PDF", href: "/guide/ga-settle-guide.pdf" },
  { title: "IA 설계 문서", kind: "문서", status: "wip", note: "고객 협업 포털 정보구조 (v0.1 초안)", gated: true },
  { title: "시상정의 카탈로그", kind: "데이터", status: "done", note: "생보·손보 14,590건 (원본 무손실)", gated: true },
  { title: "정산·대사 시스템", kind: "시스템", status: "wip", note: "업로드→매핑→정산→대사→마감→내역서", href: "/app", gated: true },
];

const STATUS_KO: Record<StageStatus, string> = { done: "완료", active: "진행", planned: "예정" };
const DELIV_KO: Record<Deliverable["status"], string> = { planned: "계획", wip: "작성중", done: "완료" };

// ATA 브랜드 SVG 파비콘/로고 (데모와 동일).
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='0'%3E%3Cstop offset='0' stop-color='%2329c7ff'/%3E%3Cstop offset='1' stop-color='%230a72e8'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' rx='14' fill='%230a0e1a'/%3E%3Cpath d='M8 48 Q20 8 31 44 Q43 8 56 48' fill='none' stroke='url(%23g)' stroke-width='7.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";

const CSS = `
:root{--bg:#0a0e1a;--bg2:#0f1524;--card:#141b2d;--card2:#1a2338;--line:#232d44;--fg:#e8edf7;--mut:#93a1bd;--dim:#647089;--brand:#0d8bff;--brand2:#22c3ff;--ok:#2ee6a8;--warn:#ffb020;--bad:#ff5c7a;--grad:linear-gradient(120deg,#0a72e8,#1f9bff 55%,#26d3ff)}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{background:radial-gradient(1200px 700px at 80% -10%,#16224a 0,transparent 55%),radial-gradient(900px 600px at -5% 10%,#141d3a 0,transparent 50%),var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.wrap{max-width:1120px;margin:0 auto;padding:0 22px}
header{position:sticky;top:0;z-index:20;backdrop-filter:blur(10px);background:rgba(10,14,26,.72);border-bottom:1px solid var(--line)}
.nav{display:flex;align-items:center;gap:20px;height:60px}
.logo{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.02em}
.logo .mark{height:27px;width:auto;filter:drop-shadow(0 3px 10px rgba(13,139,255,.5))}
.logo small{font-weight:600;color:var(--mut);font-size:11px}
.nav .sp{flex:1}
.navlink{color:var(--mut);font-size:14px;font-weight:600;padding:6px 2px;border-bottom:2px solid transparent}
.navlink:hover{color:var(--fg)}
.navlink.on{color:var(--fg);border-bottom-color:var(--brand)}
.navlink .lk{font-size:11px;opacity:.7}
.btn{display:inline-flex;align-items:center;gap:8px;padding:9px 15px;border-radius:10px;font-weight:700;font-size:13.5px;cursor:pointer;border:1px solid transparent;transition:.15s}
.btn.p{background:var(--grad);color:#fff;box-shadow:0 8px 24px rgba(91,140,255,.35)}
.btn.p:hover{transform:translateY(-1px)}
.btn.g{background:var(--card);border-color:var(--line);color:var(--fg)}
.btn.g:hover{border-color:var(--brand)}
h1{font-size:clamp(28px,4.6vw,46px);line-height:1.12;letter-spacing:-.03em;margin:16px 0 14px;font-weight:850}
h1 .g{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.lead{font-size:clamp(15px,2vw,18px);color:var(--mut);max-width:660px}
h2{font-size:clamp(21px,3vw,30px);letter-spacing:-.02em;margin:0 0 8px;font-weight:820}
.sub{color:var(--mut);margin:0 0 26px;max-width:660px}
.hero{padding:64px 0 34px}
.kicker{display:inline-flex;align-items:center;gap:8px;color:var(--brand);font-weight:700;font-size:12.5px;border:1px solid var(--line);background:var(--card);padding:6px 12px;border-radius:999px}
.cta{display:flex;gap:12px;margin-top:24px;flex-wrap:wrap}
section{padding:40px 0}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
.card h3{margin:0 0 12px;font-size:15px;font-weight:750}
.mut{color:var(--mut)}.dim{color:var(--dim)}
/* lifecycle */
.life{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:22px 0}
.stg{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:16px;position:relative}
.stg .dot{width:10px;height:10px;border-radius:50%;background:var(--dim);display:inline-block;margin-right:7px}
.stg.done{border-color:rgba(46,230,168,.4)}.stg.done .dot{background:var(--ok)}
.stg.active{border-color:var(--brand);box-shadow:0 6px 22px rgba(13,139,255,.14)}.stg.active .dot{background:var(--brand2);animation:pulse 2s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(46,230,168,.45)}70%{box-shadow:0 0 0 6px rgba(46,230,168,0)}100%{box-shadow:0 0 0 0 rgba(46,230,168,0)}}
.stg b{font-size:16px;font-weight:800;letter-spacing:-.01em}
.stg .st{font-size:12px;font-weight:700;margin-left:6px}
.stg .st.done{color:var(--ok)}.stg .st.active{color:var(--brand2)}.stg .st.planned{color:var(--dim)}
.stg p{margin:8px 0 0;font-size:12.5px;color:var(--mut)}
.bar{height:6px;border-radius:99px;background:var(--card2);margin-top:12px;overflow:hidden}
.bar>i{display:block;height:100%;background:var(--grad)}
/* timeline */
.tl{border-left:2px solid var(--line);margin-left:6px;padding-left:18px}
.tl .it{position:relative;padding:10px 0}
.tl .it::before{content:"";position:absolute;left:-25px;top:16px;width:10px;height:10px;border-radius:50%;background:var(--brand);box-shadow:0 0 0 3px var(--bg)}
.tl .it .m{font-size:12px;color:var(--dim)}
.tl .it .t{font-weight:600;margin-top:2px}
.tag{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;border:1px solid var(--line);background:var(--card2);color:var(--mut);margin-right:6px}
/* deliverables */
.dlist{display:flex;flex-direction:column;gap:10px}
.dl{display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.dl .ic{width:38px;height:38px;flex:0 0 38px;border-radius:10px;background:var(--card2);display:grid;place-items:center;font-size:17px}
.dl .g1{flex:1;min-width:0}
.dl .g1 b{font-weight:750}
.dl .g1 span{display:block;font-size:12.5px;color:var(--mut)}
.pill{font-size:11px;font-weight:700;padding:3px 9px;border-radius:99px}
.pill.done{background:rgba(46,230,168,.14);color:var(--ok)}
.pill.wip{background:rgba(255,176,32,.14);color:var(--warn)}
.pill.planned{background:var(--card2);color:var(--dim)}
.lock{font-size:12px;color:var(--dim)}
.note{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--brand);border-radius:10px;padding:14px 16px;color:var(--mut);font-size:13.5px}
footer{border-top:1px solid var(--line);padding:26px 0;color:var(--dim);font-size:12.5px;margin-top:30px}
footer a{color:var(--mut)}
@media(max-width:760px){.grid2{grid-template-columns:1fr}.life{grid-template-columns:1fr 1fr}.nav{gap:12px;overflow-x:auto}}
`;

type Nav = "home" | "overview" | "status" | "deliverables" | "assets" | "comms";

function topnav(active: Nav): string {
  const link = (href: string, key: Nav, label: string, locked = false) =>
    `<a class="navlink ${active === key ? "on" : ""}" href="${href}">${label}${locked ? ' <span class="lk">🔒</span>' : ""}</a>`;
  return `<header><div class="wrap"><nav class="nav">
    <a class="logo" href="/portal"><svg class="mark" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#29c7ff"/><stop offset="1" stop-color="#0a72e8"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="#0a0e1a"/><path d="M8 48 Q20 8 31 44 Q43 8 56 48" fill="none" stroke="url(#lg)" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>ATA<small style="display:block">생각과 행동 협업 포털</small></span></a>
    <span class="sp"></span>
    ${link("/overview", "overview", "개요")}
    ${link("/status", "status", "진행 현황")}
    ${link("/deliverables", "deliverables", "산출물")}
    ${link("/assets", "assets", "자료실", true)}
    ${link("/comms", "comms", "소통", true)}
    <a class="btn g" href="/app">실 시스템 →</a>
  </nav></div></header>`;
}

function page(title: string, active: Nav, body: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="icon" type="image/svg+xml" href="${FAVICON}"/>
<title>${title} · ATA 협업 포털</title>
<meta name="description" content="계약·개발·검수·운영 전 단계를 함께 보는 GA 수수료·시책 정산 구축 협업 포털."/>
<style>${CSS}</style></head><body>
${topnav(active)}
<main class="wrap">${body}</main>
<footer><div>생각과 행동 (IDEA on Action) · GA 수수료·시책 통합 정산 구축 · <a href="/demo">데모 체험</a> · <a href="/guide/ga-settle-guide.pdf">사용 가이드 PDF</a> · <a href="/app">실 시스템</a></div></footer>
</body></html>`;
}

function lifecycleStrip(): string {
  return `<div class="life">${STAGES.map((s) => {
    const pct = s.status === "done" ? 100 : s.status === "active" ? 55 : 0;
    return `<div class="stg ${s.status}"><span class="dot"></span><b>${s.label}</b><span class="st ${s.status}">${STATUS_KO[s.status]}</span><p>${s.note}</p><div class="bar"><i style="width:${pct}%"></i></div></div>`;
  }).join("")}</div>`;
}

export function portalHome(): string {
  const recent = MILESTONES.slice(0, 3)
    .map((m) => `<div class="it"><div class="m">${m.date} · <span class="tag">${m.stage}</span></div><div class="t">${m.title}</div></div>`)
    .join("");
  const delivs = DELIVERABLES.slice(0, 4)
    .map((d) => {
      const right = d.gated && !d.href?.startsWith("/guide")
        ? '<span class="lock">🔒 로그인</span>'
        : d.href
          ? `<a class="btn g" href="${d.href}">${d.href.endsWith(".pdf") ? "받기" : "열기"}</a>`
          : "";
      return `<div class="dl"><div class="ic">${d.kind === "가이드" ? "📘" : d.kind === "데이터" ? "🗂️" : d.kind === "시스템" ? "⚙️" : "📄"}</div><div class="g1"><b>${d.title}</b><span>${d.note}</span></div><span class="pill ${d.status}">${DELIV_KO[d.status]}</span>${right}</div>`;
    })
    .join("");
  const body = `
  <div class="hero">
    <span class="kicker">● 검수 단계 진행 중</span>
    <h1>GA 수수료·시책 통합 정산<br/><span class="g">구축 협업 포털</span></h1>
    <p class="lead">계약·개발·검수·운영 전 단계를 한곳에서 함께 봅니다. 진행 현황과 산출물은 링크로 바로 확인하시고, 자료·소통은 로그인 후 이용하실 수 있습니다.</p>
    <div class="cta"><a class="btn p" href="/status">진행 현황 보기</a><a class="btn g" href="/deliverables">산출물</a><a class="btn g" href="/demo">데모 체험</a></div>
  </div>
  ${lifecycleStrip()}
  <section><div class="grid2">
    <div class="card"><h3>최근 활동</h3><div class="tl">${recent}</div><div style="margin-top:14px"><a class="navlink" href="/status">전체 진행 현황 →</a></div></div>
    <div class="card"><h3>준비된 산출물</h3><div class="dlist">${delivs}</div><div style="margin-top:12px"><a class="navlink" href="/deliverables">산출물 전체 →</a></div></div>
  </div></section>`;
  return page("홈", "home", body);
}

export function portalOverview(): string {
  const body = `
  <div class="hero"><span class="kicker">프로젝트 개요</span><h1>프로젝트 개요</h1>
  <p class="lead">GA(법인보험대리점) 수수료와 시책을 통합 정산·대사하는 시스템을 구축합니다.</p></div>
  <section><div class="grid2">
    <div class="card"><h3>무엇을 만드나요</h3><p class="mut">30개 원수사가 매월 제각각 양식으로 보내는 수수료 엑셀을 AI 온톨로지 매핑으로 표준화하고, 결정적 코드로 정산·대사·마감·내역서까지 자동화합니다. 시책안(PDF·이미지)은 OCR로 시책룰 후보를 뽑아 담당자가 확정합니다.</p></div>
    <div class="card"><h3>핵심 원칙</h3><p class="mut">· 역추적 불변식 - 모든 정산 숫자는 원본 행까지 추적<br/>· 마감 이중 잠금 - 확정 데이터 보호<br/>· AI는 후보만 - 금액은 결정적 코드가 계산, 확정은 사람(HITL)<br/>· 민감정보 암호화 · 멱등 처리</p></div>
    <div class="card"><h3>팀 · 연락</h3><p class="mut">구축: 생각과 행동 (IDEA on Action)<br/>고객: 에이티에셋(주)<br/>문의: 회신 메일 또는 소통 공간</p></div>
    <div class="card"><h3>단계 요약</h3><p class="mut">${STAGES.map((s) => `${s.label} <span class="tag">${STATUS_KO[s.status]}</span>`).join(" ")}</p><div style="margin-top:10px"><a class="navlink" href="/status">진행 현황 자세히 →</a></div></div>
  </div></section>`;
  return page("개요", "overview", body);
}

export function portalStatus(): string {
  const timeline = MILESTONES.map(
    (m) => `<div class="it"><div class="m">${m.date} · <span class="tag">${m.stage}</span></div><div class="t">${m.title}</div></div>`,
  ).join("");
  const body = `
  <div class="hero"><span class="kicker">진행 현황</span><h1>진행 현황</h1>
  <p class="lead">계약부터 운영까지 단계별 진행 상태와 최근 마일스톤입니다.</p></div>
  ${lifecycleStrip()}
  <section><div class="card"><h3>마일스톤</h3><div class="tl">${timeline}</div></div>
  <div class="note" style="margin-top:16px">진행 상태는 개발 진척(F-item·Sprint)에서 요약해 보여드립니다. 상세 기능은 <a class="navlink" href="/app">실 시스템</a>에서 확인하실 수 있어요.</div>
  </section>`;
  return page("진행 현황", "status", body);
}

export function portalDeliverables(): string {
  const rows = DELIVERABLES.map((d) => {
    const right =
      d.href && d.href.startsWith("/guide")
        ? `<a class="btn g" href="${d.href}">받기</a>`
        : d.gated
          ? '<span class="lock">🔒 로그인 후</span>'
          : d.href
            ? `<a class="btn g" href="${d.href}">열기</a>`
            : '<span class="lock">준비 중</span>';
    return `<div class="dl"><div class="ic">${d.kind === "가이드" ? "📘" : d.kind === "데이터" ? "🗂️" : d.kind === "시스템" ? "⚙️" : "📄"}</div><div class="g1"><b>${d.title}</b><span>${d.note} · ${d.kind}</span></div><span class="pill ${d.status}">${DELIV_KO[d.status]}</span>${right}</div>`;
  }).join("");
  const body = `
  <div class="hero"><span class="kicker">산출물</span><h1>주요 산출물</h1>
  <p class="lead">계획된 산출물과 현재 상태입니다. 공개 자료는 바로 받으실 수 있고, 그 외는 로그인 후 이용하실 수 있어요.</p></div>
  <section><div class="dlist">${rows}</div>
  <div class="note" style="margin-top:16px">파일 다운로드와 민감 자료는 자료 유출 방지를 위해 로그인(실 시스템 계정) 후 제공됩니다.</div></section>`;
  return page("산출물", "deliverables", body);
}

// 보호 영역(자료실·소통)은 아직 공개 콘텐츠가 아니라 로그인으로 유도(F-054 설계 §8). 구현은 후속 F-item.
export function portalProtected(area: "assets" | "comms"): string {
  const meta =
    area === "assets"
      ? { nav: "assets" as Nav, kicker: "자료실", title: "자료실", desc: "고객 제공 자료와 참조 자료를 분류·보관하는 공간입니다. 민감 자료라 로그인 후 이용하실 수 있어요." }
      : { nav: "comms" as Nav, kicker: "소통", title: "소통", desc: "이메일·통화 백업과 피드백을 정리하는 공간입니다. 협의 내용이라 로그인 후 이용하실 수 있어요." };
  const body = `
  <div class="hero"><span class="kicker">🔒 ${meta.kicker}</span><h1>${meta.title}</h1>
  <p class="lead">${meta.desc}</p>
  <div class="cta"><a class="btn p" href="/app">로그인하고 이용하기</a><a class="btn g" href="/status">진행 현황 보기</a></div></div>
  <section><div class="note">이 영역은 접근 권한 모델상 보호 대상입니다(공개 링크 + 일부 보호). 상세 자료·소통 기록 관리 기능은 준비 중이며, 계약 확정 후 순차 제공됩니다.</div></section>`;
  return page(meta.title, meta.nav, body);
}
