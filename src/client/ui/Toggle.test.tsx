import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Toggle } from "./Toggle";

function Harness() {
  const [on, setOn] = useState(false);
  return <Toggle label="Avisar por correo" description="Envía el aviso a la representante" checked={on} onChange={setOn} />;
}

describe("Toggle", () => {
  it("is a switch named and described by its row text", () => {
    render(<Harness />);
    const sw = screen.getByRole("switch", { name: "Avisar por correo" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(sw).toHaveAccessibleDescription("Envía el aviso a la representante");
  });

  it("toggles with click and keyboard", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const sw = screen.getByRole("switch");
    await user.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
    sw.focus();
    await user.keyboard(" ");
    expect(sw).toHaveAttribute("aria-checked", "false");
    await user.keyboard("{Enter}");
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("does not change when disabled", async () => {
    const onChange = vi.fn();
    render(<Toggle bare label="Recordatorio" checked={false} onChange={onChange} disabled />);
    await userEvent.click(screen.getByRole("switch", { name: "Recordatorio" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
