// F-059 실패 원본을 단계별로 계측 (일회성 진단). splitPdf → clovaOcr(청크별) → structureRule 각 구간 타이밍.
import { readFileSync } from "node:fs";
import { splitPdf, clovaOcr, structureRule, OcrError } from "../src/ocr.ts";

const devVars = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
const env = {};
for (const line of devVars.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const OUT = process.argv[2];
const f = process.argv[3];
const bytes = readFileSync(`${OUT}/${f}`).buffer;
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

log(`시작 ${f} (${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB)`);

// 1) splitPdf 단계
let t = Date.now();
let parts;
try {
  parts = await splitPdf(bytes, 10); // CLOVA_MAX_PAGES=10
  log(`splitPdf OK: ${parts.length}청크 (${Date.now() - t}ms)`);
} catch (e) {
  log(`splitPdf 실패: ${e.message}`);
  process.exit(1);
}

// 2) clovaOcr 단계 (전체 = 청크 순차)
t = Date.now();
try {
  const ocr = await clovaOcr(bytes, "pdf", env);
  log(`clovaOcr OK: fieldCount=${ocr.fieldCount} avgConf=${ocr.avgConfidence.toFixed(3)} textLen=${ocr.text.length} (${Date.now() - t}ms)`);

  // 3) structureRule 단계 (F-059가 고친 곳)
  t = Date.now();
  const { rule, payoutRows } = await structureRule(ocr.text, ocr.avgConfidence, env);
  log(`structureRule OK: payoutRows=${payoutRows?.length ?? 0} (${Date.now() - t}ms)`);
  log(`✅ 전체 성공`);
} catch (e) {
  const stage = e instanceof OcrError ? e.stage : "unknown";
  log(`❌ 실패 stage=${stage} status=${e instanceof OcrError ? e.status : "-"} (${Date.now() - t}ms)`);
  log(`   ${String(e.message).slice(0, 300)}`);
}
