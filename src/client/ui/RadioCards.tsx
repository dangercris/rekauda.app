import { useId, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon } from "./Icon";
import { Money } from "./Money";
import styles from "./RadioCards.module.css";
import { renderSlot, type IconSlot } from "./slot";

export interface RadioCardOption<T extends string> {
  value: T;
  label: ReactNode;
  detail?: ReactNode;
  /** Price shown on the right. */
  cents?: number | undefined;
  icon?: IconSlot | undefined;
  disabled?: boolean | undefined;
}

export interface RadioCardsProps<T extends string> {
  /** Group label (rendered as the fieldset legend). */
  legend: ReactNode;
  hideLegend?: boolean | undefined;
  options: readonly RadioCardOption<T>[];
  /** Null when nothing is picked yet. */
  value: T | null;
  onChange: (value: T) => void;
  name?: string | undefined;
  error?: ReactNode;
  hint?: ReactNode;
  /** Two columns from 360px when labels are short. Default 1. */
  columns?: 1 | 2 | undefined;
  className?: string | undefined;
}

/** Option picker built on native radios (arrow keys, form semantics) with card visuals and a check mark. */
export function RadioCards<T extends string>({
  legend,
  hideLegend,
  options,
  value,
  onChange,
  name,
  error,
  hint,
  columns = 1,
  className,
}: RadioCardsProps<T>) {
  const auto = useId();
  const groupName = name ?? `rc${auto}`;
  const errorId = error ? `${groupName}-error` : undefined;
  const hintId = hint ? `${groupName}-hint` : undefined;
  return (
    <fieldset
      className={cx(styles.fieldset, className)}
      aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
      aria-invalid={error ? true : undefined}
    >
      <legend className={cx(styles.legend, hideLegend && "visually-hidden")}>{legend}</legend>
      <div className={cx(styles.grid, columns === 2 && styles.two)}>
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label key={option.value} className={cx(styles.card, checked && styles.checked, option.disabled && styles.disabled)}>
              <input
                type="radio"
                className="visually-hidden"
                name={groupName}
                value={option.value}
                checked={checked}
                disabled={option.disabled}
                onChange={() => onChange(option.value)}
              />
              {option.icon !== undefined && <span className={styles.icon}>{renderSlot(option.icon, 20)}</span>}
              <span className={styles.text}>
                <span className={styles.label}>{option.label}</span>
                {option.detail && <span className={styles.detail}>{option.detail}</span>}
              </span>
              {option.cents !== undefined && <Money cents={option.cents} className={styles.price} />}
              <span className={styles.mark} aria-hidden="true">
                <Icon name="check" size={14} strokeWidth={3} />
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <p id={errorId} className={styles.error}>
          <Icon name="alert-circle" size={15} strokeWidth={2} />
          <span>{error}</span>
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}
