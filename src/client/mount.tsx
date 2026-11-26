import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./design/index.css";

/** Mounts an app into #root (shared by the public and admin entries). */
export function mount(app: ReactNode): void {
  const container = document.getElementById("root");
  if (!container) throw new Error("Missing #root element");
  createRoot(container).render(<StrictMode>{app}</StrictMode>);
}
