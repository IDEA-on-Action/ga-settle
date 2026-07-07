// 고객 데모용 랜딩/인터랙티브 페이지 (ata.minu.best/ 루트에서 서빙).
// 공개 페이지라 자격증명 미포함 - 실제 파이프라인을 재현한 클라이언트 시뮬레이션 + 라이브 /health 상태.
// 웹 UI(B-006) 정식 SPA 전까지의 데모 대체물.
export const DEMO_HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='0'%3E%3Cstop offset='0' stop-color='%230a72e8'/%3E%3Cstop offset='1' stop-color='%2326d3ff'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='32' height='32' rx='8' fill='%230a0e1a'/%3E%3Cpath d='M4 24 Q9 6 16 18 Q23 6 28 24' fill='none' stroke='url(%23g)' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E" />
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
</style>
</head>
<body>
<header><div class="wrap nav">
  <div class="logo"><svg class="mark" viewBox="0 0 62 30" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="atam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0a72e8"/><stop offset="1" stop-color="#26d3ff"/></linearGradient></defs><path d="M4 25 Q17 3 29 22 Q41 3 58 25" stroke="url(#atam)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg><div style="font-size:17px;line-height:1.15">ATA<br><small>Autoinsurance To Assetmanagement</small></div></div>
  <span class="sp"></span>
  <span class="badge"><span class="dot" id="hdot"></span><span id="hstat">API 상태 확인 중…</span></span>
  <a class="btn g" href="#demo">라이브 데모</a>
  <a class="btn p" href="/app">시작하기 →</a>
</div></header>

<div class="demo0"></div>
<section class="hero"><div class="wrap">
  <span class="kicker">◆ 보험 GA 수수료·시책 정산 자동화</span>
  <h1>30개 원수사, 제각각 엑셀.<br><span class="g">정산은 오차 0, 근거는 원본까지.</span></h1>
  <p class="lead">수기 대사와 엑셀 취합으로 며칠씩 태우던 마감을 자동화합니다. AI가 제각각인 컬럼을 표준 필드로 매핑하면, 검증된 결정적 코드가 정산-대사-마감까지 끝냅니다. 모든 숫자는 원본 엑셀 행까지 역추적되어 감사에 그대로 답이 됩니다.</p>
  <div class="cta">
    <a class="btn p" href="#demo">▶ 60초 파이프라인 데모</a>
    <a class="btn g" href="#feat">타협 없는 원칙</a>
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
</script>
</body>
</html>`;
