import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "../lib/cx";
import styles from "./Checkbox.module.css";
import { useFieldIds } from "./Field";
import { Icon } from "./Icon";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  ref?: Ref<HTMLInputElement> | undefined;
}

/** Native checkbox with a 24px custom box; the whole row is the hit area. */
export function Checkbox({ label, hint, error, id, className, ref, disabled, ...rest }: CheckboxProps) {
  const ids = useFieldIds(id, Boolean(hint), Boolean(error), rest["aria-describedby"]);
  return (
    <div className={cx(styles.wrap, className)}>
      <label className={cx(styles.row, disabled && styles.disabled)} htmlFor={ids.inputId}>
        <span className={styles.boxWrap}>
          <input
            ref={ref}
            id={ids.inputId}
            type="checkbox"
            disabled={disabled}
            {...rest}
            aria-invalid={error ? true : undefined}
            aria-describedby={ids.describedBy}
            className={cx(styles.input, error && styles.invalid)}
          />
          <Icon name="check" size={16} strokeWidth={3} className={styles.check} />
        </span>
        <span className={styles.label}>{label}</span>
      </label>
      {error ? (
        <p id={ids.errorId} className={styles.error}>
          <Icon name="alert-circle" size={15} strokeWidth={2} />
          <span>{error}</span>
        </p>
      ) : null}
      {hint ? (
        <p id={ids.hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
