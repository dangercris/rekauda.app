/** Two fictional tenants with no value in common: a component that passes for both reads nothing hardcoded. */
import type { ConfigResponse } from "../../shared/api";

export const tenantA: ConfigResponse = {
  className: "1.º de Básica A",
  schoolName: "Colegio Aurora",
  classShortName: "1.º Básica A",
  classMark: "1A",
  banks: ["Banco Pichincha / Deuna", "Produbanco"],
  treasury: {
    bank: "Banco Pichincha",
    accountType: "Cuenta de ahorros",
    accountNumber: "0000000011",
    holder: "Titular Alfa",
    holderId: "0100000011",
    deunaUrl: "https://pagar.deuna.app/alfa",
    qrUrl: "/api/assets/deuna-qr.png?v=1",
    helpUrl: "https://example.com/ayuda-alfa",
  },
  earliestTransferDate: "2026-11-01",
  defaultTone: "#C81E3A",
  analytics: { gaMeasurementId: "G-ALFA1234" },
  auth: { mode: "password" },
};

export const tenantB: ConfigResponse = {
  className: "3.º de Bachillerato C",
  schoolName: "Instituto Boreal",
  classShortName: "3.º Bach. C",
  classMark: "3C",
  banks: ["Banco del Austro", "Cooperativa Norte"],
  treasury: {
    bank: "Banco del Austro",
    accountType: "Cuenta corriente",
    accountNumber: "0000000022",
    holder: "Titular Beta",
    holderId: "0100000022",
    deunaUrl: null,
    qrUrl: null,
    helpUrl: null,
  },
  earliestTransferDate: "2027-03-01",
  defaultTone: "#0B7A73",
  analytics: { gaMeasurementId: null },
  auth: { mode: "magic_link" },
};
