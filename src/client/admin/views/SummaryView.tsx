import { useState } from "react";
import type { AdminCollection } from "../../../shared/api";
import { cx } from "../../lib/cx";
import { daysUntil, formatInt, formatMoney, longDate, relative } from "../../lib/format";
import { shareLink } from "../../lib/share";
import {
  Button,
  Card,
  EmptyState,
  IconTile,
  ListGroup,
  ListRow,
  Money,
  Notice,
  PageHeader,
  ProgressBar,
  SectionHeader,
  SegmentedBar,
  Skeleton,
  StatTile,
  useToast,
  type IconName,
  type Tone,
} from "../../ui";
import { CollectionCard } from "../components/CollectionCard";
import { CollectionSwitcher } from "../components/CollectionSwitcher";
import { ErrorState, HeaderActions, ListSkeleton, useEyebrow } from "../components/common";
import { PaymentRow } from "../components/PaymentRow";
import { useAdminData } from "../data/AdminData";
import { centsWithStatus, countByStatus, recentActivity, type ActivityKind } from "../data/payments";
import styles from "./SummaryView.module.css";
import { useLogout } from "./useLogout";

const capitalize = (text: string): string => text.charAt(0).toLocaleUpperCase("es") + text.slice(1);

const ACTIVITY: Record<ActivityKind, { title: string; icon: IconName; tone: Tone }> = {
  created: { title: "Nuevo comprobante", icon: "upload", tone: "neutral" },
  en_revision: { title: "Volvió a revisión", icon: "clock", tone: "warn" },
  recibido: { title: "Comprobante recibido", icon: "mail", tone: "info" },
  observado: { title: "Pago con observación", icon: "alert-circle", tone: "bad" },
  pagado: { title: "Pago confirmado", icon: "check", tone: "ok" },
  anulado: { title: "Registro anulado", icon: "x", tone: "neutral" },
};

/** AdminResumen: money collected for the selected collection, status counts, review queue, collections, activity. */
export function SummaryView() {
  const eyebrow = useEyebrow();
  const { collections, pickable, selected, select, payments, refreshAll } = useAdminData();
  const onLogout = useLogout();
  const refreshing = collections.refreshing || payments.refreshing;

  const header = (
    <PageHeader
      eyebrow={eyebrow}
      title="Resumen"
      subtitle={capitalize(longDate(new Date()))}
      actions={<HeaderActions onRefresh={() => void refreshAll()} refreshing={refreshing} onLogout={onLogout} />}
    />
  );

  if (collections.status === "loading") {
    return (
      <>
        {header}
        <Card radius="3xl" padding="lg" gap={12} aria-hidden="true">
          <Skeleton width="40%" height={13} />
          <Skeleton width="55%" height={46} />
          <Skeleton height={12} radius="pill" />
        </Card>
        <ListSkeleton rows={3} label="Cargando el resumen" />
      </>
    );
  }
  if (collections.status === "error") {
    return (
      <>
        {header}
        <ErrorState message={collections.error ?? ""} onRetry={() => void collections.reload()} retrying={collections.refreshing} />
      </>
    );
  }
  if (!selected) {
    return (
      <>
        {header}
        <EmptyState
          icon="calendar"
          title="Aún no hay recaudaciones activas"
          description="Crea la primera: título, opciones con precio y fecha límite. Las familias la verán en su enlace."
          action={
            <Button href="#evento/nuevo" iconStart="plus">
              Crear recaudación
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <CollectionSwitcher collections={pickable} selectedId={selected.id} onSelect={select} />
      <TotalsCard collection={selected} />
      <StatusTiles collection={selected} />
      <DeadlineNotice collection={selected} />
      <ReviewQueue />
      <section className={styles.section} aria-labelledby="eventos-activos">
        <SectionHeader id="eventos-activos" title="Eventos activos" action={{ label: "Nuevo", href: "#evento/nuevo", icon: "plus" }} />
        <div className={styles.cards}>
          {pickable.map((c) => (
            <CollectionCard key={c.id} collection={c} href={`#evento/${c.id}`} />
          ))}
        </div>
      </section>
      <Activity />
    </>
  );
}

function TotalsCard({ collection: c }: { collection: AdminCollection }) {
  const s = c.stats;
  const value = s.expectedCents > 0 ? s.paidCents / s.expectedCents : 0;
  return (
    <Card as="section" radius="3xl" padding="lg" gap={14} aria-label={`Recaudado en ${c.title}`}>
      <div className={styles.totals}>
        <span className={styles.caption}>Recaudado y confirmado</span>
        <Money cents={s.paidCents} variant="display" />
        <span className={cx(styles.caption, "num")}>
          de {formatMoney(s.expectedCents)} esperados · {formatInt(s.students)} {s.students === 1 ? "estudiante registrado" : "estudiantes registrados"}
        </span>
      </div>
      <ProgressBar value={value} size="lg" label="Recaudado del total esperado" valueText={`${formatMoney(s.paidCents)} de ${formatMoney(s.expectedCents)}`} />
      <SegmentedBar
        size="md"
        total={s.students}
        legend
        label={`Estudiantes por estado: pagado ${s.pagado}, recibido ${s.recibido}, en revisión ${s.enRevision}, con observación ${s.observado}`}
        segments={[
          { key: "pagado", value: s.pagado, color: "ok", label: "Pagado" },
          { key: "recibido", value: s.recibido, color: "info", label: "Recibido" },
          { key: "en_revision", value: s.enRevision, color: "warn", label: "En revisión" },
          { key: "observado", value: s.observado, color: "bad", label: "Con observación" },
        ]}
      />
    </Card>
  );
}

function StatusTiles({ collection: c }: { collection: AdminCollection }) {
  const { payments } = useAdminData();
  const ready = payments.status === "ready";
  const counts = countByStatus(payments.payments);
  const s = c.stats;
  const pct = s.students > 0 ? Math.round((s.pagado / s.students) * 100) : 0;
  const pending = (n: number) => (ready ? formatInt(n) : <Skeleton width={36} height={30} />);
  return (
    <div className={styles.tiles}>
      <StatTile
        label="Por verificar"
        value={pending(counts.en_revision)}
        icon="clock"
        tone="warn"
        meta={ready ? `${formatMoney(centsWithStatus(payments.payments, "en_revision"))} en revisión` : " "}
        metaToned
        href="#pagos"
      />
      <StatTile label="Estudiantes al día" value={`${pct}%`} icon="check" tone="ok" meta={`${formatInt(s.pagado)} de ${formatInt(s.students)} pagados`} />
      <StatTile label="Por confirmar en el banco" value={pending(counts.recibido)} icon="mail" tone="info" meta="Comprobante recibido" href="#pagos/recibido" />
      <StatTile label="Con observación" value={pending(counts.observado)} icon="alert-circle" tone="bad" meta="Esperan corrección" href="#pagos/observado" />
    </div>
  );
}

function DeadlineNotice({ collection: c }: { collection: AdminCollection }) {
  const toast = useToast();
  const { collections } = useAdminData();
  const [closing, setClosing] = useState(false);
  if (c.status !== "abierta") return null;
  const days = daysUntil(c.deadline);
  if (Number.isNaN(days) || days > 10) return null;

  if (days < 0) {
    const close = async () => {
      setClosing(true);
      const res = await collections.setStatus(c.id, "cerrada");
      setClosing(false);
      if (res.ok) toast.show({ message: "Recaudación cerrada. Ya no recibe pagos.", tone: "ok" });
      else if (res.message) toast.show({ message: res.message, tone: "error" });
    };
    return (
      <Notice
        tone="bad"
        icon="alert-circle"
        title={`El plazo venció el ${longDate(c.deadline)}`}
        description="La recaudación sigue abierta. Ciérrala cuando termines de revisar los pagos."
        action={
          <Button variant="ink" size="sm" onClick={() => void close()} loading={closing}>
            Cerrar
          </Button>
        }
      />
    );
  }

  const share = async () => {
    const result = await shareLink({
      url: `/r/${c.slug}`,
      title: c.title,
      text: `${c.title}: el plazo para pagar vence el ${longDate(c.deadline)}.`,
    });
    if (result === "copied") toast.show({ message: "Enlace copiado. Pégalo en el grupo del curso.", tone: "ok" });
    else if (result === "failed") toast.show({ message: "No se pudo copiar el enlace.", tone: "error" });
  };
  const missing = Math.max(0, c.stats.students - c.stats.pagado);
  return (
    <Notice
      tone="event"
      icon="bell"
      title={days === 0 ? `${c.title} vence hoy` : `${c.title} vence en ${days === 1 ? "1 día" : `${days} días`}`}
      description={
        c.stats.students === 0
          ? "Todavía no hay estudiantes registrados."
          : `${formatInt(missing)} de ${formatInt(c.stats.students)} estudiantes registrados aún no tienen el pago confirmado.`
      }
      action={
        <Button variant="ink" size="sm" iconStart="share" onClick={() => void share()}>
          Recordar
        </Button>
      }
    />
  );
}

function ReviewQueue() {
  const { payments } = useAdminData();
  const review = payments.payments.filter((p) => p.status === "en_revision");
  const received = payments.payments.filter((p) => p.status === "recibido");

  if (payments.status === "loading") {
    return (
      <section className={styles.section} aria-label="Por verificar">
        <SectionHeader title="Por verificar" />
        <ListSkeleton rows={3} label="Cargando pagos" />
      </section>
    );
  }
  if (payments.status === "error") {
    return (
      <section className={styles.section} aria-label="Por verificar">
        <SectionHeader title="Por verificar" />
        <ErrorState title="No pudimos cargar los pagos" message={payments.error ?? ""} onRetry={() => void payments.reload()} retrying={payments.refreshing} />
      </section>
    );
  }
  return (
    <>
      <section className={styles.section} aria-labelledby="por-verificar">
        <SectionHeader
          id="por-verificar"
          title="Por verificar"
          action={review.length > 0 ? { label: review.length > 4 ? `Ver los ${review.length}` : "Ver todos", href: "#pagos" } : undefined}
        />
        {review.length === 0 ? (
          <EmptyState icon="check" title="Todo al día" description="No hay comprobantes esperando revisión." />
        ) : (
          <ListGroup label="Pagos por verificar">
            {review.slice(0, 4).map((p) => (
              <PaymentRow key={p.id} payment={p} when="relative" hideStatus />
            ))}
          </ListGroup>
        )}
      </section>
      {received.length > 0 && (
        <section className={styles.section} aria-labelledby="por-confirmar">
          <SectionHeader
            id="por-confirmar"
            title="Por confirmar en el banco"
            action={{ label: received.length > 3 ? `Ver los ${received.length}` : "Ver todos", href: "#pagos/recibido" }}
          />
          <ListGroup label="Pagos por confirmar en el banco">
            {received.slice(0, 3).map((p) => (
              <PaymentRow key={p.id} payment={p} when="relative" hideStatus />
            ))}
          </ListGroup>
        </section>
      )}
    </>
  );
}

function Activity() {
  const { payments } = useAdminData();
  if (payments.status !== "ready") return null;
  const items = recentActivity(payments.payments, 6);
  if (items.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby="actividad">
      <SectionHeader id="actividad" title="Actividad reciente" />
      <ListGroup label="Actividad reciente">
        {items.map((item) => {
          const meta = ACTIVITY[item.kind];
          const who = item.actor === "auto" ? "Revisión automática" : item.actor === "admin" ? "Tesorería" : null;
          return (
            <ListRow
              key={item.id}
              href={`#pago/${item.paymentId}`}
              leading={<IconTile icon={meta.icon} size={38} tone={meta.tone} shape="circle" />}
              title={`${meta.title} · ${item.name}`}
              subtitle={[who, item.note].filter(Boolean).join(" · ") || undefined}
              trailingMeta={relative(item.at)}
              chevron={false}
            />
          );
        })}
      </ListGroup>
    </section>
  );
}

