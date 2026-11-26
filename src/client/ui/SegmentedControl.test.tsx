import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SegmentedControl } from "./SegmentedControl";

type V = "todos" | "revision" | "pagados" | "observados";

function Harness({ disabledLast = false }: { disabledLast?: boolean }) {
  const [value, setValue] = useState<V>("todos");
  return (
    <SegmentedControl
      label="Filtrar por estado"
      value={value}
      onChange={setValue}
      options={[
        { value: "todos", label: "Todos" },
        { value: "revision", label: "En revisión" },
        { value: "pagados", label: "Pagados" },
        { value: "observados", label: "Observados", disabled: disabledLast },
      ]}
    />
  );
}

describe("SegmentedControl", () => {
  it("exposes a radiogroup with a single tab stop", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Filtrar por estado" })).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios.filter((r) => r.getAttribute("tabindex") === "0")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: "Todos" })).toHaveAttribute("aria-checked", "true");
  });

  it("moves and selects with arrow keys, wrapping around, and Home/End", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole("radio", { name: "Todos" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    const revision = screen.getByRole("radio", { name: "En revisión" });
    expect(revision).toHaveFocus();
    expect(revision).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{End}");
    expect(screen.getByRole("radio", { name: "Observados" })).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Todos" })).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Observados" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("radio", { name: "Todos" })).toHaveFocus();
  });

  it("skips disabled options", async () => {
    render(<Harness disabledLast />);
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Pagados" })).toHaveAttribute("aria-checked", "true");
  });

  it("selects on click", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("radio", { name: "Pagados" }));
    expect(screen.getByRole("radio", { name: "Pagados" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Pagados" })).toHaveAttribute("tabindex", "0");
  });
});
