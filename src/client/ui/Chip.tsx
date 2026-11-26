import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";
import styles from "./Chip.module.css";
import { renderSlot, type IconSlot } from "./slot";

export type ChipVariant = "glass" | "strong" | "soft" | "event" | "on-image";
export type ChipDot = boolean | "live" | "event" | "ok" | "warn" | "bad" | "info";

interface ChipBaseProps {
  /** glass = filter chip on the page, strong = dense chip on glass (choices), soft = event-tone tag,
   *  event = tone glass over photos (price tag), on-image = dark glass over photos. Default glass. */
  variant?: ChipVariant | undefined;
  size?: "sm" | "md" | undefined;
  icon?: IconSlot | undefined;
  /** Leading dot. `true`/"event" uses the event tone; "live" is the pulsing green of an open collection. */
  dot?: ChipDot | undefined;
  /** Fill used when `selected`: ink (filters, default) or bad (rejection reasons) or event. */
  selectedTone?: "ink" | "bad" | "event" | undefined;
  className?: string | undefined;
  children: ReactNode;
}

export interface StaticChipProps extends ChipBaseProps {
  onClick?: undefined;
  selected?: undefined;
}

export interface ToggleChipProps
  extends ChipBaseProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ChipBaseProps | "onClick"> {
  onClick: () => void;
  /** Rendered as aria-pressed. */
  selected?: boolean | undefined;
}

export type ChipProps = StaticChipProps | ToggleChipProps;

function Dot({ dot }: { dot: ChipDot }) {
  const tone = dot === true ? "event" : dot;
  return <span aria-hidden="true" className={cx(styles.dot, tone !== false && styles[`dot_${tone}`])} />;
}

const isToggle = (props: ChipProps): props is ToggleChipProps => typeof props.onClick === "function";

/** Pill label: filters, tags, metadata over images. Interactive when given `onClick`. */
export function Chip(props: ChipProps) {
  const { variant = "glass", size = "md", icon, dot, selectedTone = "ink", className, children } = props;
  const base = cx(
    styles.chip,
    styles[variant.replace("-", "_")],
    styles[size],
    variant === "glass" && "m-glass",
    variant === "on-image" && "m-glass-dark",
    className,
  );
  const inner = (
    <>
      {dot !== undefined && dot !== false && <Dot dot={dot} />}
      {renderSlot(icon, size === "sm" ? 13 : 14)}
      <span className={styles.label}>{children}</span>
    </>
  );
  if (isToggle(props)) {
    const { variant: _v, size: _s, icon: _i, dot: _d, selectedTone: _t, className: _c, children: _ch, selected, onClick, type, ...rest } = props;
    return (
      <button
        type={type ?? "button"}
        {...rest}
        aria-pressed={selected ?? false}
        onClick={onClick}
        className={cx(base, styles.interactive, selected && styles[`selected_${selectedTone}`])}
      >
        {inner}
      </button>
    );
  }
  return <span className={base}>{inner}</span>;
}

export interface BadgeProps {
  count: number;
  /** Counts above `max` render as "max+". Default 99. */
  max?: number | undefined;
  /** Accessible text, e.g. "7 pagos por verificar". Without it the badge is decorative. */
  label?: string | undefined;
  className?: string | undefined;
}

/** Amber count bubble for tab bars and buttons. Renders nothing for 0. */
export function Badge({ count, max = 99, label, className }: BadgeProps) {
  if (count <= 0) return null;
  const text = count > max ? `${max}+` : String(count);
  return (
    <span className={cx(styles.badge, "num", className)} {...(label ? { role: "status", "aria-label": label } : { "aria-hidden": true })}>
      {text}
    </span>
  );
}
