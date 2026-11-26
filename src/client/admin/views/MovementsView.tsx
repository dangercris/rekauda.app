import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdminBankMovement, AdminPayment } from "../../../shared/api";
import { errorMessage, ignoreMovement, importDeunaEml, linkMovement, listPayments } from "../../lib/api";
import { compactDate, dateTime, plural } from "../../lib/format";
import { Button, Card, EmptyState, InfoNote, Money, PageHeader, SectionHeader, SelectField, useToast, type SelectOption } from "../../ui";
import { EYEBROW, ErrorState, HeaderActions, ListSkeleton } from "../components/common";
import { useAdminData } from "../data/AdminData";
import { describeImport, type ImportOutcome } from "../data/importMessages";
import { candidateLabel, candidatePayments } from "../data/movements";
import { useApiErrorGate } from "../session/SessionContext";
import styles from "./MovementsView.module.css";
import { useLogout } from "./useLogout";

type PaymentsState = { status: "loading" } | { status: "ready"; payments: AdminPayment[] } | { status: "error"; message: string };

/** AdminMovimientos: Deuna transfers that did not match a payment on their own. Link each one or ignore it. */
export function MovementsView() {
  const { movements, refreshAll } = useAdminData();
  const gate = useApiErrorGate();
  const onLogout = useLogout();
  const [all, setAll] = useState<PaymentsState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  // Candidates come from every collection: a transfer can belong to any open recaudación.
  useEffect(() => {
    const controller = new AbortController();
    setAll((current) => (current.status === "ready" ? current : { status: "loading" }));
    listPayments(null, { signal: controller.signal })
      .then((data) => setAll({ status: "ready", payments: data.payments }))
      .catch((caught: unknown) => {
        if (controller.signal.aborted || gate(caught)) return;
        setAll({ status: "error", message: errorMessage(caught) });
      });
    return () => controller.abort();
  }, [attempt, gate]);

  const refresh = useCallback(async () => {
    setAttempt((n) => n + 1);
    await refreshAll();
  }, [refreshAll]);

  const header = (
    <PageHeader
      eyebrow={EYEBROW}
      title="Movimientos"
      subtitle="Transferencias que llegaron a Deuna y aún no coinciden con un pago."
      actions={<HeaderActions onRefresh={() => void refresh()} refreshing={movements.refreshing} onLogout={onLogout} />}
    />
  );

  const importer = <ImportEml onImported={refresh} />;

  if (movements.status === "loading") {
    return (
      <>
        {header}
        {importer}
        <ListSkeleton rows={3} label="Cargando movimientos" />
      </>
    );
  }
  if (movements.status === "error") {
    return (
      <>
        {header}
        {importer}
        <ErrorState title="No pudimos cargar los movimientos" message={movements.error ?? ""} onRetry={() => void movements.reload()} retrying={movements.refreshing} />
      </>
    );
  }

  return (
    <>
      {header}
      {importer}
      {movements.movements.length === 0 ? (
        <EmptyState
          icon="bank"
          title="No hay movimientos por vincular"
          description="Cada transferencia que Deuna avisa por correo se une sola a su pago cuando coincide el monto, la fecha y el nombre."
        />
      ) : (
        <section className={styles.section} aria-labelledby="sin-vincular">
          <SectionHeader id="sin-vincular" title={plural(movements.movements.length, "movimiento sin vincular", "movimientos sin vincular")} />
          <InfoNote icon="bank">Vincular un pago lo pasa a recibido. Solo tú lo marcas como pagado.</InfoNote>
          <div className={styles.list}>
            {movements.movements.map((m) => (
              <MovementCard key={m.id} movement={m} payments={all} onRetryPayments={() => setAttempt((n) => n + 1)} onChanged={refresh} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

interface CardProps {
  movement: AdminBankMovement;
  payments: PaymentsState;
  onRetryPayments: () => void;
  onChanged: () => Promise<void>;
}

function MovementCard({ movement, payments, onRetryPayments, onChanged }: CardProps) {
  const gate = useApiErrorGate();
  const toast = useToast();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState<"link" | "ignore" | null>(null);
  const ranked = useMemo(() => (payments.status === "ready" ? candidatePayments(movement, payments.payments) : []), [movement, payments]);
  const options = useMemo<SelectOption[]>(
    () => ranked.map((r) => ({ value: r.payment.id, label: candidateLabel(r, compactDate) })),
    [ranked],
  );

  const run = async (kind: "link" | "ignore") => {
    setBusy(kind);
    try {
      if (kind === "link") await linkMovement(movement.id, selected);
      else await ignoreMovement(movement.id);
      toast.show({ message: kind === "link" ? "Movimiento vinculado. El pago quedó como recibido." : "Movimiento ignorado.", tone: "ok" });
      await onChanged();
    } catch (caught) {
      if (gate(caught)) return;
      toast.show({ message: errorMessage(caught), tone: "error" });
      await onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card as="article" radius="2xl" padding="lg" gap={14} aria-label={`Movimiento ${movement.transactionNumber}`}>
      <div className={styles.head}>
        <span className={styles.who}>
          <strong className={styles.name}>{movement.payerName ?? "Ordenante sin nombre"}</strong>
          <span className={styles.meta}>
            {[movement.originBank, movement.originAccount].filter(Boolean).join(" ") || "Origen no indicado"}
          </span>
        </span>
        <Money cents={movement.amountCents} />
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>Recibido</dt>
          <dd>{dateTime(movement.receivedAt)}</dd>
        </div>
        <div>
          <dt>Motivo</dt>
          <dd>{movement.motive ?? "Sin motivo"}</dd>
        </div>
        <div>
          <dt>Transacción</dt>
          <dd className="mono">{movement.transactionNumber}</dd>
        </div>
      </dl>

      {payments.status === "loading" && <p className={styles.muted}>Buscando pagos con este monto…</p>}
      {payments.status === "error" && (
        <div role="alert" className={styles.inlineError}>
          <span>{payments.message}</span>
          <Button variant="glass" size="sm" iconStart="refresh" onClick={onRetryPayments}>
            Reintentar
          </Button>
        </div>
      )}
      {payments.status === "ready" &&
        (options.length === 0 ? (
          <p className={styles.muted}>No hay pagos por vincular con este monto. Si la familia aún no registró su comprobante, vuelve más tarde.</p>
        ) : (
          <SelectField
            label="Vincular con el pago"
            placeholder="Elige el pago (el más probable va primero)"
            options={options}
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            disabled={busy !== null}
          />
        ))}

      <div className={styles.actions}>
        <Button iconStart="check" variant="ok" disabled={!selected || busy !== null} loading={busy === "link"} onClick={() => void run("link")}>
          Vincular
        </Button>
        <Button variant="glass" iconStart="x" disabled={busy !== null} loading={busy === "ignore"} onClick={() => void run("ignore")}>
          Ignorar
        </Button>
      </div>
    </Card>
  );
}

/** Imports a raw Deuna notification (.eml) for mails that were missed. It must still pass DKIM on the server. */
function ImportEml({ onImported }: { onImported: () => Promise<void> }) {
  const gate = useApiErrorGate();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setOutcome(null);
    try {
      const result = describeImport(await importDeunaEml(file));
      setOutcome(result);
      if (result.changed) await onImported();
    } catch (caught) {
      if (!gate(caught)) setOutcome({ tone: "bad", message: errorMessage(caught), changed: false });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <Card as="section" radius="2xl" padding="lg" gap={12} aria-labelledby="importar-eml">
      <h2 id="importar-eml" className={styles.importTitle}>
        Importar correo de Deuna (.eml)
      </h2>
      <p className={styles.muted}>En Gmail: abre el correo, menú ⋮, Descargar mensaje.</p>
      <input
        ref={input}
        type="file"
        accept=".eml,message/rfc822"
        aria-label="Archivo .eml del correo de Deuna"
        className="visually-hidden"
        tabIndex={-1}
        onChange={(event) => void pick(event.target.files?.[0])}
      />
      <div className={styles.actions}>
        <Button variant="glass" iconStart="upload" loading={busy} disabled={busy} onClick={() => input.current?.click()}>
          Elegir archivo .eml
        </Button>
      </div>
      {outcome && (
        <div role="status" className={outcome.tone === "bad" ? styles.importBad : outcome.tone === "ok" ? styles.importOk : styles.importInfo}>
          {outcome.message}
        </div>
      )}
    </Card>
  );
}
