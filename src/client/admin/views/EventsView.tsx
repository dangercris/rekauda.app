import { useState } from "react";
import type { AdminCollection, CollectionStatus } from "../../../shared/api";
import { copyText } from "../../lib/clipboard";
import { longDate } from "../../lib/format";
import { navigate } from "../../lib/router";
import { Button, EmptyState, InlineConfirm, PageHeader, SectionHeader, useToast } from "../../ui";
import { CollectionCard } from "../components/CollectionCard";
import { EYEBROW, ErrorState, HeaderActions, ListSkeleton } from "../components/common";
import { useAdminData } from "../data/AdminData";
import styles from "./EventsView.module.css";
import { useLogout } from "./useLogout";

export function publicLink(slug: string): string {
  return `${window.location.origin}/r/${slug}`;
}

/** Collections management: every collection with its stats and actions. */
export function EventsView() {
  const { collections } = useAdminData();
  const onLogout = useLogout();
  const [showArchived, setShowArchived] = useState(false);
  const active = collections.collections.filter((c) => c.status !== "archivada");
  const archived = collections.collections.filter((c) => c.status === "archivada");

  const header = (
    <PageHeader
      eyebrow={EYEBROW}
      title="Eventos"
      subtitle="Cada recaudación tiene su enlace, opciones y fecha límite."
      actions={<HeaderActions onRefresh={() => void collections.reload({ silent: true })} refreshing={collections.refreshing} onLogout={onLogout} />}
    />
  );

  return (
    <>
      {header}
      <Button href="#evento/nuevo" iconStart="plus" fullWidth className={styles.create}>
        Nueva recaudación
      </Button>
      {collections.status === "loading" ? (
        <ListSkeleton rows={3} label="Cargando recaudaciones" />
      ) : collections.status === "error" ? (
        <ErrorState message={collections.error ?? ""} onRetry={() => void collections.reload()} retrying={collections.refreshing} />
      ) : collections.collections.length === 0 ? (
        <EmptyState icon="calendar" title="Aún no hay recaudaciones" description="Crea la primera: título, opciones con precio y fecha límite." />
      ) : (
        <>
          <section className={styles.section} aria-labelledby="activas">
            <SectionHeader id="activas" title={active.length > 0 ? "Activas" : "No hay recaudaciones activas"} />
            <div className={styles.list}>
              {active.map((c) => (
                <CollectionItem key={c.id} collection={c} />
              ))}
            </div>
          </section>
          {archived.length > 0 && (
            <section className={styles.section} aria-labelledby="archivadas">
              <div className={styles.archivedHead}>
                <SectionHeader id="archivadas" title={`Archivadas (${archived.length})`} />
                <Button variant="ghost" size="sm" iconEnd={showArchived ? "chevron-up" : "chevron-down"} aria-expanded={showArchived} aria-controls="archived-list" onClick={() => setShowArchived((v) => !v)}>
                  {showArchived ? "Ocultar" : "Mostrar"}
                </Button>
              </div>
              {showArchived && (
                <div id="archived-list" className={styles.list}>
                  {archived.map((c) => (
                    <CollectionItem key={c.id} collection={c} />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}

const DONE: Record<CollectionStatus, string> = {
  abierta: "Recaudación abierta: vuelve a recibir pagos.",
  cerrada: "Recaudación cerrada: ya no recibe pagos.",
  archivada: "Recaudación archivada: se ocultó del público.",
};

function CollectionItem({ collection: c }: { collection: AdminCollection }) {
  const { collections, select } = useAdminData();
  const toast = useToast();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [pending, setPending] = useState<CollectionStatus | null>(null);

  const change = async (status: CollectionStatus) => {
    setPending(status);
    const res = await collections.setStatus(c.id, status);
    setPending(null);
    setConfirmArchive(false);
    if (res.ok) toast.show({ message: status === "cerrada" && c.status === "archivada" ? "Recaudación restaurada como cerrada." : DONE[status], tone: "ok" });
    else if (res.message) toast.show({ message: res.message, tone: "error" });
  };

  const copy = async () => {
    const ok = await copyText(publicLink(c.slug));
    toast.show(ok ? { message: "Enlace copiado. Pégalo en el grupo del curso.", tone: "ok" } : { message: `No se pudo copiar. El enlace es ${publicLink(c.slug)}`, tone: "error" });
  };

  const options = c.options.map((o) => o.label).join(" · ");
  return (
    <CollectionCard collection={c} showStatus>
      <div className={styles.meta}>
        <span>
          Hasta el <strong>{longDate(c.deadline, true)}</strong>
        </span>
        <span className={styles.options}>{options}</span>
      </div>
      {confirmArchive ? (
        <InlineConfirm
          title={`¿Archivar ${c.title}?`}
          description="Se oculta del público y ya no recibe pagos. Podrás restaurarla."
          confirmLabel="Sí, archivar"
          onConfirm={() => void change("archivada")}
          onCancel={() => setConfirmArchive(false)}
          loading={pending === "archivada"}
          className={styles.confirm}
        />
      ) : (
        <div className={styles.actions}>
          {c.status !== "archivada" && (
            <Button
              variant="ink"
              size="sm"
              iconStart="receipt"
              onClick={() => {
                select(c.id);
                navigate("#pagos");
              }}
            >
              Ver pagos
            </Button>
          )}
          <Button href={`#evento/${c.id}`} variant="glass" size="sm" iconStart="edit">
            Editar
          </Button>
          {c.status === "abierta" && (
            <Button variant="glass" size="sm" iconStart="lock" loading={pending === "cerrada"} disabled={pending !== null} onClick={() => void change("cerrada")}>
              Cerrar
            </Button>
          )}
          {c.status === "cerrada" && (
            <Button variant="glass" size="sm" iconStart="undo" loading={pending === "abierta"} disabled={pending !== null} onClick={() => void change("abierta")}>
              Reabrir
            </Button>
          )}
          {c.status !== "archivada" ? (
            <>
              <Button variant="glass" size="sm" iconStart="copy" onClick={() => void copy()}>
                Copiar enlace
              </Button>
              <Button variant="danger-soft" size="sm" iconStart="trash" disabled={pending !== null} onClick={() => setConfirmArchive(true)}>
                Archivar…
              </Button>
            </>
          ) : (
            <Button variant="glass" size="sm" iconStart="undo" loading={pending === "cerrada"} disabled={pending !== null} onClick={() => void change("cerrada")}>
              Restaurar
            </Button>
          )}
        </div>
      )}
    </CollectionCard>
  );
}
