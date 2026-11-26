import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("renders a type=button by default and handles clicks", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Enviar</Button>);
    const button = screen.getByRole("button", { name: "Enviar" });
    expect(button).toHaveAttribute("type", "button");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("blocks clicks and keeps the label while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Enviar comprobante
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Enviar comprobante" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not fire when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Guardar
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders a link with href and routes internal links without reloading", async () => {
    window.history.replaceState(null, "", "/");
    render(<Button href="/estado">Ver estado</Button>);
    const link = screen.getByRole("link", { name: "Ver estado" });
    await userEvent.click(link);
    expect(window.location.pathname).toBe("/estado");
  });

  it("prevents navigation on a loading link", async () => {
    window.history.replaceState(null, "", "/");
    render(
      <Button href="/estado" loading>
        Ver estado
      </Button>,
    );
    await userEvent.click(screen.getByRole("link", { name: "Ver estado" }));
    expect(window.location.pathname).toBe("/");
  });
});
