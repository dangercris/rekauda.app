import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { copyText } from "../../lib/clipboard";
import { plural } from "../../lib/format";
import { navigate } from "../../lib/router";
import { isString, readJson, writeJson } from "../../lib/storage";
import { Button, EmptyState, Icon, ListGroup, PageHeader, SectionHeader, TextField, useToast } from "../../ui";
import { CollectionSwitcher } from "../components/CollectionSwitcher";
import { ErrorState, HeaderActions, ListSkeleton, useEyebrow } from "../components/common";
import { PaymentRow } from "../components/PaymentRow";
import { FILTER_LABEL, StatusFilter } from "../components/StatusFilter";
import { useAdminData } from "../data/AdminData";
import { csvFileName, downloadCsv, paymentsCsv } from "../data/csv";
import { countByStatus, filterPayments, groupByDay } from "../data/payments";
import { rememberPaymentsHash } from "../lastList";
import { toHash, type StatusFilter as StatusFilterValue } from "../routes";
import styles from "./PaymentsView.module.css";
import { useLogout } from "./useLogout";

const SEARCH_KEY = "adm.search";

function resultText(count: number, status: StatusFilterValue, query: string): string {
  const what = plural(count, "pago", "pagos");
  const scope = status === "todos" ? "" : ` · ${FILTER_LABEL[status]}`;
  return query.trim() ? `${what} para “${query.trim()}”${scope}` : `${what}${scope}`;
}

/** AdminPagos: payments of the selected collection, filtered by status (hash) and searched by text. */
export function PaymentsView({ status }: { status: StatusFilterValue }) {
  const eyebrow = useEyebrow();
  const { collections, pickable, selected, select, payments, refreshAll } = useAdminData();
  const onLogout = useLogout();
  const toast = useToast();
  const [query, setQuery] = useState(() => readJson(SEARCH_KEY, isString, "session") ?? "");
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    writeJson(SEARCH_KEY, query, "session");
  }, [query]);

  useEffect(() => {
    rememberPaymentsHash(toHash({ name: "pagos", status }));
  }, [status]);

  const counts = useMemo(() => countByStatus(payments.payments), [payments.payments]);
  const visible = useMemo(() => filterPayments(payments.payments, status, deferredQuery), [payments.payments, status, deferredQuery]);
  const groups = useMemo(() => groupByDay(visible), [visible]);
  const setStatus = (next: StatusFilterValue) => navigate(toHash({ name: "pagos", status: next }), { replace: true });

  const header = (
    <PageHeader
      eyebrow={eyebrow}
      title="Pagos"
      actions={<HeaderActions onRefresh={() => void refreshAll()} refreshing={collections.refreshing || payments.refreshing} onLogout={onLogout} />}
    />
  );

  if (collections.status === "loading") {
    return (
      <>
        {header}
        <ListSkeleton rows={5} label="Cargando pagos" />
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
          icon="receipt"
          title="Aún no hay recaudaciones"
          description="Crea una recaudación para empezar a recibir comprobantes."
          action={
            <Button href="#evento/nuevo" iconStart="plus">
              Crear recaudación
            </Button>
          }
        />
      </>
    );
  }

  const exportCsv = () => {
    const ok = downloadCsv(paymentsCsv(visible), csvFileName(selected.slug));
    toast.show(ok ? { message: `Descargaste ${plural(visible.length, "pago", "pagos")} en CSV.`, tone: "ok" } : { message: "Tu navegador no pudo crear el archivo.", tone: "error" });
  };

  const copyLink = async () => {
    const ok = await copyText(`${window.location.origin}/r/${selected.slug}`);
    toast.show(ok ? { message: "Enlace copiado.", tone: "ok" } : { message: "No se pudo copiar el enlace.", tone: "error" });
  };

  return (
    <>
      {header}
      <CollectionSwitcher collections={pickable} selectedId={selected.id} onSelect={select} />
      <TextField
        type="search"
        label="Buscar pagos"
        hideLabel
        placeholder="Estudiante, representante o código"
        prefix={<Icon name="search" size={18} />}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && query) {
            event.preventDefault();
            setQuery("");
          }
        }}
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <StatusFilter value={status} counts={counts} onChange={setStatus} />

      {payments.status === "loading" ? (
        <ListSkeleton rows={5} label="Cargando pagos" />
      ) : payments.status === "error" ? (
        <ErrorState title="No pudimos cargar los pagos" message={payments.error ?? ""} onRetry={() => void payments.reload()} retrying={payments.refreshing} />
      ) : payments.payments.length === 0 ? (
        <EmptyState
          icon="receipt"
          title="Todavía no hay pagos en esta recaudación"
          description="Cuando una familia suba su comprobante aparecerá aquí."
          action={
            <Button variant="glass" size="sm" iconStart="copy" onClick={() => void copyLink()}>
              Copiar enlace para las familias
            </Button>
          }
        />
      ) : (
        <>
          <p className={styles.result} role="status" aria-live="polite">
            {resultText(visible.length, status, deferredQuery)}
          </p>
          {visible.length === 0 ? (
            <EmptyState
              icon="search"
              title="No hay pagos con estos filtros"
              description={query.trim() ? "Revisa lo que escribiste o busca en todos los estados." : "Cambia el estado para ver más."}
              action={
                <Button
                  variant="glass"
                  size="sm"
                  onClick={() => {
                    setQuery("");
                    setStatus("todos");
                  }}
                >
                  Ver todos los pagos
                </Button>
              }
            />
          ) : (
            groups.map((group) => (
              <section key={group.key} className={styles.group} aria-label={group.label}>
                <SectionHeader title={group.label} caption as="h2" />
                <ListGroup label={`Pagos de ${group.label.toLowerCase()}`}>
                  {group.items.map((p) => (
                    <PaymentRow key={p.id} payment={p} />
                  ))}
                </ListGroup>
              </section>
            ))
          )}
          {visible.length > 0 && (
            <Button variant="glass" fullWidth iconStart="download" onClick={exportCsv} className={styles.export}>
              Exportar para Excel (CSV)
            </Button>
          )}
        </>
      )}
    </>
  );
}
