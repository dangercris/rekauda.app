import { describe, expect, it } from "vitest";
import { hasPdfSignature, isPdf, needsCompression, prepareReceipt } from "./image";

const pdfBytes = new TextEncoder().encode("%PDF-1.7\n%fake receipt");

describe("PDF detection", () => {
  it("treats a PDF with an empty or generic MIME type as a PDF (by .pdf extension)", () => {
    expect(isPdf(new File([pdfBytes], "comprobante.pdf", { type: "" }))).toBe(true);
    expect(isPdf(new File([pdfBytes], "COMPROBANTE.PDF", { type: "application/octet-stream" }))).toBe(true);
    expect(isPdf(new File(["x"], "foto.jpg", { type: "image/jpeg" }))).toBe(false);
  });

  it("never compresses a PDF, even a big one with an empty type", () => {
    const big = new File([pdfBytes], "recibo.pdf", { type: "" });
    Object.defineProperty(big, "size", { value: 4 * 1024 * 1024 });
    expect(needsCompression(big)).toBe(false);
  });

  it("sniffs the %PDF- signature", async () => {
    expect(await hasPdfSignature(new Blob([pdfBytes]))).toBe(true);
    expect(await hasPdfSignature(new Blob(["nope!"]))).toBe(false);
  });

  it("returns a PDF untouched, also when the name has no extension and the type is empty", async () => {
    const byName = new File([pdfBytes], "recibo.pdf", { type: "" });
    expect(await prepareReceipt(byName)).toBe(byName);
    const bySignature = new File([pdfBytes], "recibo", { type: "" });
    expect(await prepareReceipt(bySignature)).toBe(bySignature);
  });
});
