import type { ReactNode } from "react";
import type { AdminCollection } from "../../../shared/api";
import { ToneScope } from "../../design";
import { cx } from "../../lib/cx";
import { daysUntil, formatInt } from "../../lib/format";
import { Icon, Link, Money, ProgressBar } from "../../ui";
import { CollectionStatusPill } from "./common";
import styles from "./CollectionCard.module.css";

/** "16 días", "1 día", "Hoy", "Vencido": compact deadline for rows. */
export function shortDaysLeft(deadline: string, now: Date = new Date()): { text: string; urgent: boolean } {
  const days = daysUntil(deadline, now);
  if (Number.isNaN(days)) return { text: "", urgent: false };
  if (days < 0) return { text: "Vencido", urgent: true };
  if (days === 0) return { text: "Hoy", urgent: true };
  return { text: days === 1 ? "1 día" : `${formatInt(days)} días`, urgent: days <= 8 };
}

export interface CollectionCardProps {
  collection: AdminCollection;
  /** Makes the summary area a link. */
  href?: string | undefined;
  /** Show the status pill (lists that mix statuses). */
  showStatus?: boolean | undefined;
  /** Actions under the summary (EventsView). */
  children?: ReactNode;
  className?: string | undefined;
}

/** Collection row (AdminResumen "Eventos activos"): cover or tone tile, title, deadline, progress, money. */
export function CollectionCard({ collection: c, href, showStatus, children, className }: CollectionCardProps) {
  const s = c.stats;
  const due = shortDaysLeft(c.deadline);
  const value = s.expectedCents > 0 ? s.paidCents / s.expectedCents : 0;
  const summary = (
    <>
      <span className={styles.thumb} aria-hidden="true">
        {c.coverUrl ? (
          <img src={c.coverUrl} alt="" className={styles.cover} decoding="async" loading="lazy" />
        ) : (
          <span className={cx("m-ev", styles.toneTile)}>
            <Icon name="calendar" size={24} />
          </span>
        )}
      </span>
      <span className={styles.body}>
        <span className={styles.head}>
          <strong className={styles.title}>{c.title}</strong>
          {c.status === "abierta" ? (
            <span className={cx(styles.due, "num", due.urgent && styles.urgent)}>{due.text}</span>
          ) : null}
        </span>
        {showStatus && (
          <span className={styles.statusLine}>
            <CollectionStatusPill status={c.status} />
            <span className={cx(styles.slug, "mono")}>/r/{c.slug}</span>
          </span>
        )}
        <ProgressBar value={value} size="sm" label={`Recaudado de ${c.title}`} valueText={`${Math.round(value * 100)} %`} />
        <span className={cx(styles.meta, "num")}>
          <span>
            {formatInt(s.pagado)}/{formatInt(s.students)} {s.students === 1 ? "estudiante" : "estudiantes"}
          </span>
          <span>
            <Money cents={s.paidCents} compact /> de <Money cents={s.expectedCents} compact />
          </span>
        </span>
      </span>
    </>
  );
  return (
    <ToneScope tone={c.tone} as="article" className={cx("m-glass", styles.card, c.status === "archivada" && styles.archived, className)}>
      {href ? (
        <Link href={href} className={cx(styles.summary, styles.link)}>
          {summary}
          <Icon name="chevron-right" size={18} className={styles.chevron} />
        </Link>
      ) : (
        <div className={styles.summary}>{summary}</div>
      )}
      {children}
    </ToneScope>
  );
}
