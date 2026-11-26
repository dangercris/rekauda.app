import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { Button } from "./Button";
import styles from "./InlineConfirm.module.css";

export interface InlineConfirmProps {
  title: ReactNode;
  description?: ReactNode;
  /** Extra inputs between the text and the buttons (reason chips, a note field). */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
  /** danger (red confirm), ok (green), event (tone). Default danger. */
  tone?: "danger" | "ok" | "event" | undefined;
  loading?: boolean | undefined;
  confirmDisabled?: boolean | undefined;
  /** Move focus to the title when it appears (default true) so screen readers get the context. */
  autoFocus?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Dialog-free confirmation: replaces the action area in place (no modals). Escape cancels.
 * Render it conditionally where the triggering buttons were.
 */
export function InlineConfirm({
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
  tone = "danger",
  loading,
  confirmDisabled,
  autoFocus = true,
  className,
}: InlineConfirmProps) {
  const titleId = useId();
  const titleRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (autoFocus) titleRef.current?.focus();
  }, [autoFocus]);
  return (
    <section
      aria-labelledby={titleId}
      className={cx("m-glass", styles.confirm, className)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !loading) {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <strong id={titleId} ref={titleRef} tabIndex={-1} className={styles.title}>
        {title}
      </strong>
      {children}
      {description && <p className={styles.description}>{description}</p>}
      <div className={styles.actions}>
        <Button variant="glass" onClick={onCancel} disabled={loading} className={styles.cancel}>
          {cancelLabel}
        </Button>
        <Button
          variant={tone === "danger" ? "danger" : tone === "ok" ? "ok" : "event"}
          onClick={onConfirm}
          loading={loading}
          disabled={confirmDisabled}
          className={styles.ok}
        >
          {confirmLabel}
        </Button>
      </div>
    </section>
  );
}
