import { useMemo, useState } from "react";
import type { BoardResponse, CollectionDetail } from "../../../../shared/api";
import { cx } from "../../../lib/cx";
import { normalizeSearch } from "../../../lib/format";
import { Avatar, Button, Card, EmptyState, Icon, ListGroup, ListRow, Notice, SegmentedBar, Skeleton, STATUS_META, StatusPill, TextField, type BarSegment } from "../../../ui";
import type { Resource } from "../../hooks/useResource";
import styles from "./Board.module.css";

export const SEARCH_FROM = 8;

const ORDER = ["pagado", "recibido", "en_revision", "observado"] as const;

export interface BoardPanelProps {
  collection: CollectionDetail;
  board: Resource<BoardResponse>;
}

/** Class progress without private data: first name + surname initial and a status per student. */
export function BoardPanel({ collection, board }: BoardPanelProps) {
  const [query, setQuery] = useState("");
  const data = board.data;
  const multiple = collection.options.length > 1;
  const labels = useMemo(() => new Map(collection.options.map((o) => [o.key, o.label])), [collection.options]);

  const visible = useMemo(() => {
    if (!data) return [];
    const q = normalizeSearch(query);
    return q ? data.students.filter((s) => normalizeSearch(s.name).includes(q)) : data.students;
  }, [data, query]);

  const segments: BarSegment[] = data
    ? ORDER.map((status) => ({ key: status, value: data.totals[status], color: STATUS_META[status].tone, label: STATUS_META[status].label }))
    : [];

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.title}>Avance del curso</h2>
        <p className={styles.sub}>Solo se muestra el primer nombre y la inicial del apellido.</p>
      </div>

      {board.error && !data ? (
        <Notice
          tone="bad"
          icon="alert-circle"
          title="No pudimos cargar el avance del curso"
          description="Intenta en unos minutos."
          action={
            <Button variant="glass" size="sm" iconStart="refresh" onClick={board.reload} loading={board.loading}>
              Reintentar
            </Button>
          }
        />
      ) : !data ? (
        <Card padding="md" gap={14} aria-busy="true" aria-label="Cargando el avance del curso">
          <Skeleton height={36} width="55%" />
          <Skeleton height={12} radius="pill" />
          <Skeleton height={14} lines={3} />
        </Card>
      ) : (
        <>
          <Card padding="md" gap={14}>
            <p className={cx(styles.counts, "num")}>
              <span className={styles.big}>{data.totals.pagado}</span>
              <span className={styles.of}>
                pagados de <strong>{data.totals.registrados}</strong> registrados
              </span>
            </p>
            <SegmentedBar
              segments={segments}
              total={Math.max(data.totals.registrados, 1)}
              legend
              label={`${data.totals.pagado} pagados, ${data.totals.recibido} recibidos, ${data.totals.en_revision} en revisión y ${data.totals.observado} con observación, de ${data.totals.registrados} registrados`}
            />
          </Card>

          {data.students.length >= SEARCH_FROM && (
            <TextField
              label="Buscar estudiante"
              hideLabel
              type="search"
              placeholder="Buscar estudiante"
              autoComplete="off"
              prefix={<Icon name="search" size={18} />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}

          {visible.length > 0 ? (
            <ListGroup label="Estudiantes registrados">
              {visible.map((student, i) => (
                <ListRow
                  key={`${student.name}-${student.option}-${i}`}
                  leading={<Avatar name={student.name.replace(/\./g, "")} />}
                  title={student.name}
                  subtitle={multiple ? student.optionLabel || labels.get(student.option) || student.option : undefined}
                  trailing={<StatusPill status={student.status} size="sm" />}
                />
              ))}
            </ListGroup>
          ) : (
            <EmptyState
              icon={data.students.length ? "search" : "users"}
              title={data.students.length ? "Ningún estudiante coincide con la búsqueda." : "Todavía no hay pagos registrados."}
            />
          )}
          {board.error && <p className={styles.staleNote}>No se pudo actualizar el avance. Se muestra la última información.</p>}
        </>
      )}
    </div>
  );
}

