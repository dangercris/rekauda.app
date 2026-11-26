import type { CollectionOption } from "../../../../shared/api";
import { Button, RadioCards, TextField } from "../../../ui";
import type { FieldKey, StudentField } from "../../lib/validation";
import type { StudentDraft } from "./payFlow";
import styles from "./Pay.module.css";

export interface StudentBlockProps {
  student: StudentDraft;
  index: number;
  total: number;
  options: readonly CollectionOption[];
  errors: Partial<Record<FieldKey, string>>;
  onChange: (field: StudentField, value: string) => void;
  onRemove: () => void;
}

/** One student: given names, surnames and the option (hidden and preselected with a single option). */
export function StudentBlock({ student, index, total, options, errors, onChange, onRemove }: StudentBlockProps) {
  const title = total > 1 ? `Estudiante ${index + 1}` : "Estudiante";
  const key = (field: StudentField): FieldKey => `students.${index}.${field}`;
  const id = (field: StudentField) => `pay-student-${student.id}-${field}`;
  const titleId = `pay-student-${student.id}-title`;
  return (
    <div className={styles.student} role="group" aria-labelledby={titleId}>
      <div className={styles.studentHead}>
        <h3 id={titleId} className={styles.studentTitle}>
          {title}
        </h3>
        {total > 1 && (
          <Button variant="ghost" size="sm" iconStart="x" onClick={onRemove} aria-label={`Quitar ${title.toLowerCase()}`}>
            Quitar
          </Button>
        )}
      </div>
      <div className={styles.grid2}>
        <div data-field={key("givenNames")}>
          <TextField
            id={id("givenNames")}
            label="Nombres"
            maxLength={60}
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            value={student.givenNames}
            onChange={(e) => onChange("givenNames", e.target.value)}
            error={errors[key("givenNames")]}
          />
        </div>
        <div data-field={key("surnames")}>
          <TextField
            id={id("surnames")}
            label="Apellidos"
            maxLength={60}
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            value={student.surnames}
            onChange={(e) => onChange("surnames", e.target.value)}
            error={errors[key("surnames")]}
          />
        </div>
      </div>
      {options.length > 1 && (
        <div data-field={key("option")}>
          <RadioCards
            legend="Opción"
            name={`pay-student-${student.id}-option`}
            options={options.map((o) => ({ value: o.key, label: o.label, detail: o.detail ?? undefined, cents: o.cents }))}
            value={student.option}
            onChange={(value) => onChange("option", value)}
            error={errors[key("option")]}
          />
        </div>
      )}
    </div>
  );
}
