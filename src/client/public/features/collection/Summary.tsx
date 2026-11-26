import type { BoardTotals, CollectionDetail } from "../../../../shared/api";
import { cx } from "../../../lib/cx";
import { Card, Chip, Hero, Icon, IconTile, Money, Notice, ProgressBar } from "../../../ui";
import type { DeadlineInfo } from "../../lib/deadline";
import { priceRange, uniformCents } from "../../lib/pricing";
import styles from "./Summary.module.css";

export interface CollectionHeroProps {
  collection: CollectionDetail;
  deadline: DeadlineInfo;
  totals: BoardTotals | null;
  onOpenBoard: () => void;
}

/** Short descriptions sit on the cover (canvas); long ones move to the details card so the title never clips. */
export const HERO_DESCRIPTION_MAX = 120;

export function heroDescription(collection: CollectionDetail): string | null {
  const text = collection.description.trim();
  return text && text.length <= HERO_DESCRIPTION_MAX ? text : null;
}

function priceCaption(collection: CollectionDetail): string {
  const [only] = collection.options;
  if (collection.options.length === 1 && only) return only.detail || "Valor por estudiante";
  return uniformCents(collection.options) !== null ? "Valor por estudiante" : "Desde";
}

/** Cover header with status chips and the overlapping price, deadline and class progress card. */
export function CollectionHero({ collection, deadline, totals, onOpenBoard }: CollectionHeroProps) {
  const open = collection.status === "abierta";
  const unit = uniformCents(collection.options);
  const price = unit ?? priceRange(collection.options).min;
  return (
    <Hero
      eyebrow={collection.eyebrow ?? undefined}
      title={collection.title}
      description={heroDescription(collection) ?? undefined}
      topStart={
        open ? (
          <Chip variant="on-image" dot="live">
            Recaudación abierta
          </Chip>
        ) : (
          <Chip variant="on-image" icon="lock">
            Recaudación cerrada
          </Chip>
        )
      }
      topEnd={
        deadline.chip ? (
          <Chip variant="on-image" icon="clock" className="num">
            {deadline.chip}
          </Chip>
        ) : undefined
      }
      overlap={
        <Card radius="2xl" padding="md">
          <div className={styles.priceRow}>
            <div className={styles.stack}>
              <span className={styles.caption}>{priceCaption(collection)}</span>
              <Money cents={price} variant="display" />
            </div>
            <div className={styles.deadline}>
              <span className={styles.caption}>{open ? "Paga hasta el" : "Plazo"}</span>
              <span className={styles.deadlineValue}>{deadline.short}</span>
            </div>
          </div>
          {totals && totals.registrados > 0 && (
            <button type="button" className={styles.progress} onClick={onOpenBoard}>
              <ProgressBar value={totals.pagado / totals.registrados} label="Estudiantes con pago confirmado" valueText={`${totals.pagado} de ${totals.registrados}`} />
              <span className={cx(styles.progressMeta, "num")}>
                <span>
                  <strong>
                    {totals.pagado} de {totals.registrados}
                  </strong>{" "}
                  pagados
                </span>
                <span className={styles.progressLink}>
                  Ver avance del curso
                  <Icon name="chevron-right" size={16} />
                </span>
              </span>
            </button>
          )}
        </Card>
      }
    />
  );
}

export function CollectionDetails({ collection, deadline }: { collection: CollectionDetail; deadline: DeadlineInfo }) {
  const open = collection.status === "abierta";
  const multiple = collection.options.length > 1;
  return (
    <div className={styles.details}>
      {!open && (
        <Notice
          tone="neutral"
          icon="lock"
          title="Esta recaudación está cerrada"
          description="Puedes consultar el estado de tu pago y el avance del curso."
        />
      )}
      <Card padding="md" gap={16} className={styles.detailsCard}>
        {collection.description.trim() && heroDescription(collection) === null && <p className={styles.description}>{collection.description}</p>}
        <div className={styles.deadlineRow}>
          <IconTile icon="calendar" size={40} tone={deadline.urgent ? "warn" : "event"} />
          <span className={styles.deadlineText}>
            <strong className={styles.deadlineDate}>{deadline.dateText}</strong>
            <span className={cx(styles.deadlineLabel, deadline.urgent && styles.urgent)}>
              {deadline.urgent && <Icon name="alert" size={14} strokeWidth={2.2} />}
              {deadline.label}
            </span>
          </span>
        </div>
        {multiple && (
          <ul role="list" className={styles.options} aria-label="Valores por opción">
            {collection.options.map((option) => (
              <li key={option.key} className={styles.option}>
                <span className={styles.optionText}>
                  <span className={styles.optionLabel}>{option.label}</span>
                  {option.detail && <span className={styles.optionDetail}>{option.detail}</span>}
                </span>
                <Money cents={option.cents} className={styles.optionPrice} />
              </li>
            ))}
          </ul>
        )}
        {collection.notes.length > 0 && (
          <ul role="list" className={styles.notes}>
            {collection.notes.map((note, i) => (
              <li key={i} className={styles.note}>
                <Icon name="info" size={17} />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
