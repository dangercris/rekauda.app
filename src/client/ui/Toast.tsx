import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon, type IconName } from "./Icon";
import styles from "./Toast.module.css";

export type ToastTone = "neutral" | "ok" | "error" | "info";

export interface ToastOptions {
  message: string;
  tone?: ToastTone | undefined;
  /** Milliseconds before auto-dismiss. Default 3500 (6000 for errors). 0 keeps it until dismissed. */
  duration?: number | undefined;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  duration: number;
}

export interface ToastApi {
  /** Shows a toast; returns its id. */
  show: (options: ToastOptions | string) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONS: Record<ToastTone, IconName> = { neutral: "info", info: "info", ok: "check", error: "alert-circle" };

/** Mount once near the app root. Toasts appear above the bottom bar (set `--toast-offset` on a parent). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((options: ToastOptions | string) => {
    const opts: ToastOptions = typeof options === "string" ? { message: options } : options;
    const tone = opts.tone ?? "neutral";
    const id = nextId.current++;
    const item: ToastItem = { id, message: opts.message, tone, duration: opts.duration ?? (tone === "error" ? 6000 : 3500) };
    setItems((list) => [...list.slice(-2), item]);
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.region} role="region" aria-label="Notificaciones">
        <div aria-live="polite" aria-atomic="false" className={styles.stack}>
          {items.map((item) => (
            <ToastView key={item.id} item={item} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    if (item.duration <= 0) return undefined;
    const timer = setTimeout(() => onDismiss(item.id), item.duration);
    return () => clearTimeout(timer);
  }, [item, onDismiss]);
  return (
    <div className={cx("m-glass", styles.toast, styles[item.tone])} role={item.tone === "error" ? "alert" : undefined}>
      <span className={styles.icon}>
        <Icon name={ICONS[item.tone]} size={16} strokeWidth={2.4} />
      </span>
      <span className={styles.message}>{item.message}</span>
      <button type="button" className={styles.close} onClick={() => onDismiss(item.id)} aria-label="Cerrar aviso">
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

/** Access the toast API. Throws when used outside <ToastProvider> (a wiring bug, not a runtime case). */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}
