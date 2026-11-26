import { useEffect, useRef, useState, type ReactNode } from "react";
import { copyText } from "../lib/clipboard";
import { cx } from "../lib/cx";
import { Button } from "./Button";
import styles from "./KeyValue.module.css";

export interface KeyValueProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  /** md 15px (default), lg 21px (account numbers), sm 14px (dense grids). */
  size?: "sm" | "md" | "lg" | undefined;
  mono?: boolean | undefined;
  /** Color the value with the event tone (tracking codes). */
  accent?: boolean | undefined;
  className?: string | undefined;
}

/** Caption over a value. Use in grids (receipt summary) or rows. */
export function KeyValue({ label, value, hint, size = "md", mono, accent, className }: KeyValueProps) {
  return (
    <div className={cx(styles.kv, className)}>
      <span className={styles.label}>{label}</span>
      <span className={cx(styles.value, styles[size], mono && "mono", accent && styles.accent)}>{value}</span>
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}

export interface CopyRowProps extends Omit<KeyValueProps, "value"> {
  /** Exact text copied to the clipboard. */
  value: string;
  /** What is shown (defaults to `value`), e.g. a spaced phone number. */
  display?: ReactNode;
  copyLabel?: string | undefined;
  copiedLabel?: string | undefined;
  /** Called after each attempt with the result. */
  onCopy?: ((ok: boolean) => void) | undefined;
}

type CopyState = "idle" | "copied" | "failed";

/** Value with a copy button that confirms "Copiado" for 1.6 s (clipboard API with legacy fallback). */
export function CopyRow({
  label,
  value,
  display,
  hint,
  size = "md",
  mono,
  accent,
  copyLabel = "Copiar",
  copiedLabel = "Copiado",
  onCopy,
  className,
}: CopyRowProps) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    const ok = await copyText(value);
    setState(ok ? "copied" : "failed");
    onCopy?.(ok);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), ok ? 1600 : 2400);
  };

  const plainLabel = typeof label === "string" ? label : "";
  return (
    <div className={cx(styles.row, className)}>
      <KeyValue label={label} value={display ?? value} hint={hint} size={size} mono={mono} accent={accent} className={styles.grow} />
      <Button
        variant="glass"
        size="sm"
        iconStart={state === "copied" ? "check" : "copy"}
        onClick={copy}
        aria-label={state === "idle" && plainLabel ? `${copyLabel} ${plainLabel.toLowerCase()}` : undefined}
        className={cx(styles.button, state === "copied" && styles.copied, state === "failed" && styles.failed)}
      >
        {state === "copied" ? copiedLabel : state === "failed" ? "No se pudo" : copyLabel}
      </Button>
      <span className="visually-hidden" role="status" aria-live="polite">
        {state === "copied" ? `${copiedLabel}: ${value}` : state === "failed" ? "No se pudo copiar. Mantén presionado el texto para copiarlo." : ""}
      </span>
    </div>
  );
}
