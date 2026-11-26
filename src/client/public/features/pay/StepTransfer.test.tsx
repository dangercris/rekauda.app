import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { config, musical } from "../../test/fixtures";
import { StepTransfer } from "./StepTransfer";

const LINK =
  "https://pagar.deuna.app/H92p/U2FsdGVkX180tkszt2uINP1MwfWDwJofelUhz77PnJJlyvsbeaqwP6c9I3nfwiL64qufVmH8lrcL7+YE054oM+/mGPbBGyKw329aeNw1rjVZb8I1aqPApbj1FFj8vyyJtIobjBsH8X3adZBpmVtWLv+Q6AcjFvRZCKJtfY84BdfKO+4+wCEeB+ZQINX2fzAS1A0Jru1GOLNz2OoRvSugDA==";

function renderStep(collection = musical, count = 2, treasury = config.treasury) {
  return render(<StepTransfer collection={collection} count={count} onCount={vi.fn()} treasury={treasury} onNext={vi.fn()} />);
}

describe("StepTransfer Deuna links", () => {
  it("uses the collection link as the primary button, untouched, and asks to check the total", () => {
    renderStep({ ...musical, deunaLink: LINK }, 2);
    // The charge link has its own fixed amount, so the label never claims one; the hint names the expected total.
    const link = screen.getByRole("link", { name: "Pagar con Deuna" });
    expect(screen.getByText(/Revisa que el monto sea \$28,00/)).toBeInTheDocument();
    expect(link).toHaveAttribute("href", LINK);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // A single Deuna button: the charge link replaces the app link.
    expect(screen.getAllByRole("link", { name: /Deuna/ }).filter((a) => a.getAttribute("href") === config.treasury.deunaUrl)).toHaveLength(0);
    expect(screen.getAllByRole("link", { name: "Pagar con Deuna" })).toHaveLength(1);
  });

  it("uses the collection link when the treasury has no personal link", () => {
    renderStep({ ...musical, deunaLink: LINK }, 1, { ...config.treasury, deunaUrl: null });
    expect(screen.getByRole("link", { name: "Pagar con Deuna" })).toHaveAttribute("href", LINK);
  });

  it("opens the app (treasury link) without a collection link", () => {
    renderStep(musical, 1);
    expect(screen.getByRole("link", { name: "Pagar con Deuna" })).toHaveAttribute("href", config.treasury.deunaUrl);
    expect(screen.getAllByRole("link", { name: "Pagar con Deuna" })).toHaveLength(1);
  });

  it("uses a generic label when the amount depends on the chosen options", () => {
    const mixed = { ...musical, deunaLink: LINK, options: [{ ...musical.options[0]!, cents: 1400 }, { ...musical.options[1]!, cents: 2000 }] };
    renderStep(mixed, 1);
    expect(screen.getByRole("link", { name: "Pagar con Deuna" })).toHaveAttribute("href", LINK);
  });
});
