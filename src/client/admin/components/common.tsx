import type { CollectionStatus } from "../../../shared/api";
import { CLASS_SHORT_NAME } from "../../../shared/instance";
import { cx } from "../../lib/cx";
import { Button, EmptyState, Icon, IconButton, Skeleton, type IconName } from "../../ui";
import styles from "./common.module.css";

export const CLASS_LABEL = CLASS_SHORT_NAME;
export const EYEBROW = `Tesorería · ${CLASS_LABEL}`;

const COLLECTION_STATUS: Record<CollectionStatus, { label: string; icon: IconName; tone: "ok" | "void" | "warn" }> = {
  abierta: { label: "Abierta", icon: "dot", tone: "ok" },
  cerrada: { label: "Cerrada", icon: "lock", tone: "warn" },
  archivada: { label: "Archivada", icon: "file", tone: "void" },
};

/** Collection status label with icon (never color alone). */
export function CollectionStatusPill({ status, className }: { status: CollectionStatus; className?: string | undefined }) {
  const meta = COLLECTION_STATUS[status];
  return (
    <span className={cx(styles.pill, styles[meta.tone], className)}>
      {status === "abierta" ? <span className={styles.live} aria-hidden="true" /> : <Icon name={meta.icon} size={11} strokeWidth={2.4} />}
      {meta.label}
    </span>
  );
}

export interface ErrorStateProps {
  title?: string | undefined;
  message: string;
  onRetry: () => void;
  retrying?: boolean | undefined;
  className?: string | undefined;
}

/** Load failure with a retry button. */
export function ErrorState({ title = "No pudimos cargar la información", message, onRetry, retrying, className }: ErrorStateProps) {
  return (
    <div role="alert" className={className}>
      <EmptyState
        icon={<span className={styles.errorIcon}><Icon name="alert-circle" size={22} /></span>}
        title={title}
        description={message}
        action={
          <Button variant="glass" size="sm" iconStart="refresh" onClick={onRetry} loading={retrying}>
            Reintentar
          </Button>
        }
      />
    </div>
  );
}

/** Placeholder rows for a ListGroup while loading. */
export function ListSkeleton({ rows = 4, label = "Cargando" }: { rows?: number | undefined; label?: string | undefined }) {
  return (
    <div className={cx("m-glass", styles.skeletonGroup)} role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <Skeleton width={42} height={42} radius="circle" />
          <span className={styles.skeletonText}>
            <Skeleton width="62%" height={14} />
            <Skeleton width="40%" height={12} />
          </span>
          <Skeleton width={56} height={14} />
        </div>
      ))}
    </div>
  );
}

export interface HeaderActionsProps {
  onRefresh: () => void;
  refreshing: boolean;
  onLogout: () => void;
}

/** Refresh and sign-out buttons for the page headers. */
export function HeaderActions({ onRefresh, refreshing, onLogout }: HeaderActionsProps) {
  return (
    <>
      <IconButton
        icon={<Icon name="refresh" size={19} className={refreshing ? styles.spinning : undefined} />}
        label={refreshing ? "Actualizando" : "Actualizar"}
        onClick={onRefresh}
        disabled={refreshing}
        aria-busy={refreshing || undefined}
      />
      <IconButton icon="logout" label="Cerrar sesión" variant="ink" onClick={onLogout} />
    </>
  );
}
