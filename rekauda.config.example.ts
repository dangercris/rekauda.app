import { defineInstanceConfig } from "./src/shared/instance-config";

/**
 * Per-school settings. `pnpm dev:*`, `build`, `typecheck`, `test` and `deploy` copy this file to
 * `rekauda.config.ts` (gitignored) when it is missing: edit that copy, never this example.
 */
export default defineInstanceConfig({
  schoolName: "Mi Colegio",
  className: "1.º de Básica A",
  // Short label for document titles and link previews, and the mark shown in the brand avatar.
  classShortName: "1.º Básica A",
  classMark: "1A",

  // Public on purpose: families need these data to pay. Served by GET /api/config.
  treasury: {
    bank: "Banco Pichincha",
    accountType: "Cuenta de ahorros",
    // Digits only. The last 4 digits are used to recognize Deuna notification emails.
    accountNumber: "0000000000",
    holder: "Nombre del Tesorero",
    holderId: "0000000000",
    // Deuna payment link (opens the app on phones), or null.
    deunaUrl: null,
    // Same-origin path of the Deuna QR image (put the file in public/), or null. A missing file is handled.
    qrUrl: null,
    // Public Deuna help article: which banks can transfer to Deuna and at what hours.
    helpUrl: "https://soporte.deunaapp.com/hc/es-419/articles/30434090817684",
  },

  banks: [
    "Banco Pichincha / Deuna",
    "Banco Guayaquil",
    "Produbanco",
    "Banco del Pacífico",
    "Banco Bolivariano",
    "Banco Internacional",
    "Banco del Austro",
    "Banco de Loja",
    "Banco Diners Club",
    "Cooperativa JEP",
    "Cooperativa Policía Nacional",
    "Otro banco o cooperativa",
  ],

  // Transfers dated before this day are rejected: use the start of your first collection.
  earliestTransferDate: "2026-11-01",
  // Tone (#RRGGBB) proposed for new collections.
  defaultTone: "#C81E3A",

  // Google Analytics 4 Measurement ID (e.g. "G-ABC123XYZ9"). null disables analytics: no banner, nothing loads.
  analytics: { gaMeasurementId: null },
});
