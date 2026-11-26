import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import type { StatusTone } from "./status";
import styles from "./Progress.module.css";

export interface ProgressBarProps {
  /** 0..1 */
  value: number;
  /** Accessible name, e.g. "Familias que ya pagaron". */
  label: string;
  /** Spoken value, e.g. "21 de 32". Defaults to a percentage. */
  valueText?: string | undefined;
  /** md 8px (event card), sm 6px (rows), lg 12px (admin summary). */
  size?: "sm" | "md" | "lg" | undefined;
  tone?: "event" | "ok" | "warn" | undefined;
  className?: string | undefined;
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Event-tone progress bar. The fill animates with transform (no layout animation). */
export function ProgressBar({ value, label, valueText, size = "md", tone = "event", className }: ProgressBarProps) {
  const v = clamp01(value);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-valuetext={valueText ?? `${Math.round(v * 100)} %`}
      className={cx(styles.track, styles[size], className)}
    >
      <span className={cx(styles.fill, styles[tone])} style={{ transform: `scaleX(${v})` }} />
    </div>
  );
}

export interface BarSegment {
  key: string;
  value: number;
  /** Status tone, "event" for the current tone, or any CSS color (per-event colors in admin). */
  color: StatusTone | "event" | (string & {});
  label: string;
  /** Legend value text, e.g. "$315". Defaults to the number. */
  display?: ReactNode;
}

export interface SegmentedBarProps {
  segments: readonly BarSegment[];
  /** Denominator; defaults to the sum of the segments (full bar). */
  total?: number | undefined;
  /** Accessible summary; defaults to "label value, ..." built from the segments. */
  label?: string | undefined;
  legend?: boolean | undefined;
  size?: "md" | "lg" | undefined;
  className?: string | undefined;
}

const TONES = new Set(["warn", "info", "bad", "ok", "void", "event"]);

function colorOf(color: BarSegment["color"]): string {
  if (!TONES.has(color)) return color;
  return color === "event" ? "var(--ev)" : `var(--${color}-solid, var(--${color}))`;
}

/** Multi-part bar (status mix, money per event) with an optional legend. */
export function SegmentedBar({ segments, total, label, legend, size = "lg", className }: SegmentedBarProps) {
  const sum = segments.reduce((acc, s) => acc + Math.max(0, s.value), 0);
  const denominator = total && total > 0 ? total : sum || 1;
  const summary = label ?? segments.map((s) => `${s.label} ${s.value}`).join(", ");
  return (
    <div className={cx(styles.segmented, className)}>
      <div role="img" aria-label={summary} className={cx(styles.segTrack, styles[`seg_${size}`])}>
        {segments.map((s) =>
          s.value > 0 ? (
            <span key={s.key} className={styles.segment} style={{ flexBasis: `${(Math.max(0, s.value) / denominator) * 100}%`, background: colorOf(s.color) }} />
          ) : null,
        )}
      </div>
      {legend && (
        <ul role="list" className={cx(styles.legend, "num")} aria-hidden="true">
          {segments.map((s) => (
            <li key={s.key} className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: colorOf(s.color) }} />
              {s.label} {s.display ?? s.value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
