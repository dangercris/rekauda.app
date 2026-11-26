import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Counter } from "./Counter";

function Harness({ initial = 1 }: { initial?: number }) {
  const [value, setValue] = useState(initial);
  return <Counter label="Estudiantes" value={value} onChange={setValue} min={1} max={3} />;
}

describe("Counter", () => {
  it("increments and decrements within bounds", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const plus = screen.getByRole("button", { name: "Agregar uno" });
    const minus = screen.getByRole("button", { name: "Quitar uno" });
    const output = screen.getByRole("status");
    expect(minus).toBeDisabled();
    await user.click(plus);
    await user.click(plus);
    expect(output).toHaveTextContent("3");
    expect(plus).toBeDisabled();
    await user.click(plus);
    expect(output).toHaveTextContent("3");
    await user.click(minus);
    expect(output).toHaveTextContent("2");
  });

  it("clamps an out-of-range value on the next change", async () => {
    render(<Harness initial={5} />);
    await userEvent.click(screen.getByRole("button", { name: "Quitar uno" }));
    expect(screen.getByRole("status")).toHaveTextContent("3");
  });

  it("names the group with its label", () => {
    render(<Harness />);
    expect(screen.getByRole("group", { name: "Estudiantes" })).toBeInTheDocument();
  });
});
