import { useId, type ReactNode } from "react";
import { normalizeHex } from "../design/tone";
import { cx } from "../lib/cx";
import { Icon } from "./Icon";
import styles from "./SwatchPicker.module.css";

export interface Swatch {
  /** `#RRGGBB` */
  value: string;
  name: string;
  /** Small caption under the name (e.g. "principal"). */
  role?: string | undefined;
}

export interface SwatchPickerProps {
  legend: ReactNode;
  hideLegend?: boolean | undefined;
  swatches: readonly Swatch[];
  /** Current tone (`#RRGGBB`). */
  value: string;
  onChange: (hex: string) => void;
  /** Adds "Usar un color propio" with a native color input. Default true. */
  allowCustom?: boolean | undefined;
  customLabel?: string | undefined;
  className?: string | undefined;
}

/** Event tone picker (AdminEvento): big swatches with a check, plus a native custom color input. */
export function SwatchPicker({ legend, hideLegend, swatches, value, onChange, allowCustom = true, customLabel = "Usar un color propio", className }: SwatchPickerProps) {
  const id = useId();
  const current = normalizeHex(value);
  const isCustom = current !== null && !swatches.some((s) => normalizeHex(s.value) === current);
  return (
    <fieldset className={cx(styles.fieldset, className)}>
      <legend className={cx(styles.legend, hideLegend && "visually-hidden")}>{legend}</legend>
      <div className={styles.grid}>
        {swatches.map((swatch) => {
          const hex = normalizeHex(swatch.value) ?? swatch.value;
          const checked = hex === current;
          return (
            <label key={hex} className={cx(styles.option, checked && styles.checked)}>
              <input type="radio" className="visually-hidden" name={`sw${id}`} value={hex} checked={checked} onChange={() => onChange(hex)} />
              <span className={styles.swatch} style={{ backgroundColor: hex, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 22px -14px ${hex}` }}>
                {checked && (
                  <span className={styles.check}>
                    <Icon name="check" size={16} strokeWidth={3} />
                  </span>
                )}
              </span>
              <span className={styles.caption}>
                <strong className={styles.name}>{swatch.name}</strong>
                <span className={cx(styles.hex, "mono")}>
                  {hex}
                  {swatch.role ? ` · ${swatch.role}` : ""}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {allowCustom && (
        <label className={styles.custom}>
          <span className={cx(styles.wheel, isCustom && styles.wheelActive)} aria-hidden="true" style={isCustom && current ? { background: current } : undefined} />
          <span className={styles.customText}>
            {customLabel}
            {isCustom && current && <span className={cx(styles.hex, "mono")}> {current}</span>}
          </span>
          <span className={styles.customButton}>Elegir</span>
          <input
            type="color"
            className={styles.colorInput}
            value={current ?? "#3D4FA3"}
            onChange={(event) => {
              const hex = normalizeHex(event.target.value);
              if (hex) onChange(hex);
            }}
          />
        </label>
      )}
    </fieldset>
  );
}
