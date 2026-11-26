import { useId, type ReactNode } from "react";
import { cx } from "../lib/cx";
import styles from "./Toggle.module.css";

interface ToggleBase {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean | undefined;
  /** Track color when on: ok (green, default as in the canvas) or event tone. */
  tone?: "ok" | "event" | undefined;
  className?: string | undefined;
  id?: string | undefined;
}

export interface ToggleRowProps extends ToggleBase {
  /** Visible label on the left of the row. */
  label: ReactNode;
  description?: ReactNode;
  bare?: false | undefined;
}

export interface ToggleBareProps extends ToggleBase {
  /** Accessible name for a switch without visible text. */
  label: string;
  bare: true;
  description?: undefined;
}

export type ToggleProps = ToggleRowProps | ToggleBareProps;

function Switch({ checked, onChange, disabled, tone = "ok", id, labelledBy, describedBy, ariaLabel }: ToggleBase & {
  labelledBy?: string | undefined;
  describedBy?: string | undefined;
  ariaLabel?: string | undefined;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(styles.switch, tone === "event" && styles.event)}
    >
      <span className={styles.knob} aria-hidden="true" />
    </button>
  );
}

/** iOS-style switch (role="switch"). Default layout is a row: label and description left, switch right. */
export function Toggle(props: ToggleProps) {
  const auto = useId();
  if (props.bare) {
    const { label, className, ...rest } = props;
    return (
      <span className={className}>
        <Switch {...rest} ariaLabel={label} />
      </span>
    );
  }
  const { label, description, className, ...rest } = props;
  const labelId = `${auto}-label`;
  const descId = description ? `${auto}-desc` : undefined;
  return (
    <div className={cx(styles.row, rest.disabled && styles.disabled, className)}>
      <span className={styles.text}>
        <span id={labelId} className={styles.label}>
          {label}
        </span>
        {description && (
          <span id={descId} className={styles.description}>
            {description}
          </span>
        )}
      </span>
      <Switch {...rest} labelledBy={labelId} describedBy={descId} />
    </div>
  );
}
