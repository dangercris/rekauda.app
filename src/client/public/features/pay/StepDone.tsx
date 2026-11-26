import type { CollectionDetail } from "../../../../shared/api";
import { cx } from "../../../lib/cx";
import { shareLink } from "../../../lib/share";
import { Button, Card, CopyRow, Icon, InfoNote, KeyValue, Money, StatusPill, Timeline, useToast } from "../../../ui";
import { shortStudentName, studentOptionLabel, type PayResult } from "./payFlow";
import styles from "./Pay.module.css";

export interface StepDoneProps {
  collection: CollectionDetail;
  result: PayResult;
  onViewStatus: (code: string) => void;
  onAnother: () => void;
}

/** Step 3 (ComprobanteEnviado): tracking code, summary, next steps. */
export function StepDone({ collection, result, onViewStatus, onAnother }: StepDoneProps) {
  const toast = useToast();
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const share = async () => {
    const outcome = await shareLink({
      title: collection.title,
      text: `Registré el pago de ${collection.title}. Mi código de seguimiento es ${result.code}.`,
      url: `/r/${encodeURIComponent(collection.slug)}#estado`,
    });
    if (outcome === "copied") toast.show({ message: "Link copiado", tone: "ok" });
    else if (outcome === "failed") toast.show({ message: "No se pudo compartir. Copia el código.", tone: "error" });
  };

  return (
    <>
      <div className={styles.done}>
        <span className={cx("m-glass", styles.doneRing)} aria-hidden="true">
          <span className={styles.doneMark}>
            <Icon name="check" size={32} strokeWidth={2.6} />
          </span>
        </span>
        <h2 className={styles.doneTitle} tabIndex={-1} data-step-title="">
          Pago registrado
        </h2>
        <p className={styles.doneText}>
          La tesorería revisará tu pago de{" "}
          <strong className="num">
            <Money cents={result.amountCents} />
          </strong>{" "}
          para {collection.title}.
        </p>
      </div>

      <Card padding="md" gap={12}>
        <CopyRow
          label="Código de seguimiento"
          value={result.code}
          display={<span className={styles.code}>{result.code}</span>}
          mono
          accent
          size="lg"
          copyLabel="Copiar"
          hint="Guárdalo para consultar el estado de tu pago."
        />
        {canShare && (
          <Button variant="glass" iconStart="share" onClick={() => void share()} fullWidth>
            Compartir código
          </Button>
        )}
      </Card>

      <Card padding="md" className={styles.doneGrid}>
        <KeyValue label="Recaudación" value={collection.title} />
        <KeyValue label="Monto" value={<Money cents={result.amountCents} />} />
        <KeyValue
          className={styles.doneStudents}
          label={result.students.length > 1 ? "Estudiantes" : "Estudiante"}
          value={
            <ul role="list" className={styles.studentList}>
              {result.students.map((student, i) => {
                const option = studentOptionLabel(student, collection.options);
                return (
                  <li key={i}>
                    {shortStudentName(student)}
                    {option && <span className={styles.studentOption}>{option}</span>}
                  </li>
                );
              })}
            </ul>
          }
        />
        <KeyValue label="Estado" value={<StatusPill status="en_revision" size="sm" />} />
      </Card>

      <Card padding="md" gap={0}>
        <Timeline
          label="Qué sigue"
          items={[
            { id: "registered", state: "done", title: "Registraste el pago", description: "Comprobante y datos recibidos", meta: "Ahora" },
            { id: "review", state: "current", tone: "warn", title: "Revisamos tu comprobante", description: "Normalmente el mismo día" },
            { id: "bank", state: "pending", title: "Se confirma en el banco", description: "Tu estado cambia a Pagado" },
          ]}
        />
      </Card>

      <InfoNote icon="phone">Si hay algo que corregir, te escribiremos al celular que registraste.</InfoNote>

      <div className={styles.doneActions}>
        <Button size="lg" fullWidth iconStart="search" onClick={() => onViewStatus(result.code)}>
          Ver estado de mi pago
        </Button>
        <Button variant="glass" size="lg" fullWidth iconStart="plus" onClick={onAnother}>
          Registrar otro pago
        </Button>
      </div>
    </>
  );
}
