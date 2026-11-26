import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "../lib/cx";
import styles from "./SegmentedControl.module.css";
import { renderSlot, type IconSlot } from "./slot";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Number shown above the label (tall size), e.g. counts per status. */
  count?: number | string | undefined;
  icon?: IconSlot | undefined;
  disabled?: boolean | undefined;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group, e.g. "Filtrar por estado". */
  label: string;
  /** md: 40px segments; tall: 54px with a count above the label (AdminPagos). Default md. */
  size?: "md" | "tall" | undefined;
  className?: string | undefined;
}

/**
 * Glass segmented control with radio semantics: one tab stop, arrow keys move and select,
 * Home/End jump to the ends. Disabled options are skipped.
 */
export function SegmentedControl<T extends string>({ options, value, onChange, label, size = "md", className }: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const tabStop = selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : (enabled[0] ?? -1);

  const move = (from: number, key: string): number | null => {
    if (enabled.length === 0) return null;
    const pos = enabled.indexOf(from);
    if (key === "Home") return enabled[0] ?? null;
    if (key === "End") return enabled[enabled.length - 1] ?? null;
    const delta = key === "ArrowRight" || key === "ArrowDown" ? 1 : key === "ArrowLeft" || key === "ArrowUp" ? -1 : 0;
    if (delta === 0) return null;
    const next = (pos + delta + enabled.length) % enabled.length;
    return enabled[next] ?? null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = move(index, event.key);
    if (target === null) return;
    event.preventDefault();
    const option = options[target];
    if (!option) return;
    refs.current[target]?.focus();
    if (option.value !== value) onChange(option.value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("m-glass", styles.group, styles[size], className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === tabStop ? 0 : -1}
            disabled={option.disabled}
            onClick={() => {
              if (!selected) onChange(option.value);
            }}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cx(styles.segment, selected && styles.selected)}
          >
            {size === "tall" && option.count !== undefined && <span className={cx(styles.count, "num")}>{option.count}</span>}
            <span className={styles.label}>
              {renderSlot(option.icon, 15)}
              {option.label}
            </span>
            {size !== "tall" && option.count !== undefined && <span className={cx(styles.inlineCount, "num")}>{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
