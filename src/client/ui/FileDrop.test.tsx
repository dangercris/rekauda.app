import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RECEIPT_ACCEPT, FileDrop, acceptsFile, checkFile } from "./FileDrop";

const file = (name: string, type: string, size = 1000): File => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

describe("acceptsFile / checkFile", () => {
  it("matches MIME, wildcards and extensions", () => {
    expect(acceptsFile(file("a.jpg", "image/jpeg"), ["image/*"])).toBe(true);
    expect(acceptsFile(file("a.pdf", "application/pdf"), ["application/pdf"])).toBe(true);
    expect(acceptsFile(file("IMG_1.HEIC", ""), [".heic"])).toBe(true);
    expect(acceptsFile(file("a.docx", "application/vnd.openxmlformats"), DEFAULT_RECEIPT_ACCEPT)).toBe(false);
  });

  it("size-checks PDFs but lets compressible images through", () => {
    const max = 5 * 1024 * 1024;
    expect(checkFile(file("big.pdf", "application/pdf", max + 1), DEFAULT_RECEIPT_ACCEPT, max)).toBe("size");
    expect(checkFile(file("big.jpg", "image/jpeg", max * 2), DEFAULT_RECEIPT_ACCEPT, max)).toBeNull();
    expect(checkFile(file("big.jpg", "image/jpeg", max * 2), DEFAULT_RECEIPT_ACCEPT, max, false)).toBe("size");
    expect(checkFile(file("a.zip", "application/zip"), DEFAULT_RECEIPT_ACCEPT, max)).toBe("type");
  });
});

function Harness({ onReject }: { onReject?: (reason: string) => void }) {
  const [value, setValue] = useState<File | null>(null);
  return <FileDrop label="Comprobante de pago" value={value} onChange={setValue} onReject={onReject} />;
}

describe("FileDrop", () => {
  it("accepts a picked image and shows it as ready, then removes it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText(/Comprobante de pago/);
    await user.upload(input, file("Comprobante_Deuna.png", "image/png", 2048));
    expect(screen.getByText("Comprobante_Deuna.png")).toBeInTheDocument();
    expect(screen.getByText("Listo para enviar")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Quitar comprobante de pago" }));
    expect(screen.queryByText("Comprobante_Deuna.png")).not.toBeInTheDocument();
  });

  it("rejects an unsupported file with an inline error", () => {
    const onReject = vi.fn();
    render(<Harness onReject={onReject} />);
    const input = screen.getByLabelText(/Comprobante de pago/);
    fireEvent.change(input, { target: { files: [file("notas.docx", "application/msword")] } });
    expect(onReject).toHaveBeenCalledWith("type", expect.any(File));
    expect(screen.getByRole("alert")).toHaveTextContent(/no se puede subir/);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("accepts a dropped PDF", () => {
    render(<Harness />);
    const zone = screen.getByText("Toca para elegir la captura").closest("div");
    if (!zone) throw new Error("zone not found");
    fireEvent.drop(zone, { dataTransfer: { files: [file("Transferencia.pdf", "application/pdf")] } });
    expect(screen.getByText("Transferencia.pdf")).toBeInTheDocument();
    expect(screen.getByText(/PDF ·/)).toBeInTheDocument();
  });
});
