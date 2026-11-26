import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { config } from "../../test/fixtures";
import { PaymentDetailsDisclosure } from "./PaymentDetails";

describe("PaymentDetailsDisclosure", () => {
  it("starts collapsed and holds the account data, amount and the Deuna button", () => {
    const { container } = render(<PaymentDetailsDisclosure treasury={config.treasury} total={2800} deunaLink="https://pagar.deuna.app/H92p/abc" collectionSlug="musical" />);
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("Ver datos de pago")).toBeInTheDocument();
    expect(screen.getByText(config.treasury.accountNumber)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copiar monto/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pagar con Deuna" })).toHaveAttribute("href", "https://pagar.deuna.app/H92p/abc");
  });

  it("hides the amount row when the total is unknown", () => {
    render(<PaymentDetailsDisclosure treasury={config.treasury} total={null} deunaLink={null} collectionSlug="musical" />);
    expect(screen.queryByRole("button", { name: /Copiar monto/ })).not.toBeInTheDocument();
  });
});
