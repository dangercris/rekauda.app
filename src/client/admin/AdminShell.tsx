import { useEffect, useRef } from "react";
import { EventThemeProvider } from "../design";
import { cx } from "../lib/cx";
import { useInstanceConfig } from "../lib/config/useInstance";
import { navigate } from "../lib/router";
import { AmbientBackground, BrandPill, TabBar, type TabItem } from "../ui";
import styles from "./AdminShell.module.css";
import { useAdminData } from "./data/AdminData";
import { countByStatus } from "./data/payments";
import { useNavigation } from "./navigation";
import { isDetailRoute, tabOf, toHash, type AdminRoute, type TabKey } from "./routes";
import { EventEditorView } from "./views/EventEditorView";
import { EventsView } from "./views/EventsView";
import { MovementsView } from "./views/MovementsView";
import { PaymentsView } from "./views/PaymentsView";
import { SummaryView } from "./views/SummaryView";
import { VerifyView } from "./views/VerifyView";

const FALLBACK: AdminRoute = { name: "resumen" };

/** Signed-in frame: tone of the selected collection, navigation (top on desktop, bottom on phones), routed view. */
export function AdminShell() {
  const { route } = useNavigation();
  const { classMark, classShortName } = useInstanceConfig();
  const data = useAdminData();
  const current = route ?? FALLBACK;
  const mainRef = useRef<HTMLElement>(null);

  // Unknown hash: replace it with the summary instead of leaving a broken URL in history.
  useEffect(() => {
    if (route === null) navigate("#resumen", { replace: true });
  }, [route]);

  // Each screen starts at the top; move focus to the new view for screen readers (not on first load,
  // and not when only the payments filter changes).
  const screenKey = current.name === "pagos" ? "pagos" : toHash(current);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    mainRef.current?.focus({ preventScroll: true });
  }, [screenKey]);

  const review = countByStatus(data.payments.payments).en_revision;
  const pendingMovements = data.movements.movements.length;
  const items: TabItem<TabKey>[] = [
    { key: "resumen", label: "Resumen", icon: "grid", href: "#resumen" },
    {
      key: "pagos",
      label: "Pagos",
      icon: "receipt",
      href: "#pagos",
      badge: review,
      badgeLabel: review === 1 ? "1 pago en revisión" : `${review} pagos en revisión`,
    },
    {
      key: "movimientos",
      label: "Movimientos",
      icon: "bank",
      href: "#movimientos",
      badge: pendingMovements,
      badgeLabel: pendingMovements === 1 ? "1 movimiento sin vincular" : `${pendingMovements} movimientos sin vincular`,
    },
    { key: "eventos", label: "Eventos", icon: "calendar", href: "#eventos" },
  ];
  const onSelect = (key: TabKey) => {
    const target = key === "pagos" ? toHash({ name: "pagos", status: "en_revision" }) : `#${key}`;
    navigate(target);
  };

  const detail = isDetailRoute(current);
  const editor = current.name === "evento";

  return (
    <EventThemeProvider
      tone={data.selected?.tone ?? null}
      coverUrl={data.selected?.coverUrl ?? null}
      as="div"
      className={cx(styles.root, detail && styles.detail)}
    >
      {/* The editor paints its own ambient light from the draft tone and cover. */}
      {!editor && <AmbientBackground subtle />}
      <a href="#contenido" className={styles.skip} onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}>
        Saltar al contenido
      </a>
      <div className={styles.desktopBar}>
        <BrandPill mark={classMark} title="Tesorería" subtitle={classShortName} href="#resumen" />
        <TabBar label="Secciones de tesorería" placement="top" items={items} activeKey={tabOf(current)} onSelect={onSelect} />
      </div>
      <main id="contenido" ref={mainRef} tabIndex={-1} className={cx(styles.main, detail ? styles.wide : styles.narrow)}>
        {renderView(current)}
      </main>
      {!detail && (
        <div className={styles.mobileBar}>
          <TabBar label="Secciones de tesorería" placement="bottom" items={items} activeKey={tabOf(current)} onSelect={onSelect} />
        </div>
      )}
    </EventThemeProvider>
  );
}

function renderView(route: AdminRoute) {
  switch (route.name) {
    case "resumen":
      return <SummaryView />;
    case "pagos":
      return <PaymentsView status={route.status} />;
    case "pago":
      return <VerifyView key={route.id} paymentId={route.id} />;
    case "movimientos":
      return <MovementsView />;
    case "eventos":
      return <EventsView />;
    case "evento":
      return <EventEditorView key={route.id ?? "nuevo"} collectionId={route.id} />;
  }
}
