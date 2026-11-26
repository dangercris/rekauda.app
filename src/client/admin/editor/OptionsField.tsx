import type { Dispatch } from "react";
import { Button, IconButton, TextField } from "../../ui";
import { MAX_OPTIONS, type EditorAction, type FieldErrors, type OptionDraft } from "./editorState";
import styles from "./EventEditor.module.css";

export function optionFieldId(uid: string, field: "label" | "detail" | "price" | "key"): string {
  return `ev-opt-${uid}-${field}`;
}

export interface OptionsFieldProps {
  options: readonly OptionDraft[];
  errors: FieldErrors;
  dispatch: Dispatch<EditorAction>;
  disabled?: boolean | undefined;
}

/** Repeatable option rows: name, price (accepts "14,00"), optional detail and the immutable code. */
export function OptionsField({ options, errors, dispatch, disabled }: OptionsFieldProps) {
  const atMax = options.length >= MAX_OPTIONS;
  return (
    <div className={styles.options}>
      {options.map((o, index) => {
        const n = index + 1;
        return (
          <fieldset key={o.uid} className={styles.option}>
            <legend className={styles.optionLegend}>
              <span>Opción {n}</span>
              {options.length > 1 && (
                <IconButton
                  icon="trash"
                  size={36}
                  variant="ghost"
                  label={`Quitar la opción ${n}${o.label.trim() ? `, ${o.label.trim()}` : ""}`}
                  disabled={disabled}
                  onClick={() => dispatch({ type: "removeOption", uid: o.uid })}
                />
              )}
            </legend>
            <div className={styles.optionGrid}>
              <TextField
                id={optionFieldId(o.uid, "label")}
                label="Nombre"
                placeholder="Vestuario de mujer"
                value={o.label}
                maxLength={60}
                autoComplete="off"
                disabled={disabled}
                onChange={(e) => dispatch({ type: "option", uid: o.uid, field: "label", value: e.target.value })}
                error={errors[`option:${o.uid}:label`]}
                className={styles.optionName}
              />
              <TextField
                id={optionFieldId(o.uid, "price")}
                label="Precio"
                prefix="$"
                inputMode="decimal"
                placeholder="14,00"
                value={o.price}
                autoComplete="off"
                disabled={disabled}
                onChange={(e) => dispatch({ type: "option", uid: o.uid, field: "price", value: e.target.value })}
                error={errors[`option:${o.uid}:price`]}
                className={styles.optionPrice}
              />
              <TextField
                id={optionFieldId(o.uid, "detail")}
                label="Detalle"
                optional
                placeholder="Incluye accesorios"
                value={o.detail}
                maxLength={60}
                autoComplete="off"
                disabled={disabled}
                onChange={(e) => dispatch({ type: "option", uid: o.uid, field: "detail", value: e.target.value })}
                error={errors[`option:${o.uid}:detail`]}
                className={styles.optionDetail}
              />
              <TextField
                id={optionFieldId(o.uid, "key")}
                label="Código"
                mono
                value={o.key}
                maxLength={24}
                readOnly={o.locked}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                disabled={disabled}
                onChange={(e) => dispatch({ type: "option", uid: o.uid, field: "key", value: e.target.value })}
                error={errors[`option:${o.uid}:key`]}
                hint={o.locked ? "No se puede cambiar: identifica a estudiantes registrados." : "Se genera del nombre. Minúsculas, números y guiones."}
                className={styles.optionKey}
              />
            </div>
          </fieldset>
        );
      })}
      <Button variant="glass" iconStart="plus" disabled={atMax || disabled} onClick={() => dispatch({ type: "addOption" })} id="ev-add-option">
        {atMax ? `Máximo ${MAX_OPTIONS} opciones` : "Agregar opción"}
      </Button>
    </div>
  );
}
