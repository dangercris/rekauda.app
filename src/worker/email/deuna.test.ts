import { describe, expect, it } from "vitest";
import { htmlToText, parseAmountCents, parseDeunaEmail, parseEcuadorDateTime } from "./deuna";

const SAMPLE = `Hola, Ana
Recibiste $14,00 de Torres Mendez Lucia Ana con Deuna!
Los detalles de tu pago
Monto: $14,00 USD
Motivo: Transf JEP
Fecha: 26 nov 2026 - 09h02
Cuenta de origen: Coop. Jep ********0000
Cuenta de destino: ******0000
Nombre del ordenante: Torres Mendez Lucia Ana
Número de transacción: 500000000001`;

const EXPECTED = {
  transactionNumber: "500000000001",
  amountCents: 1400,
  receivedAt: "2026-11-26T14:02:00.000Z",
  originBank: "Coop. Jep",
  originAccount: "********0000",
  destinationAccount: "******0000",
  payerName: "Torres Mendez Lucia Ana",
  motive: "Transf JEP",
};

describe("parseDeunaEmail", () => {
  it("parses the sample notification", () => {
    expect(parseDeunaEmail({ text: SAMPLE })).toEqual(EXPECTED);
  });

  it("parses a table-like layout with labels and values on separate lines", () => {
    const table = `
      Hola, Ana ...  Recibiste   $14,00
      de Torres   Mendez Lucia Ana con Deuna!

      Los   detalles de tu pago
      Monto
         $14,00 USD
      Motivo

         Transf JEP
      Fecha
      26 nov 2026  -  09h02
      Cuenta de origen
      Coop. Jep   ********0000
      Cuenta de destino
      ******0000
      Nombre del ordenante
      Torres Mendez Lucia Ana
      Numero de transaccion
      500000000001
    `;
    expect(parseDeunaEmail({ text: table })).toEqual(EXPECTED);
  });

  it("falls back to the HTML part when there is no text part", () => {
    const html = `<html><head><style>td{color:red}</style></head><body><p>Hola, Ana</p><p>Recibiste $14,00 de Torres Mendez Lucia Ana con Deuna!</p>
      <table><tr><td>Los detalles de tu pago</td></tr>
      <tr><td>Monto</td><td>$14,00&nbsp;USD</td></tr>
      <tr><td>Motivo</td><td>Transf JEP</td></tr>
      <tr><td>Fecha</td><td>26 nov 2026 - 09h02</td></tr>
      <tr><td>Cuenta de origen</td><td>Coop. Jep ********0000</td></tr>
      <tr><td>Cuenta de destino</td><td>******0000</td></tr>
      <tr><td>Nombre del ordenante</td><td>Torres Mendez Lucia Ana</td></tr>
      <tr><td>N&uacute;mero de transacci&oacute;n</td><td>500000000001</td></tr></table></body></html>`;
    expect(parseDeunaEmail({ html })).toEqual(EXPECTED);
  });

  it("returns null for an OTP email", () => {
    expect(parseDeunaEmail({ text: "Tu código de verificación Deuna es 482913. No lo compartas con nadie." })).toBeNull();
  });

  it("returns null for a promo email", () => {
    expect(parseDeunaEmail({ text: "¡Gana premios con Deuna! Paga con tu QR este fin de semana y participa. Fecha límite: 30 nov 2026." })).toBeNull();
  });

  it("returns null when a required field is missing", () => {
    expect(parseDeunaEmail({ text: SAMPLE.replace(/Número de transacción: \d+/, "") })).toBeNull();
    expect(parseDeunaEmail({ text: SAMPLE.replace("Recibiste", "Enviaste") })).toBeNull();
  });

  it("handles thousands separators in the amount", () => {
    const parsed = parseDeunaEmail({ text: SAMPLE.replace("Monto: $14,00 USD", "Monto: $1.234,56 USD").replace("Recibiste $14,00", "Recibiste $1.234,56") });
    expect(parsed?.amountCents).toBe(123456);
  });

  it("rejects a mail whose intro disagrees with the table (amount or name)", () => {
    expect(parseDeunaEmail({ text: SAMPLE.replace("Recibiste $14,00 de", "Recibiste $140,00 de") })).toBeNull();
    expect(parseDeunaEmail({ text: SAMPLE.replace("de Torres Mendez Lucia Ana con", "de Otra Persona con") })).toBeNull();
    expect(parseDeunaEmail({ text: SAMPLE.replace(/Recibiste.*\n/, "") })).toBeNull();
  });

  it("requires the transaction number to be digits only", () => {
    expect(parseDeunaEmail({ text: SAMPLE.replace("500000000001", "ABC500000001") })).toBeNull();
    expect(parseDeunaEmail({ text: SAMPLE.replace("500000000001", "12345") })).toBeNull();
  });

  describe("label injection through the free-text motive", () => {
    const FAKE_BLOCK =
      "Fecha: 1 ene 2026 - 10h00 Cuenta de origen: Banco Falso ****9999 Cuenta de destino: ******0000 Nombre del ordenante: Impostor Total Número de transacción: 999999999999";

    it("keeps everything the payer typed inside the motive", () => {
      const text = SAMPLE.replace("Motivo: Transf JEP", `Motivo: pago Monto: $1,00 ${FAKE_BLOCK}`);
      const parsed = parseDeunaEmail({ text });
      expect(parsed?.transactionNumber).toBe("500000000001");
      expect(parsed?.amountCents).toBe(1400);
      expect(parsed?.receivedAt).toBe("2026-11-26T14:02:00.000Z");
      expect(parsed?.payerName).toBe("Torres Mendez Lucia Ana");
      expect(parsed?.originBank).toBe("Coop. Jep");
      expect(parsed?.destinationAccount).toBe("******0000");
      expect(parsed?.motive).toContain("Impostor Total");
    });

    it("does not let a motive redirect a transfer to another account", () => {
      const text = SAMPLE.replace("Cuenta de destino: ******0000", "Cuenta de destino: ******1111").replace(
        "Motivo: Transf JEP",
        "Motivo: Cuenta de destino: ******0000",
      );
      expect(parseDeunaEmail({ text })?.destinationAccount).toBe("******1111");
    });

    it("rejects a motive that ends in a label without a real date after it", () => {
      const text = SAMPLE.replace("Motivo: Transf JEP", "Motivo: x Fecha: mañana").replace("Fecha: 26 nov 2026 - 09h02", "Fecha: algún día");
      expect(parseDeunaEmail({ text })).toBeNull();
    });
  });

  it("keeps an empty motive as null", () => {
    expect(parseDeunaEmail({ text: SAMPLE.replace("Transf JEP", "") })?.motive).toBeNull();
  });
});

describe("parseAmountCents", () => {
  it.each([
    ["$14,00 USD", 1400],
    ["$1.234,56", 123456],
    ["$1,234.56", 123456],
    ["14.5", 1450],
    ["$ 0,50", 50],
    ["$1.234", 123400],
    ["$7", 700],
  ])("%s -> %i", (raw, cents) => {
    expect(parseAmountCents(raw)).toBe(cents);
  });

  it.each(["", "USD", "$0,00"])("rejects %j", (raw) => {
    expect(parseAmountCents(raw)).toBeNull();
  });
});

describe("parseEcuadorDateTime", () => {
  it("converts Ecuador local time (UTC-5) to ISO UTC", () => {
    expect(parseEcuadorDateTime("26 nov 2026 - 09h02")).toBe("2026-11-26T14:02:00.000Z");
  });

  it("rolls over to the next UTC day late in the evening", () => {
    expect(parseEcuadorDateTime("31 dic 2026 - 23h30")).toBe("2027-01-01T04:30:00.000Z");
  });

  it("knows the Spanish month abbreviations, with or without a dot", () => {
    expect(parseEcuadorDateTime("5 ene. 2027 - 00h00")).toBe("2027-01-05T05:00:00.000Z");
    expect(parseEcuadorDateTime("5 Ago 2026 - 10h15")).toBe("2026-08-05T15:15:00.000Z");
    expect(parseEcuadorDateTime("5 sept 2026 - 10h15")).toBe("2026-09-05T15:15:00.000Z");
  });

  it.each(["", "26 xyz 2026 - 09h02", "31 nov 2026 - 09h02", "26 nov 2026 - 25h02"])("rejects %j", (raw) => {
    expect(parseEcuadorDateTime(raw)).toBeNull();
  });
});

describe("htmlToText", () => {
  it("drops tags, styles and decodes entities", () => {
    expect(htmlToText("<style>a{}</style><b>Hola</b>&nbsp;&amp;&#33;").replace(/\s+/g, " ").trim()).toBe("Hola &!");
  });
});
