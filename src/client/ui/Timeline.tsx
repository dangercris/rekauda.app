import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon } from "./Icon";
import styles from "./Timeline.module.css";

export type TimelineState = "done" | "current" | "pending" | "alert";

export interface TimelineItem {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned meta, e.g. "Hoy · 10:42" or "Ahora". */
  meta?: ReactNode;
  state: TimelineState;
  /** Color of the current step: warn (in review, default), info (received) or event. */
  tone?: "warn" | "info" | "event" | undefined;
}

export interface TimelineProps {
  items: readonly TimelineItem[];
  /** Accessible name of the list. */
  label?: string | undefined;
  className?: string | undefined;
}

const STATE_TEXT: Record<TimelineState, string> = {
  done: "Completado",
  current: "En curso",
  pending: "Pendiente",
  alert: "Requiere atención",
};

/** Vertical status timeline (payment progress). Each state has a distinct marker shape, not only a color. */
export function Timeline({ items, label, className }: TimelineProps) {
  return (
    <ol className={cx(styles.timeline, className)} aria-label={label}>
      {items.map((item, index) => {
        const last = index === items.length - 1;
        return (
          <li
            key={item.id}
            className={cx(styles.item, styles[item.state], item.state === "current" && styles[`tone_${item.tone ?? "warn"}`])}
            aria-current={item.state === "current" ? "step" : undefined}
          >
            <span className={styles.rail} aria-hidden="true">
              <span className={styles.marker}>
                {item.state === "done" && <Icon name="check" size={13} strokeWidth={3} />}
                {item.state === "current" && <span className={styles.pulse} />}
                {item.state === "alert" && <Icon name="alert-circle" size={14} strokeWidth={2.4} />}
              </span>
              {!last && <span className={styles.line} />}
            </span>
            <span className={cx(styles.body, last && styles.lastBody)}>
              <strong className={styles.title}>
                <span className="visually-hidden">{`${STATE_TEXT[item.state]}: `}</span>
                {item.title}
              </strong>
              {item.description && <span className={styles.description}>{item.description}</span>}
            </span>
            <span className={cx(styles.meta, "num")}>{item.meta}</span>
          </li>
        );
      })}
    </ol>
  );
}
