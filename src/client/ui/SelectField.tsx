import type { ReactNode, Ref, SelectHTMLAttributes } from "react";
import { cx } from "../lib/cx";
import { FieldShell, fieldStyles as s, useFieldIds } from "./Field";
import { Icon } from "./Icon";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean | undefined;
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  label: ReactNode;
  options: readonly SelectOption[];
  /** First, empty option shown until a value is picked (e.g. "Elige tu banco"). */
  placeholder?: string | undefined;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean | undefined;
  hideLabel?: boolean | undefined;
  ref?: Ref<HTMLSelectElement> | undefined;
}

/** Native <select>, styled like the text fields (never replaced: native pickers are best on phones). */
export function SelectField({ label, options, placeholder, hint, error, optional, hideLabel, className, id, disabled, ref, ...rest }: SelectFieldProps) {
  const ids = useFieldIds(id, Boolean(hint), Boolean(error), rest["aria-describedby"]);
  return (
    <FieldShell label={label} ids={ids} hint={hint} error={error} optional={optional} hideLabel={hideLabel} className={className}>
      <div className={cx(s.control, s.selectWrap)} data-invalid={error ? "true" : undefined} data-disabled={disabled ? "true" : undefined}>
        <select
          ref={ref}
          id={ids.inputId}
          disabled={disabled}
          {...rest}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          className={cx(s.input, s.select)}
        >
          {placeholder !== undefined && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={18} className={s.chevron} />
      </div>
    </FieldShell>
  );
}
