import { describe, expect, it } from "vitest";
import { collectionTitle, footerText, homeTitle } from "./identity";

describe("identity copy takes the tenant's names", () => {
  it("builds the home title from the short class name", () => {
    expect(homeTitle("1.º Básica A")).toBe("Recaudaciones 1.º Básica A");
    expect(homeTitle("3.º Bach. C")).toBe("Recaudaciones 3.º Bach. C");
  });

  it("builds a collection title with the short class name", () => {
    expect(collectionTitle("Vestuario", "1.º Básica A")).toBe("Vestuario · 1.º Básica A");
    expect(collectionTitle("Paseo", "3.º Bach. C")).toBe("Paseo · 3.º Bach. C");
  });

  it("builds the footer disclaimer", () => {
    expect(footerText("3.º de Bachillerato C", "Instituto Boreal")).toBe(
      "Sitio de los padres de familia de 3.º de Bachillerato C. No es un sitio oficial de Instituto Boreal.",
    );
  });
});
