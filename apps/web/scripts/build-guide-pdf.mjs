// 데모 사용 가이드 PDF 생성 (F-034).
// 단일 소스(src/content/guide.ts)를 그대로 읽어 인쇄용 HTML로 조판한 뒤 Chromium으로 PDF 출력한다.
// 실행: pnpm -F web guide:pdf  (가이드 문구 수정 후 재실행 → public/guide/*.pdf 갱신)
//
// Node 22.18+ 타입 스트리핑으로 .ts를 직접 import 한다. Chromium은 @playwright/test 제공분 사용.
// 한글은 Noto Sans KR 웹폰트를 로드해 렌더 품질을 확보(빌드 시 네트워크 필요).

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { guideSteps } from "../src/content/guide.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../public/guide");
// URL은 ASCII로(한글 경로는 CF가 307 인코딩 리다이렉트). 저장 파일명은 다운로드 속성으로 한글 처리.
const OUT_FILE = resolve(OUT_DIR, "ga-settle-guide.pdf");

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function stepHtml(step) {
  const actions = step.actions
    .map((a, i) => `<li><span class="an">${i + 1}</span>${esc(a)}</li>`)
    .join("");
  const tips = (step.tips ?? [])
    .map((t) => `<div class="tip">💡 ${esc(t)}</div>`)
    .join("");
  return `
  <section class="step">
    <div class="sh"><span class="num">${step.n}</span><h2>${esc(step.title)}</h2></div>
    <p class="intro">${esc(step.intro)}</p>
    <ol class="actions">${actions}</ol>
    ${tips ? `<div class="tips">${tips}</div>` : ""}
  </section>`;
}

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "Noto Sans KR", sans-serif; color: #1a2338; margin: 0; padding: 0; font-size: 12.5px; line-height: 1.6; }
  .cover { padding: 6px 0 18px; border-bottom: 3px solid #0d8bff; margin-bottom: 22px; }
  .brand { display:flex; align-items:center; gap:10px; }
  .logo { width: 34px; height: 34px; border-radius: 9px; background: linear-gradient(120deg,#0a72e8,#26d3ff); }
  .brand b { font-size: 17px; font-weight: 800; letter-spacing:-.2px; }
  h1 { font-size: 25px; font-weight: 800; margin: 16px 0 6px; letter-spacing: -.4px; }
  .sub { color: #5b6980; font-size: 13px; margin: 0; }
  .meta { color:#93a1bd; font-size: 11px; margin-top: 10px; }
  .step { padding: 14px 0; border-bottom: 1px solid #e7ebf2; break-inside: avoid; }
  .sh { display:flex; align-items:center; gap:10px; }
  .num { flex:none; width:26px; height:26px; border-radius:50%; background:#141b2d; color:#fff; font-weight:700; font-size:13px; display:flex; align-items:center; justify-content:center; }
  h2 { font-size: 16px; font-weight: 700; margin: 0; }
  .intro { color:#3c485e; margin: 8px 0 8px; }
  .actions { margin: 0; padding: 0; list-style: none; display:flex; flex-direction:column; gap:5px; }
  .actions li { display:flex; gap:8px; color:#3c485e; }
  .an { flex:none; color:#0a72e8; font-weight:700; }
  .tips { margin-top: 10px; background:#f4f7fb; border-radius: 8px; padding: 9px 12px; }
  .tip { color:#647089; font-size: 11.5px; margin: 2px 0; }
  .foot { margin-top: 22px; text-align:center; color:#93a1bd; font-size: 11px; }
</style></head>
<body>
  <div class="cover">
    <div class="brand"><div class="logo"></div><b>ATA · GA-Settle</b></div>
    <h1>GA-Settle 사용 가이드</h1>
    <p class="sub">원수사 엑셀 업로드부터 AI 매핑 · 시책 정산 · 대사 · 마감 · 지급 내역서까지, 데모를 따라 하며 익히는 8단계</p>
    <div class="meta">수수료 · 시책 통합 정산/대사 시스템 · 접속 https://ata.minu.best/app</div>
  </div>
  ${guideSteps.map(stepHtml).join("")}
  <div class="foot">각 화면 오른쪽 위 '도움말'에서 화면별 사용법을, 왼쪽 메뉴 '사용 가이드'에서 이 문서를 다시 볼 수 있어요.</div>
</body></html>`;

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "networkidle" });
await page.pdf({
  path: OUT_FILE,
  format: "A4",
  printBackground: true,
  margin: { top: "16mm", bottom: "14mm", left: "15mm", right: "15mm" },
});
await browser.close();
console.log("✓ PDF 생성 완료:", OUT_FILE);
