import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { CollectionDetail, LookupResponse } from "../../../../shared/api";
import { cx } from "../../../lib/cx";
import { dateTime } from "../../../lib/format";
import { Button, Card, ListGroup, ListRow, Money, Notice, Skeleton, StatusPill, TextField, Timeline, type TimelineItem } from "../../../ui";
import { useLookup, useSavedStatuses, type SavedStatus } from "./useLookup";
import styles from "./Status.module.css";

export interface LookupRequest {
  code: string;
  nonce: number;
}

export interface StatusPanelProps {
  collection: CollectionDetail;
  codes: readonly string[];
  active: boolean;
  /** Set by "Ver estado de mi pago" on the success screen. */
  request: LookupRequest | null;
  /** "Registrar de nuevo" after an observation (same collection, open). */
  onRegisterAgain: () => void;
}

/** Formats what people type into "ABC-234" as they type. */
export function formatCodeInput(raw: string): string {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return compact.length > 3 ? `${compact.slice(0, 3)}-${compact.slice(3)}` : compact;
}

const CODE_RE = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;

export function StatusPanel({ collection, codes, active, request, onRegisterAgain }: StatusPanelProps) {
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const { state, lookup } = useLookup();
  const statuses = useSavedStatuses(codes, active);
  const resultRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  const run = (raw: string) => {
    const code = formatCodeInput(raw);
    setInput(code);
    if (!CODE_RE.test(code)) {
      setInputError("El código tiene 6 caracteres, por ejemplo ABC-234.");
      return;
    }
    setInputError(null);
    lookup(code);
  };

  useEffect(() => {
    if (request) run(request.code);
    // Only a new request (nonce) triggers a lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce]);

  useEffect(() => {
    if (state.status === "success") resultRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [state]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(input);
  };

  const error = inputError ?? (state.status === "error" ? state.message : null);

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <h2 id={headingId} className={styles.title}>
          Estado de mi pago
        </h2>
        <p className={styles.sub}>Ingresa el código que recibiste al registrar el pago.</p>
      </div>

      <form className={styles.lookup} onSubmit={onSubmit} noValidate aria-labelledby={headingId}>
        <TextField
          label="Código de seguimiento"
          hideLabel
          mono
          className={styles.lookupField}
          placeholder="ABC-234"
          maxLength={7}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          value={input}
          onChange={(e) => {
            setInput(formatCodeInput(e.target.value));
            setInputError(null);
          }}
          error={error}
        />
        <Button type="submit" loading={state.status === "loading"} className={styles.lookupButton}>
          Consultar
        </Button>
      </form>

      <p className="visually-hidden" role="alert">
        {error ?? ""}
      </p>

      <div ref={resultRef} aria-live="polite">
        {state.status === "success" && (
          <LookupResult data={state.data} collection={collection} onRegisterAgain={onRegisterAgain} />
        )}
      </div>

      {codes.length > 0 && (
        <section className={styles.saved} aria-labelledby={`${headingId}-saved`}>
          <h3 id={`${headingId}-saved`} className={styles.savedTitle}>
            Registrados desde este celular
          </h3>
          <ListGroup inset="text" label="Códigos registrados desde este celular">
            {codes.map((code) => (
              <SavedRow key={code} code={code} status={statuses[code] ?? { status: "loading" }} collection={collection} onOpen={() => run(code)} />
            ))}
          </ListGroup>
        </section>
      )}
    </div>
  );
}

function savedSubtitle(data: LookupResponse, collection: CollectionDetail): string {
  const names = data.students.map((s) => s.name).join(", ");
  if (data.collection && data.collection.slug !== collection.slug) return names ? `${data.collection.title} · ${names}` : data.collection.title;
  return names;
}

function SavedRow({ code, status, collection, onOpen }: { code: string; status: SavedStatus; collection: CollectionDetail; onOpen: () => void }) {
  return (
    <ListRow
      onClick={onOpen}
      title={<span className="mono">{code}</span>}
      subtitle={status.status === "ok" ? savedSubtitle(status.data, collection) : status.status === "error" ? status.message : "Consultando…"}
      trailing={status.status === "ok" ? <StatusPill status={status.data.status} size="sm" /> : status.status === "loading" ? <Skeleton width={84} height={22} radius="pill" /> : undefined}
    />
  );
}

function timelineFor(data: LookupResponse): TimelineItem[] {
  const reviewed = data.status === "recibido" || data.status === "pagado";
  const second: TimelineItem =
    data.status === "observado"
      ? { id: "review", state: "alert", title: "Comprobante con observación", description: data.note ?? undefined }
      : data.status === "anulado"
        ? { id: "review", state: "alert", title: "Registro anulado", description: data.note ?? undefined }
        : reviewed
          ? { id: "review", state: "done", title: "Comprobante recibido", meta: data.reviewedAt ? dateTime(data.reviewedAt) : undefined }
          : { id: "review", state: "current", tone: "warn", title: "Revisando tu comprobante", description: "Normalmente el mismo día" };
  const paid = data.status === "pagado";
  return [
    { id: "registered", state: "done", title: "Pago registrado", meta: dateTime(data.createdAt) },
    second,
    paid
      ? { id: "bank", state: "done", title: "Confirmado en el banco", meta: data.paidAt ? dateTime(data.paidAt) : undefined }
      : { id: "bank", state: "pending", title: "Confirmado en el banco", description: "Pendiente" },
  ];
}

export function LookupResult({ data, collection, onRegisterAgain }: { data: LookupResponse; collection: CollectionDetail; onRegisterAgain: () => void }) {
  const other = data.collection !== null && data.collection.slug !== collection.slug;
  const showOptions = other || collection.options.length > 1;
  const canRetry = data.status === "observado" && !other && collection.status === "abierta";
  return (
    <Card padding="md" gap={16} className={styles.result} aria-label={`Pago ${data.code}`}>
      <div className={styles.resultHead}>
        <div className={styles.resultCode}>
          <span className={styles.caption}>Código</span>
          <strong className={cx("mono", styles.code)}>{data.code}</strong>
        </div>
        <StatusPill status={data.status} size="lg" />
      </div>
      {data.collection && <p className={styles.collection}>{data.collection.title}</p>}
      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt>{data.students.length > 1 ? "Estudiantes" : "Estudiante"}</dt>
          <dd>
            <ul role="list" className={styles.students}>
              {data.students.map((s, i) => (
                <li key={i}>
                  {s.name}
                  {showOptions && s.optionLabel && <span className={styles.option}>{s.optionLabel}</span>}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div className={styles.row}>
          <dt>Monto</dt>
          <dd className="num">
            <Money cents={data.amountCents} />
            {data.amountCents !== data.expectedCents && (
              <span className={styles.option}>
                Esperado <Money cents={data.expectedCents} />
              </span>
            )}
          </dd>
        </div>
      </dl>
      <Timeline items={timelineFor(data)} label="Seguimiento del pago" />
      {data.status === "observado" && (
        <Notice
          tone="bad"
          icon="alert-circle"
          title="Corrige lo indicado y registra el pago de nuevo con el comprobante correcto."
          action={
            canRetry ? (
              <Button size="sm" variant="ink" onClick={onRegisterAgain}>
                Registrar de nuevo
              </Button>
            ) : undefined
          }
        />
      )}
      {other && data.collection?.slug && (
        <Button variant="glass" fullWidth href={`/r/${encodeURIComponent(data.collection.slug)}`} iconEnd="arrow-right">
          Ver esta recaudación
        </Button>
      )}
    </Card>
  );
}
