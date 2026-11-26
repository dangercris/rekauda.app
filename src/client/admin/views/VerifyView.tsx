import { useEffect, useRef, useState } from "react";
import type { AdminCollection, AdminPayment, PaymentStatus } from "../../../shared/api";
import { ToneScope } from "../../design";
import { errorMessage, listPayments, receiptUrl, unlinkMovement } from "../../lib/api";
import { cx } from "../../lib/cx";
import { dateTime, formatBytes, formatMoney, longDate } from "../../lib/format";
import { navigate } from "../../lib/router";
import {
  ActionBar,
  Avatar,
  Button,
  Card,
  CheckItem,
  Chip,
  EmptyState,
  Icon,
  IconTile,
  InfoNote,
  InlineConfirm,
  Money,
  Notice,
  Skeleton,
  StatusPill,
  TextArea,
  TopBar,
  useToast,
} from "../../ui";
import { ErrorState } from "../components/common";
import { movementFacts } from "../components/DeunaBadge";
import { useAdminData } from "../data/AdminData";
import { nextInQueue, studentName, studentNames } from "../data/payments";
import { needsNote } from "../data/usePaymentActions";
import { paymentsBackHash } from "../lastList";
import { useApiErrorGate } from "../session/SessionContext";
import { ACTION_LABEL, DONE_MESSAGE, automaticChecks, reasonPresets, splitActions } from "./review";
import styles from "./VerifyView.module.css";

const NOTE_MAX = 300;

type Lookup = { state: "idle" } | { state: "loading" } | { state: "found"; payment: AdminPayment } | { state: "missing" } | { state: "error"; message: string };

/** AdminVerificar: one payment with its receipt, checks, data and the review actions. */
export function VerifyView({ paymentId }: { paymentId: string }) {
  const { collections, pickable, selected, select, payments } = useAdminData();
  const gate = useApiErrorGate();
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  const [attempt, setAttempt] = useState(0);
  const inList = payments.payments.find((p) => p.id === paymentId) ?? null;
  const listReady = payments.status === "ready" && collections.status === "ready";
  const missingFromList = inList === null;

  // Deep link to a payment of another collection: find it, then switch the scope to its collection.
  useEffect(() => {
    if (!listReady || !missingFromList) return undefined;
    const controller = new AbortController();
    setLookup({ state: "loading" });
    listPayments(null, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        const found = data.payments.find((p) => p.id === paymentId);
        if (!found) {
          setLookup({ state: "missing" });
          return;
        }
        if (found.collectionId && found.collectionId !== selected?.id && pickable.some((c) => c.id === found.collectionId)) {
          select(found.collectionId);
          setLookup({ state: "idle" });
        } else {
          setLookup({ state: "found", payment: found });
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted || gate(caught)) return;
        setLookup({ state: "error", message: errorMessage(caught) });
      });
    return () => controller.abort();
    // Re-run only when the list readiness, the presence in the list or the retry attempt changes.
  }, [listReady, missingFromList, paymentId, attempt]);

  const payment = inList ?? (lookup.state === "found" ? lookup.payment : null);
  const back = paymentsBackHash();
  const top = (code?: string) => (
    <TopBar
      title="Verificar pago"
      backHref={back}
      backLabel="Volver a pagos"
      trailing={code ? <Chip variant="glass" size="sm" className={styles.code}>{code}</Chip> : undefined}
    />
  );

  if (!payment) {
    if (payments.status === "error") {
      return (
        <>
          {top()}
          <ErrorState message={payments.error ?? ""} onRetry={() => void payments.reload()} retrying={payments.refreshing} />
        </>
      );
    }
    if (lookup.state === "error") {
      return (
        <>
          {top()}
          <ErrorState message={lookup.message} onRetry={() => setAttempt((n) => n + 1)} />
        </>
      );
    }
    if (lookup.state === "missing") {
      return (
        <>
          {top()}
          <EmptyState
            icon="search"
            title="No encontramos este pago"
            description="Puede que el enlace esté incompleto o que el registro ya no exista."
            action={
              <Button href={back} variant="glass" size="sm" iconStart="arrow-left">
                Volver a pagos
              </Button>
            }
          />
        </>
      );
    }
    return (
      <>
        {top()}
        <VerifySkeleton />
      </>
    );
  }

  const collection = collections.collections.find((c) => c.id === payment.collectionId) ?? null;
  return (
    <ToneScope tone={collection?.tone ?? selected?.tone ?? null} className={styles.scope}>
      {top(payment.code)}
      <PaymentDetail
        payment={payment}
        collection={collection}
        onRefetch={() => {
          if (!inList) setAttempt((n) => n + 1);
        }}
      />
    </ToneScope>
  );
}

function VerifySkeleton() {
  return (
    <div className={styles.layout} role="status" aria-label="Cargando el pago">
      <div className={styles.column}>
        <Card radius="2xl" padding="lg" gap={14}>
          <div className={styles.identity}>
            <Skeleton width={56} height={56} radius="circle" />
            <span className={styles.identityText}>
              <Skeleton width="70%" height={20} />
              <Skeleton width="50%" height={14} />
            </span>
          </div>
        </Card>
        <Card radius="2xl" padding="md">
          <Skeleton height={320} radius={20} />
        </Card>
      </div>
      <div className={styles.column}>
        <Card radius="2xl" padding="lg" gap={12}>
          <Skeleton lines={4} />
        </Card>
      </div>
    </div>
  );
}

function PaymentDetail({ payment, collection, onRefetch }: { payment: AdminPayment; collection: AdminCollection | null; onRefetch: () => void }) {
  const { payments, actions, refreshAll } = useAdminData();
  const gate = useApiErrorGate();
  const toast = useToast();
  const [unlinking, setUnlinking] = useState(false);
  const [justUnlinked, setJustUnlinked] = useState(false);
  const [confirming, setConfirming] = useState<"observado" | "anulado" | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const busy = actions.pendingId === payment.id;
  const [running, setRunning] = useState<PaymentStatus | null>(null);
  const { primary, secondary } = splitActions(payment.status);
  const checks = automaticChecks(payment, collection);
  const phoneDigits = payment.phone.replace(/\D/g, "");
  const first = payment.students[0];

  const run = async (status: PaymentStatus, reason?: string) => {
    const queue = payment.status;
    const next = nextInQueue(payments.payments, payment.id, queue);
    setRunning(status);
    const result = await actions.setStatus(payment, status, reason);
    setRunning(null);
    if (!result.ok) {
      if (result.message) {
        if (needsNote(status)) setNoteError(result.message);
        toast.show({ message: result.message, tone: "error" });
      }
      return;
    }
    setConfirming(null);
    setNote("");
    setNoteError(null);
    onRefetch();
    if (status === "en_revision") {
      toast.show({ message: DONE_MESSAGE[status], tone: "ok" });
      return;
    }
    if (next) {
      toast.show({ message: `${DONE_MESSAGE[status]} Siguiente pago.`, tone: "ok" });
      navigate(`#pago/${next}`, { replace: true });
    } else {
      toast.show({ message: `${DONE_MESSAGE[status]} No quedan pagos pendientes.`, tone: "ok" });
      navigate(paymentsBackHash(), { replace: true });
    }
  };

  const unlink = async (movementId: string) => {
    setUnlinking(true);
    try {
      await unlinkMovement(movementId);
      toast.show({ message: "Se quitó la confirmación de Deuna. El estado del pago no cambió.", tone: "ok" });
      setJustUnlinked(true);
      await refreshAll();
      onRefetch();
    } catch (caught) {
      if (!gate(caught)) toast.show({ message: errorMessage(caught), tone: "error" });
    } finally {
      setUnlinking(false);
    }
  };

  const ask = (status: "observado" | "anulado") => {
    setConfirming(status);
    setNote(status === "observado" ? (payment.reviewNote ?? "") : "");
    setNoteError(null);
  };

  const confirmNote = () => {
    if (!confirming) return;
    if (!note.trim()) {
      setNoteError("Escribe el motivo para que la familia sepa qué pasó.");
      noteRef.current?.focus();
      return;
    }
    void run(confirming, note);
  };

  const actionButton = (status: PaymentStatus, size: "md" | "sm") => {
    const variant = status === "observado" || status === "anulado" ? "danger-soft" : status === "recibido" || status === "pagado" ? "ok" : "glass";
    const icon = status === "pagado" ? "check" : status === "recibido" ? "mail" : status === "observado" ? "alert-circle" : status === "anulado" ? "x" : "undo";
    return (
      <Button
        key={status}
        variant={size === "sm" && variant === "ok" ? "soft" : variant}
        size={size}
        iconStart={icon}
        loading={busy && running === status}
        disabled={busy}
        onClick={() => {
          if (status === "observado" || status === "anulado") ask(status);
          else void run(status);
        }}
      >
        {ACTION_LABEL[status]}
      </Button>
    );
  };

  return (
    <>
      <div className={styles.layout}>
        <div className={styles.column}>
          <Card as="section" radius="2xl" padding="lg" gap={14} aria-label="Estudiantes y estado">
            <div className={styles.identity}>
              <Avatar name={first ? studentName(first) : payment.parentName} size={56} />
              <div className={styles.identityText}>
                <strong className={styles.name}>{studentNames(payment)}</strong>
                <span className={styles.muted}>Representante: {payment.parentName}</span>
              </div>
            </div>
            <div className={styles.statusRow}>
              <Chip variant="soft" dot className={styles.eventChip}>
                {collection?.title ?? "Sin recaudación"} · <Money cents={payment.amountCents} />
              </Chip>
              <span aria-live="polite">
                <StatusPill status={payment.status} size="lg" />
              </span>
            </div>
            <ul role="list" className={styles.students}>
              {payment.students.map((s, i) => (
                <li key={`${s.givenNames}-${s.surnames}-${i}`} className={styles.student}>
                  <span className={styles.studentName}>{studentName(s)}</span>
                  <span className={styles.studentOption}>{s.optionLabel}</span>
                </li>
              ))}
            </ul>
          </Card>

          <ReceiptPreview payment={payment} />
        </div>

        <div className={styles.column}>
          {payment.bankMovement && (
            <Notice
              tone="ok"
              icon="bank"
              title="Confirmado por Deuna"
              description={movementFacts(payment.bankMovement)}
              action={
                <Button variant="glass" size="sm" iconStart="undo" loading={unlinking} disabled={unlinking} onClick={() => void unlink(payment.bankMovement?.id ?? "")}>
                  Desvincular
                </Button>
              }
            />
          )}

          {!payment.bankMovement && justUnlinked && (
            <InfoNote icon="info">Se quitó la confirmación de Deuna. El estado del pago no cambió: revísalo si hace falta.</InfoNote>
          )}

          <Card as="section" radius="2xl" padding="lg" gap={14} aria-labelledby="checks-title">
            <h2 id="checks-title" className={styles.cardTitle}>
              Validaciones automáticas
            </h2>
            {checks.map((c) => (
              <CheckItem key={c.key} tone={c.tone} title={c.title} detail={c.detail} />
            ))}
          </Card>

          {payment.verification && (
            <Card as="section" radius="2xl" padding="md" gap={10} aria-labelledby="auto-review">
              <div className={styles.noteHead}>
                <IconTile icon="sparkle" size={38} tone="info" />
                <h2 id="auto-review" className={styles.cardTitle}>
                  Revisión automática del comprobante
                </h2>
              </div>
              <p className={styles.noteText}>{payment.verification}</p>
            </Card>
          )}

          {payment.reviewNote && (
            <Card as="section" radius="2xl" padding="md" gap={10} aria-labelledby="family-note">
              <div className={styles.noteHead}>
                <IconTile icon="mail" size={38} tone={payment.status === "observado" || payment.status === "anulado" ? "bad" : "neutral"} />
                <h2 id="family-note" className={styles.cardTitle}>
                  Nota para la familia
                </h2>
              </div>
              <p className={styles.noteText}>{payment.reviewNote}</p>
            </Card>
          )}

          <Card as="section" radius="2xl" padding="none" gap={0} aria-label="Datos del pago">
            <dl className={styles.details}>
              <Row label="Representante" value={payment.parentName} />
              <div className={styles.row}>
                <dt>Celular</dt>
                <dd className={styles.phone}>
                  <span className="num">{payment.phone}</span>
                  <span className={styles.phoneActions}>
                    <Button href={`https://wa.me/${phoneDigits}`} external target="_blank" rel="noopener noreferrer" variant="glass" size="sm" iconStart="whatsapp">
                      WhatsApp
                    </Button>
                    <Button href={`tel:${payment.phone}`} external variant="glass" size="sm" iconStart="phone" aria-label={`Llamar al ${payment.phone}`}>
                      Llamar
                    </Button>
                  </span>
                </dd>
              </div>
              <div className={styles.row}>
                <dt>Monto</dt>
                <dd>
                  <Money cents={payment.amountCents} className={cx(styles.strong, payment.flags.amountMismatch && styles.warnText)} />
                  <span className={styles.muted}> de {formatMoney(payment.expectedCents)} esperados</span>
                </dd>
              </div>
              <Row label="Fecha de transferencia" value={longDate(payment.transferDate, true)} />
              <Row label="Banco" value={payment.bank} />
              <Row label="Nº de comprobante" value={payment.reference ?? "No indicado"} mono={Boolean(payment.reference)} muted={!payment.reference} />
              <Row label="Código" value={payment.code} mono />
              <Row label="Registrado" value={dateTime(payment.createdAt)} />
              {payment.reviewedAt && (
                <Row label="Revisado" value={`${dateTime(payment.reviewedAt)} · ${payment.reviewedBy === "admin" ? "tesorería" : payment.reviewedBy === "deuna" ? "notificación de Deuna" : "revisión automática"}`} />
              )}
              {payment.paidAt && <Row label="Pagado" value={dateTime(payment.paidAt)} />}
            </dl>
          </Card>

          {secondary.length > 0 && !confirming && (
            <section className={styles.more} aria-labelledby="more-actions">
              <h2 id="more-actions" className={styles.moreTitle}>
                Otras acciones
              </h2>
              <div className={styles.moreButtons}>{secondary.map((s) => actionButton(s, "sm"))}</div>
            </section>
          )}

          {confirming && (
            <InlineConfirm
              title={confirming === "observado" ? "¿Qué hay que corregir?" : "¿Por qué anulas este registro?"}
              description="La familia verá este motivo al consultar su código."
              confirmLabel={confirming === "observado" ? "Guardar observación" : "Anular registro"}
              tone="danger"
              loading={busy}
              onConfirm={confirmNote}
              onCancel={() => {
                setConfirming(null);
                setNoteError(null);
              }}
            >
              <div className={styles.reasons} role="group" aria-label="Motivos frecuentes">
                {reasonPresets(confirming, payment).map((r) => (
                  <Chip
                    key={r.label}
                    variant="strong"
                    size="sm"
                    selectedTone="bad"
                    selected={note === r.note}
                    onClick={() => {
                      setNote(r.note);
                      setNoteError(null);
                    }}
                  >
                    {r.label}
                  </Chip>
                ))}
              </div>
              <TextArea
                ref={noteRef}
                label="Motivo para la familia"
                value={note}
                maxLength={NOTE_MAX}
                rows={3}
                onChange={(event) => {
                  setNote(event.target.value);
                  if (noteError) setNoteError(null);
                }}
                error={noteError ?? undefined}
                hint={`${note.length}/${NOTE_MAX}`}
              />
            </InlineConfirm>
          )}

          {(payment.status === "en_revision" || payment.status === "recibido") && !confirming && (
            <InfoNote icon="bank">Marca un pago como pagado solo después de ver la transferencia en la cuenta del banco.</InfoNote>
          )}
        </div>
      </div>

      {!confirming && primary.length > 0 && (
        <ActionBar className={styles.actionBar}>
          {primary.map((s) => (
            <Button
              key={s}
              variant={s === "observado" || s === "anulado" ? "danger-soft" : s === "recibido" || s === "pagado" ? "ok" : "glass"}
              size="lg"
              loading={busy && running === s}
              disabled={busy}
              onClick={() => {
                if (s === "observado" || s === "anulado") ask(s);
                else void run(s);
              }}
              className={s === "observado" ? styles.secondaryAction : styles.primaryAction}
            >
              {ACTION_LABEL[s]}
            </Button>
          ))}
        </ActionBar>
      )}
    </>
  );
}

function Row({ label, value, mono, muted }: { label: string; value: string; mono?: boolean | undefined; muted?: boolean | undefined }) {
  return (
    <div className={styles.row}>
      <dt>{label}</dt>
      <dd className={cx(mono && "mono", muted && styles.muted)}>{value}</dd>
    </div>
  );
}

function ReceiptPreview({ payment }: { payment: AdminPayment }) {
  const url = receiptUrl(payment.id);
  const isImage = payment.receiptType.startsWith("image/");
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <Card as="section" radius="2xl" padding="md" gap={12} aria-labelledby="receipt-title">
      <div className={styles.receiptHead}>
        <h2 id="receipt-title" className={styles.cardTitle}>
          Comprobante
        </h2>
        {isImage ? (
          <Button href={url} external target="_blank" rel="noopener" variant="glass" size="sm" iconStart="expand">
            Ampliar
          </Button>
        ) : (
          <Button href={url} external download variant="glass" size="sm" iconStart="download">
            Descargar
          </Button>
        )}
      </div>
      {isImage && !failed ? (
        <a href={url} target="_blank" rel="noopener" className={styles.receiptFrame} aria-label={`Abrir el comprobante ${payment.code} en una pestaña nueva`}>
          {!loaded && <Skeleton height={320} radius={20} className={styles.receiptSkeleton} />}
          <img
            src={url}
            alt={`Comprobante del pago ${payment.code}`}
            className={cx(styles.receiptImage, !loaded && styles.receiptLoading)}
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        </a>
      ) : (
        <div className={styles.receiptFile}>
          <IconTile icon={isImage ? "image" : "file-text"} size={46} tone="neutral" />
          <span className={styles.fileText}>
            <strong>{isImage ? "No se pudo mostrar la imagen" : "Comprobante en PDF"}</strong>
            <span className={styles.muted}>
              {isImage ? "Ábrela en una pestaña nueva." : `${formatBytes(payment.receiptSize)} · se descarga para abrirlo en tu teléfono`}
            </span>
          </span>
          <Button href={url} external {...(isImage ? { target: "_blank", rel: "noopener" } : { download: true })} variant="ink" size="sm" iconStart={isImage ? "external" : "download"}>
            {isImage ? "Abrir" : "Abrir PDF"}
          </Button>
        </div>
      )}
      <span className={styles.receiptMeta}>
        <Icon name="lock" size={13} /> Solo visible en la tesorería · {formatBytes(payment.receiptSize)}
      </span>
    </Card>
  );
}
