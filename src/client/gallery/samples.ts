/**
 * Gallery-only sample data. Covers are generated SVGs (data: URIs are allowed by the CSP img-src) so the
 * gallery can show the hero over a very bright photo (worst case for white text) and a dark one.
 */
import type { ConfigResponse } from "../../shared/api";

/** A fictional tenant for the style guide, which runs without a Worker. */
export const SAMPLE_CONFIG: ConfigResponse = {
  className: "1.º de Básica A",
  schoolName: "Colegio de Muestra",
  classShortName: "1.º Básica A",
  classMark: "1A",
  banks: ["Banco de Muestra", "Cooperativa de Muestra"],
  treasury: {
    bank: "Banco de Muestra",
    accountType: "Cuenta de ahorros",
    accountNumber: "0000000000",
    holder: "Titular de Muestra",
    holderId: "0100000000",
    deunaUrl: null,
    qrUrl: null,
    helpUrl: null,
  },
  earliestTransferDate: "2026-01-01",
  defaultTone: "#3D4FA3",
  analytics: { gaMeasurementId: null },
  auth: { mode: "password" },
};

const svg = (markup: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

export const BRIGHT_COVER = svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbfaf6"/><stop offset="1" stop-color="#e6eef8"/></linearGradient></defs>
<rect width="800" height="1000" fill="url(#s)"/>
<circle cx="610" cy="210" r="90" fill="#fff6d8"/>
<path d="M0 760 L190 420 L300 560 L430 330 L600 600 L800 470 L800 1000 L0 1000Z" fill="#f4f6fa"/>
<path d="M0 860 L240 640 L420 780 L620 660 L800 760 L800 1000 L0 1000Z" fill="#ffffff"/>
</svg>`);

export const DARK_COVER = svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000">
<defs><radialGradient id="g" cx="0.3" cy="0.3" r="0.9"><stop offset="0" stop-color="#5a1020"/><stop offset="1" stop-color="#12060a"/></radialGradient></defs>
<rect width="800" height="1000" fill="url(#g)"/>
<g opacity="0.85"><circle cx="160" cy="260" r="70" fill="#e9a93b"/><circle cx="520" cy="180" r="46" fill="#ffcf7a"/>
<circle cx="640" cy="520" r="90" fill="#c81e3a"/><circle cx="260" cy="640" r="56" fill="#f2c14e"/><circle cx="460" cy="820" r="80" fill="#a3172f"/>
<circle cx="90" cy="900" r="40" fill="#ffd27a"/></g>
</svg>`);

export const SAMPLE_TONES = [
  { value: "#C81E3A", name: "Carmesí", role: "Navidad" },
  { value: "#3D4FA3", name: "Índigo", role: "Cotopaxi" },
  { value: "#0B7A73", name: "Pino", role: "Materiales" },
] as const;

/** Builds a real PNG receipt-like file in the browser for the FileDrop preview. */
export async function makeSampleReceipt(): Promise<File | null> {
  const canvas = document.createElement("canvas");
  canvas.width = 232;
  canvas.height = 312;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 232, 312);
  ctx.fillStyle = "#17a36b";
  ctx.beginPath();
  ctx.arc(116, 56, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0e1117";
  ctx.font = "bold 30px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("$14,00", 116, 128);
  ctx.fillStyle = "#e3e6ec";
  for (let i = 0; i < 5; i += 1) ctx.fillRect(28, 160 + i * 26, 176 - (i % 2) * 40, 10);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? new File([blob], "Comprobante_Deuna.png", { type: "image/png" }) : null;
}

export const SAMPLE_PDF = new File([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])], "Transferencia_Pichincha.pdf", {
  type: "application/pdf",
});
