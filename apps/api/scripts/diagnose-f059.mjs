// F-059/F-065 진단: 실패 원본을 다양한 청크 크기로 structureRule 재시도해 어느 크기에서 통과하는지 규명.
// 사용: tsx diagnose-f059.mjs <OUT_DIR> <파일> [청크크기...]  (청크크기 없으면 기본 8000)
import { readFileSync } from "node:fs";
import { clovaOcr, structureRule, splitTextForStructure, OcrError } from "../src/ocr.ts";

const baseEnv = {};
for (const line of readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) baseEnv[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const OUT = process.argv[2];
const f = process.argv[3];
const sizes = process.argv.slice(4).map(Number);
if (sizes.length === 0) sizes.push(8000);

const bytes = readFileSync(`${OUT}/${f}`).buffer;
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

log(`시작 ${f} (${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB)`);

// clovaOcr 1회 (텍스트 확보 - 청크 실험은 이 텍스트 재사용)
let t = Date.now();
const ocr = await clovaOcr(bytes, "pdf", baseEnv);
log(`clovaOcr OK: textLen=${ocr.text.length} avgConf=${ocr.avgConfidence.toFixed(3)} (${Date.now() - t}ms)`);

for (const size of sizes) {
  const nChunks = splitTextForStructure(ocr.text, size).length;
  log(`--- 청크크기 ${size} → ${nChunks}청크 시도 ---`);
  t = Date.now();
  try {
    const { payoutRows } = await structureRule(ocr.text, ocr.avgConfidence, { ...baseEnv, UPSTAGE_CHUNK_CHARS: String(size) });
    log(`  ✅ 성공 payoutRows=${payoutRows?.length ?? 0} (${Date.now() - t}ms)`);
  } catch (e) {
    const stage = e instanceof OcrError ? e.stage : "unknown";
    log(`  ❌ 실패 stage=${stage} status=${e instanceof OcrError ? e.status : "-"} (${Date.now() - t}ms): ${String(e.message).slice(0, 120)}`);
  }
}
log("완료");
