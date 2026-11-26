import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyRow } from "./KeyValue";

const originalClipboard = Object.getOwnPropertyDescriptor(window.navigator, "clipboard");

function setClipboard(value: unknown) {
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value });
}

afterEach(() => {
  vi.useRealTimers();
  if (originalClipboard) Object.defineProperty(window.navigator, "clipboard", originalClipboard);
  else setClipboard(undefined);
  Reflect.deleteProperty(document, "execCommand");
});

describe("CopyRow", () => {
  it("copies with the Clipboard API and confirms for 1.6 s", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const onCopy = vi.fn();
    render(<CopyRow label="Número Deuna" value="0991234567" display="099 123 4567" onCopy={onCopy} />);
    expect(screen.getByText("099 123 4567")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copiar número deuna" }));
    expect(writeText).toHaveBeenCalledWith("0991234567");
    expect(onCopy).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: /Copiado/ })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Copiado: 0991234567");
  });

  it("returns to idle after the confirmation", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    render(<CopyRow label="Concepto" value="Musical · Ana" />);
    await userEvent.click(screen.getByRole("button", { name: "Copiar concepto" }));
    expect(screen.getByRole("button", { name: /Copiado/ })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1700);
    });
    expect(screen.getByRole("button", { name: "Copiar concepto" })).toBeInTheDocument();
  });

  it("falls back to execCommand when the Clipboard API is missing", async () => {
    setClipboard(undefined);
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    render(<CopyRow label="Concepto" value="Musical · Ana" />);
    await userEvent.click(screen.getByRole("button", { name: "Copiar concepto" }));
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(screen.getByRole("button", { name: /Copiado/ })).toBeInTheDocument();
  });

  it("falls back when the Clipboard API rejects, and reports failure when both fail", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(false) });
    const onCopy = vi.fn();
    render(<CopyRow label="Concepto" value="Musical · Ana" onCopy={onCopy} />);
    await userEvent.click(screen.getByRole("button", { name: "Copiar concepto" }));
    expect(onCopy).toHaveBeenCalledWith(false);
    expect(screen.getByRole("button", { name: /No se pudo/ })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/No se pudo copiar/);
  });
});
