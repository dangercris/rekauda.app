import type { InputHTMLAttributes, ReactNode, Ref, TextareaHTMLAttributes } from "react";
import { cx } from "../lib/cx";
import { FieldShell, fieldStyles as s, useFieldIds } from "./Field";

interface FieldOwnProps {
  label: ReactNode;
  hint?: ReactNode;
  /** Error message; sets aria-invalid and is announced through aria-describedby. */
  error?: ReactNode;
  optional?: boolean | undefined;
  hideLabel?: boolean | undefined;
  /** Wrapper class (the field column). */
  className?: string | undefined;
}

export interface TextFieldProps extends FieldOwnProps, Omit<InputHTMLAttributes<HTMLInputElement>, keyof FieldOwnProps | "prefix"> {
  /** Static text before the value, e.g. "$". */
  prefix?: ReactNode;
  suffix?: ReactNode;
  /** Geist Mono with tabular figures (codes, transaction numbers). */
  mono?: boolean | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
}

/** Labeled text input, 50px tall, 16px text (no iOS zoom). */
export function TextField({ label, hint, error, optional, hideLabel, className, prefix, suffix, mono, id, disabled, ref, type, ...rest }: TextFieldProps) {
  const ids = useFieldIds(id, Boolean(hint), Boolean(error), rest["aria-describedby"]);
  return (
    <FieldShell label={label} ids={ids} hint={hint} error={error} optional={optional} hideLabel={hideLabel} className={className}>
      <div className={s.control} data-invalid={error ? "true" : undefined} data-disabled={disabled ? "true" : undefined}>
        {prefix !== undefined && <span className={s.affix} aria-hidden="true">{prefix}</span>}
        <input
          ref={ref}
          id={ids.inputId}
          type={type ?? "text"}
          disabled={disabled}
          {...rest}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          className={cx(s.input, mono && s.mono)}
        />
        {suffix !== undefined && <span className={s.affix} aria-hidden="true">{suffix}</span>}
      </div>
    </FieldShell>
  );
}

export interface TextAreaProps extends FieldOwnProps, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, keyof FieldOwnProps> {
  ref?: Ref<HTMLTextAreaElement> | undefined;
}

export function TextArea({ label, hint, error, optional, hideLabel, className, id, disabled, ref, rows, ...rest }: TextAreaProps) {
  const ids = useFieldIds(id, Boolean(hint), Boolean(error), rest["aria-describedby"]);
  return (
    <FieldShell label={label} ids={ids} hint={hint} error={error} optional={optional} hideLabel={hideLabel} className={className}>
      <div className={s.control} data-invalid={error ? "true" : undefined} data-disabled={disabled ? "true" : undefined}>
        <textarea
          ref={ref}
          id={ids.inputId}
          rows={rows ?? 3}
          disabled={disabled}
          {...rest}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          className={cx(s.input, s.textarea)}
        />
      </div>
    </FieldShell>
  );
}
