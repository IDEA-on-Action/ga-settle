// 고객 데모용 랜딩/인터랙티브 페이지 (ata.minu.best/ 루트에서 서빙).
// 공개 페이지라 자격증명 미포함 - 실제 파이프라인을 재현한 클라이언트 시뮬레이션 + 라이브 /health 상태.
// 웹 UI(B-006) 정식 SPA 전까지의 데모 대체물.
export const DEMO_HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='0'%3E%3Cstop offset='0' stop-color='%2329c7ff'/%3E%3Cstop offset='1' stop-color='%230a72e8'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' rx='14' fill='%230a0e1a'/%3E%3Cpath d='M8 48 Q20 8 31 44 Q43 8 56 48' fill='none' stroke='url(%23g)' stroke-width='7.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E" />
<title>ATA · 수수료 정산/대사 시스템</title>
<meta name="description" content="30개 원수사의 제각각 엑셀을 AI 온톨로지 매핑으로 표준화하고, 결정적 코드로 정산·대사·마감까지 자동화하는 GA 수수료 통합 정산 시스템." />
<style>
  :root{
    --bg:#0a0e1a;--bg2:#0f1524;--card:#141b2d;--card2:#1a2338;--line:#232d44;
    --fg:#e8edf7;--mut:#93a1bd;--dim:#647089;
    --brand:#0d8bff;--brand2:#22c3ff;--ok:#2ee6a8;--warn:#ffb020;--bad:#ff5c7a;
    --grad:linear-gradient(120deg,#0a72e8,#1f9bff 55%,#26d3ff);
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{background:radial-gradient(1200px 700px at 80% -10%,#16224a 0,transparent 55%),radial-gradient(900px 600px at -5% 10%,#141d3a 0,transparent 50%),var(--bg);
    color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;-webkit-font-smoothing:antialiased}
  a{color:inherit;text-decoration:none}
  .wrap{max-width:1120px;margin:0 auto;padding:0 22px}
  header{position:sticky;top:0;z-index:20;backdrop-filter:blur(10px);background:rgba(10,14,26,.72);border-bottom:1px solid var(--line)}
  .nav{display:flex;align-items:center;gap:14px;height:60px}
  .logo{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.02em}
  .logo .mark{height:27px;width:auto;filter:drop-shadow(0 3px 10px rgba(13,139,255,.5))}
  .logo small{font-weight:600;color:var(--mut);font-size:11px;letter-spacing:.01em}
  .nav .sp{flex:1}
  .badge{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--mut);border:1px solid var(--line);background:var(--card);padding:6px 11px;border-radius:999px}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--dim);box-shadow:0 0 0 0 rgba(46,230,168,.5)}
  .dot.live{background:var(--ok);animation:pulse 2s infinite}
  .dot.down{background:var(--bad)}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(46,230,168,.45)}70%{box-shadow:0 0 0 7px rgba(46,230,168,0)}100%{box-shadow:0 0 0 0 rgba(46,230,168,0)}}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;border:1px solid transparent;transition:.15s}
  .btn.p{background:var(--grad);color:#fff;box-shadow:0 8px 24px rgba(91,140,255,.35)}
  .btn.p:hover{transform:translateY(-1px)}
  .btn.g{background:var(--card);border-color:var(--line);color:var(--fg)}
  .btn.g:hover{border-color:var(--brand)}
  section{padding:72px 0}
  .hero{padding:86px 0 54px;position:relative}
  .kicker{display:inline-flex;align-items:center;gap:8px;color:var(--brand);font-weight:700;font-size:13px;letter-spacing:.02em;border:1px solid var(--line);background:var(--card);padding:6px 12px;border-radius:999px}
  h1{font-size:clamp(30px,5vw,52px);line-height:1.1;letter-spacing:-.03em;margin:20px 0 16px;font-weight:850}
  h1 .g{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
  .lead{font-size:clamp(16px,2.2vw,19px);color:var(--mut);max-width:640px}
  .cta{display:flex;gap:12px;margin-top:28px;flex-wrap:wrap}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:44px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
  .stat b{display:block;font-size:26px;font-weight:850;letter-spacing:-.02em}
  .stat span{color:var(--dim);font-size:12.5px}
  h2{font-size:clamp(24px,3.4vw,34px);letter-spacing:-.02em;margin:0 0 10px;font-weight:820}
  .sub{color:var(--mut);margin:0 0 30px;max-width:640px}
  /* demo */
  .demo{background:linear-gradient(180deg,var(--bg2),var(--bg));border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  .steps{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}
  .step{flex:1;min-width:130px;display:flex;gap:10px;align-items:center;padding:11px 13px;border-radius:11px;border:1px solid var(--line);background:var(--card);color:var(--mut);font-size:13px;font-weight:600;transition:.2s}
  .step .n{width:22px;height:22px;flex:0 0 22px;border-radius:50%;display:grid;place-items:center;font-size:12px;background:var(--card2);color:var(--dim);border:1px solid var(--line)}
  .step.active{border-color:var(--brand);color:var(--fg);background:var(--card2);box-shadow:0 6px 22px rgba(91,140,255,.16)}
  .step.active .n{background:var(--grad);color:#fff;border-color:transparent}
  .step.done .n{background:var(--ok);color:#062;border-color:transparent}
  .stage{background:var(--card);border:1px solid var(--line);border-radius:16px;min-height:340px;padding:22px;position:relative;overflow:hidden}
  .stage h3{margin:0 0 4px;font-size:19px;letter-spacing:-.01em}
  .stage p.d{color:var(--mut);margin:0 0 18px;font-size:13.5px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
  th{color:var(--dim);font-weight:600;font-size:11.5px;text-transform:none}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  .tblwrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px}
  .pill{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px}
  .pill.ok{background:rgba(46,230,168,.13);color:var(--ok)}
  .pill.ai{background:rgba(124,107,255,.15);color:#b6a6ff}
  .pill.warn{background:rgba(255,176,32,.14);color:var(--warn)}
  .pill.bad{background:rgba(255,92,122,.14);color:var(--bad)}
  .map{display:grid;grid-template-columns:1fr auto 1fr;gap:8px 14px;align-items:center;font-size:13px}
  .map .src{background:var(--card2);border:1px solid var(--line);border-radius:8px;padding:9px 11px;font-family:ui-monospace,Menlo,monospace}
  .map .dst{background:rgba(91,140,255,.09);border:1px solid rgba(91,140,255,.35);border-radius:8px;padding:9px 11px;font-weight:700}
  .map .arw{color:var(--brand);font-weight:800}
  .demo-ctl{display:flex;gap:10px;align-items:center;margin-top:18px}
  .prog{flex:1;height:6px;border-radius:99px;background:var(--card2);overflow:hidden}
  .prog i{display:block;height:100%;width:0;background:var(--grad);transition:width .5s}
  .grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
  .feat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
  .feat .ic{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;font-size:19px;background:var(--card2);border:1px solid var(--line);margin-bottom:12px}
  .feat h4{margin:0 0 6px;font-size:15.5px}
  .feat p{margin:0;color:var(--mut);font-size:13px}
  .flow{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
  .flow span{font-size:12px;color:var(--mut);background:var(--card);border:1px solid var(--line);padding:7px 11px;border-radius:9px}
  .flow span b{color:var(--fg)}
  .flow .a{color:var(--dim);align-self:center;padding:0 2px}
  footer{border-top:1px solid var(--line);padding:34px 0;color:var(--dim);font-size:13px}
  .frow{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
  .note{font-size:12px;color:var(--dim);margin-top:14px}
  @media(max-width:760px){.stats,.grid4{grid-template-columns:repeat(2,1fr)}.map{grid-template-columns:1fr;gap:5px}.map .arw{transform:rotate(90deg);justify-self:start}}
  /* ---- 시책안 OCR 데모 (F-043) ---- */
  .ptabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
  .ptab{display:flex;flex-direction:column;gap:2px;padding:10px 14px;border-radius:11px;border:1px solid var(--line);background:var(--card);color:var(--mut);cursor:pointer;font-size:13px;transition:.15s}
  .ptab b{color:var(--fg);font-weight:700;font-size:13.5px}
  .ptab small{color:var(--dim);font-size:11.5px}
  .ptab.active{border-color:var(--brand);background:var(--card2);color:var(--fg);box-shadow:0 6px 22px rgba(91,140,255,.14)}
  .ocrgrid{display:grid;grid-template-columns:0.9fr 1.1fr;gap:16px;align-items:start}
  .ocrpane{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;min-height:360px}
  .ocrpane .lbl{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dim);font-weight:700;letter-spacing:.02em;margin-bottom:12px;text-transform:uppercase}
  /* 원본 포스터 목업 */
  .poster{border-radius:12px;overflow:hidden;border:1px solid var(--line);font-size:12px}
  .poster .phead{padding:14px 14px 12px;color:#fff}
  .poster .plogo{font-size:11px;font-weight:700;opacity:.9;margin-bottom:6px}
  .poster .ptitle{font-size:22px;font-weight:850;letter-spacing:-.02em;line-height:1.15}
  .poster .psub{font-size:12px;opacity:.92;margin-top:4px}
  .poster .pbody{background:#fbfbfe;color:#1b2233;padding:12px 13px}
  .poster .prow{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px dashed #dfe3ee}
  .poster .prow:last-child{border-bottom:0}
  .poster .prow .k{color:#4a5470;font-weight:600}
  .poster .prow .v{font-weight:800;color:#0e1526;text-align:right}
  .poster .pband{display:flex;gap:6px;flex-wrap:wrap;padding:10px 13px;background:#f2f4fa;color:#3a465f}
  .poster .chip{font-size:10.5px;font-weight:700;background:#fff;border:1px solid #dde2ef;color:#3a465f;padding:3px 8px;border-radius:999px}
  .pkb .phead{background:linear-gradient(135deg,#ffb703,#fb8500)}
  .pkb .ptitle{color:#111}
  .pkb .plogo,.pkb .psub{color:#3a2a00}
  .phw .phead{background:linear-gradient(135deg,#ff8fb1,#f76d9a)}
  .posternote{font-size:11px;color:var(--dim);margin-top:10px;display:flex;align-items:center;gap:6px}
  /* 추출 룰 */
  .rrow{display:grid;grid-template-columns:96px 1fr auto;gap:10px;align-items:center;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--card2);margin-bottom:8px;transition:.2s}
  .rrow .rk{font-size:11.5px;color:var(--dim);font-weight:700}
  .rrow .rv{font-size:13px;font-weight:700;color:var(--fg)}
  .rrow.low{border-color:rgba(255,176,32,.5);background:rgba(255,176,32,.07)}
  .rrow.fixed{border-color:rgba(46,230,168,.4);background:rgba(46,230,168,.06)}
  .conf{font-size:10.5px;font-weight:800;padding:3px 8px;border-radius:999px;white-space:nowrap}
  .conf.hi{background:rgba(46,230,168,.14);color:var(--ok)}
  .conf.lo{background:rgba(255,176,32,.16);color:var(--warn);cursor:pointer;border:1px solid rgba(255,176,32,.5)}
  .conf.lo:hover{background:rgba(255,176,32,.26)}
  .conf.fx{background:rgba(46,230,168,.14);color:var(--ok)}
  .ocrbanner{display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:10px;font-size:12.5px;font-weight:600;margin-bottom:12px}
  .ocrbanner.warn{background:rgba(255,176,32,.1);border:1px solid rgba(255,176,32,.35);color:var(--warn)}
  .ocrbanner.ok{background:rgba(46,230,168,.1);border:1px solid rgba(46,230,168,.35);color:var(--ok)}
  .verify3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}
  .verify3 .v3{background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:10px}
  .verify3 .v3 .t{font-size:12px;font-weight:800;margin-bottom:3px}
  .verify3 .v3 .dd{font-size:11px;color:var(--mut);line-height:1.45}
  @media(max-width:760px){.ocrgrid{grid-template-columns:1fr}.verify3{grid-template-columns:1fr}.rrow{grid-template-columns:80px 1fr auto}}
</style>
</head>
<body>
<header><div class="wrap nav">
  <div class="logo"><svg class="mark" viewBox="0 0 62 30" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="atam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0a72e8"/><stop offset="1" stop-color="#26d3ff"/></linearGradient></defs><path d="M4 25 Q17 3 29 22 Q41 3 58 25" stroke="url(#atam)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg><div style="font-size:17px;line-height:1.15">ATA<br><small>Autoinsurance To Assetmanagement</small></div></div>
  <span class="sp"></span>
  <span class="badge"><span class="dot" id="hdot"></span><span id="hstat">API 상태 확인 중…</span></span>
  <a class="btn g" href="#demo">라이브 데모</a>
  <a class="btn g" href="/guide/ga-settle-guide.pdf" target="_blank" rel="noopener">사용 가이드</a>
  <a class="btn p" href="/app">시작하기 →</a>
</div></header>

<div class="demo0"></div>
<section class="hero"><div class="wrap">
  <span class="kicker">◆ 보험 GA 수수료·시책 정산 자동화</span>
  <h1>30개 원수사, 제각각 엑셀.<br><span class="g">정산은 오차 0, 근거는 원본까지.</span></h1>
  <p class="lead">수기 대사와 엑셀 취합으로 며칠씩 태우던 마감을 자동화합니다. AI가 제각각인 컬럼을 표준 필드로 매핑하면, 검증된 결정적 코드가 정산-대사-마감까지 끝냅니다. 모든 숫자는 원본 엑셀 행까지 역추적되어 감사에 그대로 답이 됩니다.</p>
  <div class="cta">
    <a class="btn p" href="#demo">▶ 60초 파이프라인 데모</a>
    <a class="btn g" href="/guide/ga-settle-guide.pdf" target="_blank" rel="noopener">📘 사용 가이드 (PDF)</a>
  </div>
  <div class="stats">
    <div class="stat"><b>30+</b><span>원수사 양식, 손 안 대고 대응</span></div>
    <div class="stat"><b>L0~L4</b><span>사람 개입 없는 자동 매핑</span></div>
    <div class="stat"><b>0원</b><span>재계산해도 차액 0원</span></div>
    <div class="stat"><b>2-join</b><span>모든 숫자, 원본 행까지 추적</span></div>
  </div>
</div></section>

<section class="demo" id="demo"><div class="wrap">
  <h2>엑셀 한 장이, 마감된 정산서가 되기까지</h2>
  <p class="sub">원수사 엑셀 한 장이 마감 정산서가 되는 실제 처리 흐름 그대로입니다. <b>다음 단계</b>로 직접 넘겨보세요.</p>
  <div class="steps" id="steps"></div>
  <div class="stage" id="stage"></div>
  <div class="demo-ctl">
    <button class="btn g" id="prev">◀ 이전</button>
    <div class="prog"><i id="prog"></i></div>
    <button class="btn p" id="next">다음 단계 ▶</button>
  </div>
  <p class="note">* 고객 데모용 시뮬레이션입니다. 데이터는 예시이며, 실제 API(<code>/health</code>)는 상단 배지에서 라이브 상태로 확인됩니다.</p>
</div></section>

<section class="demo ocr" id="ocr"><div class="wrap">
  <h2>이미지로 온 시책안이, 감사까지 되짚는 시책룰이 되기까지</h2>
  <p class="sub">시책안은 매월 보험사 <b>포스터 이미지</b>로 옵니다. 손으로 옮겨 적던 지급 규칙을 OCR이 읽어 초안을 만들고, 담당자는 <b>확인·보정만</b> 합니다. 확정된 룰엔 원본 이미지가 지급 근거로 붙어, 특정 지급 건에서 <b>원본 시책안까지 되짚어</b> 감사에 답이 됩니다.</p>
  <div class="ptabs" id="ptabs"></div>
  <div class="ocrgrid">
    <div class="ocrpane" id="ocrleft"></div>
    <div class="ocrpane" id="ocrright"></div>
  </div>
  <p class="note">* 이 랜딩 데모는 흐름 재현용 시뮬레이션입니다. 실제 CLOVA OCR + Upstage 구조화 엔진은 이미 연동되어 <b>/app 로그인 후</b> 실 시책안 이미지로 동작합니다(귀사 제공 포스터 실측: 한화손보 신뢰도 0.96 · DB손보 0.87, 정산 핵심값 정확 인식). 상용 API 할당량 보호를 위해 실 인식은 인증 사용자에게만 제공됩니다.</p>
</div></section>

<section id="feat"><div class="wrap">
  <h2>타협하지 않는 4가지 원칙</h2>
  <p class="sub">감사와 재현성을 위해, 시스템이 예외 없이 지키는 규칙입니다.</p>
  <div class="grid4">
    <div class="feat"><div class="ic">🔎</div><h4>원본까지 역추적</h4><p>모든 수수료 레코드는 업로드 파일과 행 번호를 품습니다. 어떤 정산액이든 원본 엑셀 행까지 되짚어, 감사에 그대로 답이 됩니다.</p></div>
    <div class="feat"><div class="ic">🔒</div><h4>마감은 이중 잠금</h4><p>마감된 정산은 API가 거부하고 DB 트리거가 다시 막습니다. 마감 스냅샷은 누구도 바꿀 수 없게 보관됩니다.</p></div>
    <div class="feat"><div class="ic">🤖</div><h4>돈은 코드가 계산</h4><p>정산 숫자는 언제나 검증된 결정적 코드가 계산합니다. AI는 매핑 후보와 근거만 제시하고, 확정은 정합성 검증 또는 사람이 합니다.</p></div>
    <div class="feat"><div class="ic">🛡️</div><h4>민감정보 암호화</h4><p>금액과 개인정보는 AES-GCM으로 암호화해 저장합니다. AI에는 마스킹된 표본만 보내, 원문이 새어 나가지 않습니다.</p></div>
  </div>
  <h2 style="margin-top:56px">처리 흐름</h2>
  <div class="flow">
    <span><b>30 원수사 엑셀</b></span><span class="a">→</span>
    <span>L0 <b>시그니처 캐시</b></span><span class="a">→</span>
    <span>L1 <b>프로파일링</b></span><span class="a">→</span>
    <span>L2 <b>LLM 매핑</b></span><span class="a">→</span>
    <span>L3 <b>정합성</b></span><span class="a">→</span>
    <span>L4 <b>신뢰도 등급</b></span><span class="a">→</span>
    <span><b>원장</b></span><span class="a">→</span>
    <span><b>시책 룰</b></span><span class="a">→</span>
    <span><b>대사</b></span><span class="a">→</span>
    <span><b>보정</b></span><span class="a">→</span>
    <span><b>마감</b></span><span class="a">→</span>
    <span><b>내역서</b></span>
  </div>
</div></section>

<footer><div class="wrap frow">
  <div class="logo"><svg class="mark" viewBox="0 0 62 30" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="atamf" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0a72e8"/><stop offset="1" stop-color="#26d3ff"/></linearGradient></defs><path d="M4 25 Q17 3 29 22 Q41 3 58 25" stroke="url(#atamf)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg><b>ATA</b></div>
  <span class="sp" style="flex:1"></span>
  <span>© 2026 ATA · Autoinsurance To Assetmanagement · 정산 엔진 by 생각과 행동</span>
  <span class="badge"><span class="dot" id="fdot"></span><span id="fstat">…</span></span>
</div></footer>

<script>
// ---- 라이브 /health 배지 ----
(async function(){
  try{
    const r = await fetch('/health',{cache:'no-store'});
    const j = await r.json();
    const live = r.ok && j.ok;
    const txt = live ? ('API 라이브 · '+(j.env||'production')) : 'API 응답 이상';
    for(const id of ['hstat','fstat']) document.getElementById(id).textContent = txt;
    for(const id of ['hdot','fdot']){ const d=document.getElementById(id); d.classList.add(live?'live':'down'); }
  }catch(e){
    for(const id of ['hstat','fstat']) document.getElementById(id).textContent='API 연결 실패';
    for(const id of ['hdot','fdot']) document.getElementById(id).classList.add('down');
  }
})();

// ---- 파이프라인 스텝 데모 ----
var STEPS = [
  {t:'1. 원수사 엑셀 업로드', d:'원수사마다 헤더가 제각각입니다. 사람이 매달 손으로 맞추던 그 엑셀을, 그대로 올리기만 하세요.', r:stageUpload},
  {t:'2. AI 온톨로지 매핑 (L0~L4)', d:'동의어-문맥-수치 패턴으로 각 컬럼을 표준 필드에 자동 매핑하고, 얼마나 확신하는지 근거까지 남깁니다.', r:stageMap},
  {t:'3. 정합성 검증', d:'지급수수료 ≈ 보험료 × 수수료율. 결정적 규칙이 전 행을 초 단위로 검증합니다.', r:stageValidate},
  {t:'4. 원장 커밋 (역추적·암호화)', d:'승인하면 원장에 커밋됩니다. 모든 행은 원본까지 역추적되고, 금액은 암호화되어 저장됩니다.', r:stageLedger},
  {t:'5. 정산 · 대사', d:'시책 룰로 지급액을 계산하고 원수사 보고액과 대조합니다. 차이 나는 계약을 계약 단위로 짚어냅니다.', r:stageRecon},
  {t:'6. 마감 (이중 잠금)', d:'월 마감은 API와 DB가 이중으로 잠급니다. 스냅샷을 불변 보관하고, 재계산해도 차액 0원임을 증명합니다.', r:stageClose},
];
var cur=0;
var stepsEl=document.getElementById('steps'), stageEl=document.getElementById('stage'), progEl=document.getElementById('prog');
function renderSteps(){
  stepsEl.innerHTML='';
  STEPS.forEach(function(s,i){
    var el=document.createElement('div');
    el.className='step'+(i===cur?' active':'')+(i<cur?' done':'');
    el.innerHTML='<span class="n">'+(i<cur?'✓':(i+1))+'</span>'+s.t.replace(/^\\d+\\.\\s/,'');
    el.onclick=function(){cur=i;render();};
    stepsEl.appendChild(el);
  });
}
function render(){
  renderSteps();
  var s=STEPS[cur];
  stageEl.innerHTML='<h3>'+s.t+'</h3><p class="d">'+s.d+'</p>'+s.r();
  progEl.style.width=((cur+1)/STEPS.length*100)+'%';
  document.getElementById('prev').disabled=cur===0;
  document.getElementById('next').textContent = cur===STEPS.length-1?'처음으로 ↺':'다음 단계 ▶';
}
document.getElementById('next').onclick=function(){cur=(cur+1)%STEPS.length;render();};
document.getElementById('prev').onclick=function(){if(cur>0){cur--;render();}};

var SAMPLE=[
  ['2026-100001','김영수','A1001','무배당종신보험','80,000','12%','9,600'],
  ['2026-100002','이민정','A1002','변액연금보험','92,500','15%','13,875'],
  ['2026-100003','박철호','A1003','건강플러스보험','105,000','18%','18,900'],
  ['2026-100004','최지현','A1004','행복드림저축','117,500','20%','23,500'],
];
function stageUpload(){
  var head=['증권번호','모집인','사번','상품명','월보험료','지급률','수수료'];
  var rows=SAMPLE.map(function(r){return '<tr>'+r.map(function(c,i){return '<td'+(i>=4?' class="num"':'')+'>'+c+'</td>';}).join('')+'</tr>';}).join('');
  return '<div style="margin-bottom:12px"><span class="pill warn">비표준 헤더</span> <span class="pill ok">파일 해시 멱등</span> <span class="pill ok">R2 불변 보관</span></div>'+
    '<div class="tblwrap"><table><thead><tr>'+head.map(function(h){return '<th>'+h+'</th>';}).join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<p class="note">원수사마다 "수수료 / 지급액 / 커미션…" 등 헤더가 다릅니다. 사람이 매번 맞추던 작업을 AI가 대신합니다.</p>';
}
function stageMap(){
  var M=[['증권번호','계약번호','L0 캐시','ok'],['모집인','설계사명','동의어','ai'],['사번','설계사코드','동의어','ai'],['월보험료','보험료','L1 프로파일','ai'],['지급률','수수료율','% 단위 감지','ai'],['수수료','지급수수료','L3 정합성','ok']];
  return '<div class="map">'+M.map(function(m){
    return '<div class="src">'+m[0]+'</div><div class="arw">→</div><div class="dst">'+m[1]+' <span class="pill '+(m[3]==='ok'?'ok':'ai')+'" style="margin-left:6px">'+m[2]+'</span></div>';
  }).join('')+'</div>'+
  '<p class="note">L0 시그니처 캐시 적중 시 즉시 매핑, 신규 양식은 L2 LLM이 후보를 제시하고 L3 정합성이 검증합니다. 신뢰도 등급(L4)에 따라 자동 확정 또는 사람 확인(HITL)으로 분기합니다.</p>';
}
function stageValidate(){
  var rows=SAMPLE.map(function(r,i){
    return '<tr><td>'+r[0]+'</td><td class="num">'+r[4]+'</td><td class="num">'+r[5]+'</td><td class="num">'+r[6]+'</td><td><span class="pill ok">통과</span></td></tr>';
  }).join('');
  return '<div style="margin-bottom:12px"><span class="pill ok">12 / 12 행 통과</span> <span class="pill ok">오류 0건</span> <span class="pill ai">지급수수료 ≈ 보험료 × 수수료율</span></div>'+
    '<div class="tblwrap"><table><thead><tr><th>계약번호</th><th>보험료</th><th>수수료율</th><th>지급수수료</th><th>정합성</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
function stageLedger(){
  return '<div style="margin-bottom:14px"><span class="pill ok">원장 커밋 12건</span> <span class="pill ok">역추적 upload_id + row_no</span> <span class="pill ai">AES-GCM 암호화</span></div>'+
    '<div class="tblwrap"><table><thead><tr><th>레코드</th><th>upload_id</th><th>row_no</th><th>지급수수료(암호화)</th></tr></thead><tbody>'+
    SAMPLE.map(function(r,i){return '<tr><td>'+r[0]+'</td><td style="color:var(--dim)">9d28…3716</td><td class="num">'+(i+1)+'</td><td style="color:var(--dim)">enc:••••••••</td></tr>';}).join('')+
    '</tbody></table></div><p class="note">어떤 정산 숫자를 클릭해도 이 원장 행 → 원본 업로드 파일까지 2-join으로 역추적됩니다. 금액은 복호화 키 없이는 읽을 수 없습니다.</p>';
}
function stageRecon(){
  return '<div style="margin-bottom:12px"><span class="pill ai">원수사 보고액 vs 계산액</span></div>'+
    '<div class="tblwrap"><table><thead><tr><th>원수사</th><th>보고액</th><th>계산액</th><th>차액</th><th>상태</th></tr></thead><tbody>'+
    '<tr><td>삼성생명</td><td class="num">295,125</td><td class="num">295,125</td><td class="num">0</td><td><span class="pill ok">일치</span></td></tr>'+
    '<tr><td>한화생명</td><td class="num">412,800</td><td class="num">406,300</td><td class="num" style="color:var(--warn)">6,500</td><td><span class="pill warn">차액</span></td></tr>'+
    '</tbody></table></div>'+
    '<p class="note">차액이 발견되면 계약 단위까지 드릴다운해 원인 행을 특정하고, reason을 남긴 보정(감사 로그 동반)으로 해소합니다. 정산 숫자는 룰 엔진이 재현 가능하게 계산합니다.</p>';
}
function stageClose(){
  return '<div style="display:flex;gap:22px;flex-wrap:wrap;align-items:center">'+
    '<div style="font-size:44px">🔒</div>'+
    '<div><div style="font-weight:800;font-size:17px;margin-bottom:6px">2026-06 마감 완료</div>'+
    '<div style="color:var(--mut);font-size:13.5px">API 거부 + DB 트리거 이중 잠금 · R2 스냅샷 불변 보관</div></div></div>'+
    '<div style="margin:18px 0"><span class="pill ok">병행 검증 차액 0원</span> <span class="pill ok">재계산 시도 → 409 거부</span> <span class="pill ok">보정 시도 → 409 거부</span></div>'+
    '<div class="tblwrap"><table><thead><tr><th>검증</th><th>결과</th></tr></thead><tbody>'+
    '<tr><td>저장 라인 vs 재계산 라인 차액</td><td><span class="pill ok">0원 (verified)</span></td></tr>'+
    '<tr><td>마감 run 재계산</td><td><span class="pill bad">409 · 마감된 run은 재계산 불가</span></td></tr>'+
    '<tr><td>마감 스냅샷</td><td><span class="pill ok">snapshots/2026-06/…json</span></td></tr>'+
    '</tbody></table></div><p class="note">마감 이후에는 어떤 수정도 잠깁니다. 재현성(병행 검증 0원)으로 정산 무결성을 보장합니다.</p>';
}
render();

// ---- 시책안 OCR 인식 데모 (F-043) ----
// 실 포스터 2종(귀사 제공, 검증 PDF 실측)의 인식 결과를 재현. 저신뢰 항목은 담당자 보정 후 확정.
// OCR-ready seam: 실제 구현에서 아래 POSTERS[].fields는 OCR 엔진(오픈소스 1차 + 저신뢰 상용 폴백) 응답으로 대체된다.
var POSTERS=[
  {id:'kb',tab:{name:'KB손해보험',sub:'26년 3월 2주차 시상 · 표 밀집형'},
    poster:{cls:'pkb',logo:'KB손해보험',title:'26년 3월 2주차 시상',sub:'인보험 기본·가동·주력보종 + 연속가동',
      rows:[{k:'인보험 기본시상',v:'150%'},{k:'펫보험 기본시상',v:'300%'},{k:'가동시상(최대)',v:'100%'},{k:'주력보종(간편·종합·자녀·LTC)',v:'최대 100%'},{k:'2~3월 기본 연속가동',v:'최대 300%'}],
      band:['기간 1~31일','13회차 유지','실적 10·20·30·50만']},
    fields:[
      {k:'보험사',v:'KB손해보험',conf:'high'},
      {k:'시책유형',v:'주차시책 · 기본시상',conf:'high'},
      {k:'적용기간',v:'2026-03-08 ~ 03-14 (2주차)',conf:'high'},
      {k:'대상상품',v:'인보험 · 펫보험 · 주력보종(간편/종햡/자녀/LTC)',conf:'low',fix:'인보험 · 펫보험 · 주력보종(간편/종합/자녀/LTC)'},
      {k:'지급배수',v:'인보험 150% · 펫보험 800%',conf:'low',fix:'인보험 150% · 펫보험 300%'},
      {k:'가동·구간',v:'실적 10만↑=5만 ··· 50만↑=50만 정액',conf:'high'},
      {k:'유지조건',v:'13회차 유지',conf:'high'}]},
  {id:'hw',tab:{name:'한화손해보험',sub:'3월은 여성시대 · 장식폰트형'},
    poster:{cls:'phw',logo:'한화손해보험',title:'3월은 여성시대',sub:'프리미엄 상품 + 플랜 · 400%',
      rows:[{k:'시상 배수',v:'400%'},{k:'프리미엄 상품 5만↑',v:'건당 10만'},{k:'프리미엄 상품 10만↑',v:'건당 20만'},{k:'프리미엄 플랜 5만↑',v:'건당 10만'},{k:'프리미엄 플랜 10만↑',v:'건당 20만'}],
      band:['기간 3/9~3/15','여성보험','건당 시상']},
    fields:[
      {k:'보험사',v:'한화손해보험',conf:'high'},
      {k:'시책유형',v:'프리미엄 건당시상 (400%)',conf:'high'},
      {k:'적용기간',v:'2026-03-09 ~ 03-15',conf:'high'},
      {k:'대상상품',v:'프리미언 여성보험 상품·플랜',conf:'low',fix:'프리미엄 여성보험 상품·플랜'},
      {k:'지급방식',v:'건당 정액 · 5만↑ 10만 / 10만↑ 20만',conf:'high'},
      {k:'장식제목',v:'여성시대',conf:'high'}]}
];
var OCR=(function(){
  var pi=0; // 현재 포스터
  var st=POSTERS.map(function(p){return {fixed:{},confirmed:false};});
  var Lel=document.getElementById('ocrleft'),Rel=document.getElementById('ocrright'),Tel=document.getElementById('ptabs');
  function lowIdx(p){return p.fields.map(function(f,i){return f.conf==='low'?i:-1;}).filter(function(i){return i>=0;});}
  function remaining(p,s){return lowIdx(p).filter(function(i){return !s.fixed[i];}).length;}
  function renderTabs(){
    Tel.innerHTML=POSTERS.map(function(p,i){
      return '<div class="ptab'+(i===pi?' active':'')+'" onclick="OCR.tab('+i+')"><b>'+p.tab.name+'</b><small>'+p.tab.sub+'</small></div>';
    }).join('');
  }
  function renderLeft(){
    var P=POSTERS[pi].poster;
    var rows=P.rows.map(function(r){return '<div class="prow"><span class="k">'+r.k+'</span><span class="v">'+r.v+'</span></div>';}).join('');
    var chips=P.band.map(function(c){return '<span class="chip">'+c+'</span>';}).join('');
    Lel.innerHTML='<div class="lbl">📄 원본 시책안 이미지</div>'+
      '<div class="poster '+P.cls+'"><div class="phead"><div class="plogo">'+P.logo+'</div><div class="ptitle">'+P.title+'</div><div class="psub">'+P.sub+'</div></div>'+
      '<div class="pbody">'+rows+'</div><div class="pband">'+chips+'</div></div>'+
      '<div class="posternote">🔗 R2 불변 보관 · SHA-256 멱등 · 확정 룰의 지급 근거로 연결</div>';
  }
  function renderRight(){
    var p=POSTERS[pi],s=st[pi];
    var rows=p.fields.map(function(f,i){
      var isLow=f.conf==='low',done=!!s.fixed[i];
      var val=(isLow&&done)?f.fix:f.v;
      var cls=isLow?(done?'fixed':'low'):'';
      var pill=!isLow?'<span class="conf hi">인식 ✓</span>':(done?'<span class="conf fx">보정 ✓</span>':'<span class="conf lo" onclick="OCR.fix('+i+')">확인 필요</span>');
      return '<div class="rrow '+cls+'"><div class="rk">'+f.k+'</div><div class="rv">'+val+'</div>'+pill+'</div>';
    }).join('');
    var head='<div class="lbl">🧾 추출된 시책룰 초안 <span class="pill ok" style="margin-left:auto">핵심값 인식 99%</span></div>';
    var body;
    if(s.confirmed){
      body='<div class="ocrbanner ok">✅ 시책룰 등록 완료 · 담당자 확정 · 원본 근거 연결됨</div>'+rows+
        '<div class="verify3">'+
        '<div class="v3"><div class="t">① 신뢰도 표시</div><div class="dd">낮은 값은 색으로 담당자 확인 유도</div></div>'+
        '<div class="v3"><div class="t">② 담당자 확정</div><div class="dd">확인·보정 후에만 룰 등록, 금액은 코드가 계산</div></div>'+
        '<div class="v3"><div class="t">③ 원본 근거 보관</div><div class="dd">지급 건 → 원본 시책안까지 역추적</div></div>'+
        '</div>'+
        '<div class="posternote" style="margin-top:12px">🔎 지급건 <b style="color:var(--fg)">#A-100234</b> → 이 시책룰 → <b style="color:var(--fg)">'+POSTERS[pi].poster.title+'</b> 원본 이미지까지 2-hop 역추적 (금감원 감사 소명)</div>'+
        '<div class="demo-ctl" style="margin-top:14px"><button class="btn g" onclick="OCR.reset()">↺ 다시 검토</button></div>';
    }else{
      var rem=remaining(p,s);
      var banner=rem>0
        ?'<div class="ocrbanner warn">⚠️ 저신뢰 '+rem+'건 - 원본과 대조해 확인하세요 (색 표시 항목 클릭)</div>'
        :'<div class="ocrbanner ok">✓ 전 항목 확인 완료 - 시책룰로 확정할 수 있습니다</div>';
      var btn=rem>0
        ?'<button class="btn g" onclick="OCR.fixAll()">저신뢰 '+rem+'건 일괄 확인</button>'
        :'<button class="btn p" onclick="OCR.confirm()">✔ 시책룰로 확정</button>';
      body=banner+rows+'<div class="demo-ctl" style="margin-top:14px">'+btn+'</div>';
    }
    Rel.innerHTML=head+body;
  }
  function all(){renderTabs();renderLeft();renderRight();}
  return {
    tab:function(i){pi=i;all();},
    fix:function(i){st[pi].fixed[i]=true;renderRight();},
    fixAll:function(){lowIdx(POSTERS[pi]).forEach(function(i){st[pi].fixed[i]=true;});renderRight();},
    confirm:function(){st[pi].confirmed=true;renderRight();},
    reset:function(){st[pi]={fixed:{},confirmed:false};renderRight();},
    init:all
  };
})();
OCR.init();
</script>
</body>
</html>`;
