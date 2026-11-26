import { useRef, type KeyboardEvent } from "react";
import { cx } from "../../lib/cx";
import { Icon, STATUS_META, type IconName } from "../../ui";
import type { StatusCounts } from "../data/payments";
import { STATUS_FILTERS, type StatusFilter as StatusFilterValue } from "../routes";
import styles from "./StatusFilter.module.css";

export const FILTER_LABEL: Record<StatusFilterValue, string> = {
  todos: "Todos",
  en_revision: STATUS_META.en_revision.label,
  recibido: STATUS_META.recibido.label,
  observado: STATUS_META.observado.label,
  pagado: STATUS_META.pagado.label,
  anulado: STATUS_META.anulado.label,
};

const FILTER_ICON: Record<StatusFilterValue, IconName> = {
  todos: "list",
  en_revision: STATUS_META.en_revision.icon,
  recibido: STATUS_META.recibido.icon,
  observado: STATUS_META.observado.icon,
  pagado: STATUS_META.pagado.icon,
  anulado: STATUS_META.anulado.icon,
};

export interface StatusFilterProps {
  value: StatusFilterValue;
  counts: StatusCounts;
  onChange: (value: StatusFilterValue) => void;
  className?: string | undefined;
}

/**
 * Tall glass segmented control (AdminPagos) with the count above each label. Six statuses do not fit
 * one row on a phone, so it is a 3 x 2 grid there and a single row from 640px. Radio semantics with
 * one tab stop; arrows move and select, Home/End jump.
 */
export function StatusFilter({ value, counts, onChange, className }: StatusFilterProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, STATUS_FILTERS.indexOf(value));

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = STATUS_FILTERS.length - 1;
    let target: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") target = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") target = index === 0 ? last : index - 1;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = last;
    if (target === null) return;
    event.preventDefault();
    const next = STATUS_FILTERS[target];
    if (next === undefined) return;
    refs.current[target]?.focus();
    if (next !== value) onChange(next);
  };

  return (
    <div role="radiogroup" aria-label="Filtrar por estado" className={cx("m-glass", styles.group, className)}>
      {STATUS_FILTERS.map((filter, index) => {
        const selected = filter === value;
        const tone = filter === "todos" ? "all" : STATUS_META[filter].tone;
        return (
          <button
            key={filter}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${FILTER_LABEL[filter]}, ${counts[filter]}`}
            tabIndex={index === selectedIndex ? 0 : -1}
            onClick={() => {
              if (!selected) onChange(filter);
            }}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cx(styles.segment, selected && styles.selected, styles[tone])}
          >
            <span className={styles.countRow}>
              <Icon name={FILTER_ICON[filter]} size={12} strokeWidth={2.4} className={styles.icon} />
              <span className={cx(styles.count, "num")}>{counts[filter]}</span>
            </span>
            <span className={styles.label}>{FILTER_LABEL[filter]}</span>
          </button>
        );
      })}
    </div>
  );
}
