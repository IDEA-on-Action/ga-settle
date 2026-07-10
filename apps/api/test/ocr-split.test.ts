import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { splitPdf } from "../src/ocr";

// F-049: CLOVA OCR 10페이지 한도 대응 - PDF ≤10p 청크 분할 로직.
async function makePdf(pages: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
async function pageCount(buf: ArrayBuffer): Promise<number> {
  return (await PDFDocument.load(buf)).getPageCount();
}

describe("splitPdf (F-049 손보 다중 시상)", () => {
  it("10p 이하는 원본 그대로(분할 없음, 회귀)", async () => {
    const pdf = await makePdf(10);
    const chunks = await splitPdf(pdf, 10);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(pdf); // 동일 참조(무변경)
  });

  it("23p → 10+10+3, 각 청크 ≤10p", async () => {
    const pdf = await makePdf(23);
    const chunks = await splitPdf(pdf, 10);
    expect(chunks.length).toBe(3);
    const counts = await Promise.all(chunks.map(pageCount));
    expect(counts).toEqual([10, 10, 3]);
    for (const c of counts) expect(c).toBeLessThanOrEqual(10);
  });

  it("12p(손보 대표 케이스) → 10+2", async () => {
    const chunks = await splitPdf(await makePdf(12), 10);
    const counts = await Promise.all(chunks.map(pageCount));
    expect(counts).toEqual([10, 2]);
  });

  it("파싱 불가 바이트는 원본 1건으로(크래시 방지)", async () => {
    const junk = new Uint8Array([1, 2, 3, 4]).buffer;
    const chunks = await splitPdf(junk, 10);
    expect(chunks.length).toBe(1);
  });
});
