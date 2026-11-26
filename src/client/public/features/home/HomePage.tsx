import type { CollectionSummary } from "../../../../shared/api";
import { ToneScope } from "../../../design";
import { cx } from "../../../lib/cx";
import { EmptyState, Icon, Link, ProgressBar, SectionHeader } from "../../../ui";
import { useInstanceConfig } from "../../../lib/config/useInstance";
import { PageFrame } from "../../components/PageFrame";
import { useDocumentTitle } from "../../hooks/ui";
import { deadlineInfo } from "../../lib/deadline";
import { homeTitle } from "../../lib/identity";
import { priceSummary } from "../../lib/pricing";
import styles from "./HomePage.module.css";

export function HomePage({ collections }: { collections: readonly CollectionSummary[] }) {
  useDocumentTitle(homeTitle(useInstanceConfig().classShortName));
  const open = collections.filter((c) => c.status === "abierta");
  const closed = collections.filter((c) => c.status === "cerrada");
  return (
    <PageFrame>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>Padres de familia</p>
        <h1 className={styles.title}>Recaudaciones del curso</h1>
        <p className={styles.lede}>Elige una para ver cuánto pagar, transferir y registrar tu comprobante.</p>
      </div>
      {open.length > 0 ? (
        <ul role="list" className={styles.list} aria-label="Recaudaciones abiertas">
          {open.map((c) => (
            <CollectionCard key={c.slug} collection={c} />
          ))}
        </ul>
      ) : (
        <EmptyState icon="calendar" title="No hay recaudaciones activas en este momento." description="Cuando el curso abra una nueva, la verás aquí." />
      )}
      {closed.length > 0 && (
        <section className={styles.section} aria-labelledby="home-closed">
          <SectionHeader id="home-closed" title="Anteriores" />
          <ul role="list" className={styles.list}>
            {closed.map((c) => (
              <CollectionCard key={c.slug} collection={c} />
            ))}
          </ul>
        </section>
      )}
    </PageFrame>
  );
}

function CollectionCard({ collection: c }: { collection: CollectionSummary }) {
  const open = c.status === "abierta";
  const deadline = deadlineInfo(c.deadline, open);
  return (
    <ToneScope tone={c.tone} as="li" className={styles.item}>
      <Link href={`/r/${encodeURIComponent(c.slug)}`} className={cx("m-glass", styles.card, !open && styles.closed)}>
        <span className={styles.art} aria-hidden="true">
          {c.coverUrl ? <img src={c.coverUrl} alt="" className={styles.cover} decoding="async" loading="lazy" /> : <span className={styles.toneArt} />}
        </span>
        <span className={styles.body}>
          {c.eyebrow && <span className={styles.cardEyebrow}>{c.eyebrow}</span>}
          <strong className={styles.cardTitle}>{c.title}</strong>
          <span className={cx(styles.meta, "num")}>
            <span>{priceSummary(c.options)}</span>
            <span aria-hidden="true">·</span>
            <span className={cx(deadline.urgent && styles.urgent)}>{open ? `Hasta el ${deadline.short}` : "Cerrada"}</span>
          </span>
          {c.registered > 0 && (
            <span className={styles.progress}>
              <ProgressBar size="sm" value={c.paid / c.registered} label={`Pagos confirmados de ${c.title}`} valueText={`${c.paid} de ${c.registered}`} />
              <span className={cx(styles.progressText, "num")}>
                {c.paid} de {c.registered} pagados
              </span>
            </span>
          )}
        </span>
        <Icon name="chevron-right" size={18} className={styles.chevron} />
      </Link>
    </ToneScope>
  );
}
