import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CollectionDetail } from "../../../../shared/api";
import { cx } from "../../../lib/cx";
import { navigate, setHash, useRoute } from "../../../lib/router";
import { shareLink } from "../../../lib/share";
import { Button, Chip, Hero, IconButton, TabBar, useToast } from "../../../ui";
import { PageFrame } from "../../components/PageFrame";
import { useBoard, useConfig } from "../../hooks/data";
import { scrollToTop, useDocumentTitle, useKeyboardOpen } from "../../hooks/ui";
import { track } from "../../lib/analytics";
import { readCodes } from "../../lib/codes";
import { deadlineInfo } from "../../lib/deadline";
import { collectionTitle } from "../../lib/identity";
import { BoardPanel } from "../board/BoardPanel";
import { PayPanel } from "../pay/PayPanel";
import { usePayFlow } from "../pay/usePayFlow";
import { StatusPanel, type LookupRequest } from "../status/StatusPanel";
import styles from "./CollectionPage.module.css";
import { CollectionDetails, CollectionHero } from "./Summary";
import { availableTabs, resolveTab, type TabKey } from "./tabs";

export interface CollectionPageProps {
  collection: CollectionDetail;
  /** Number of public collections (the "Todas las recaudaciones" link needs 2+), null when unknown. */
  collectionsCount: number | null;
}

export function CollectionPage({ collection, collectionsCount }: CollectionPageProps) {
  const route = useRoute();
  const toast = useToast();
  const { banks } = useConfig();
  const open = collection.status === "abierta";
  const [codes, setCodes] = useState<string[]>(() => readCodes());
  const tab = resolveTab(route.hash, open, codes.length > 0);
  const board = useBoard(collection.slug);
  const reloadBoard = board.reload;
  const typing = useKeyboardOpen();
  const [lookupRequest, setLookupRequest] = useState<LookupRequest | null>(null);
  const deadline = useMemo(() => deadlineInfo(collection.deadline, open), [collection.deadline, open]);

  useDocumentTitle(collectionTitle(collection.title));

  const onRegistered = useCallback(() => {
    setCodes(readCodes());
    reloadBoard();
  }, [reloadBoard]);
  const flow = usePayFlow({ collection, banks, enabled: open, onRegistered });

  // Keep the URL hash in sync with the tab actually shown (missing, unknown or #pagar on a closed one).
  useEffect(() => {
    if (route.hash !== tab) setHash(tab, { replace: true });
  }, [route.hash, tab]);

  useEffect(() => {
    document.documentElement.setAttribute("data-public-tabbar", "");
    return () => document.documentElement.removeAttribute("data-public-tabbar");
  }, []);

  const lastTab = useRef<TabKey>(tab);
  useEffect(() => {
    if (lastTab.current === tab) return;
    lastTab.current = tab;
    scrollToTop();
    if (tab === "estado") setCodes(readCodes());
    if (tab === "avance") reloadBoard();
  }, [tab, reloadBoard]);

  const goTab = (key: TabKey) => navigate(`#${key}`);
  const showSummaryOnPhone = !open || (tab === "pagar" && flow.state.step === 1);
  const tabs = availableTabs(open).map((t) => ({ ...t, href: `#${t.key}` }));
  const showBack = collectionsCount !== null && collectionsCount >= 2;

  const share = async () => {
    track("share_click", { collection: collection.slug });
    const outcome = await shareLink({ title: collection.title, url: `/r/${encodeURIComponent(collection.slug)}` });
    if (outcome === "copied") toast.show({ message: "Link copiado", tone: "ok" });
    else if (outcome === "failed") toast.show({ message: "No se pudo copiar el link", tone: "error" });
  };

  const backLink = showBack ? (
    <Button variant="glass" size="sm" href="/?todas" iconStart="arrow-left" className={styles.back}>
      Todas las recaudaciones
    </Button>
  ) : null;

  const actionBarClassName = cx(styles.actionBar, typing && styles.actionBarTyping);

  return (
    <PageFrame
      tone={collection.tone}
      coverUrl={collection.coverUrl}
      wide
      className={styles.page}
      headerCenter={
        <TabBar items={tabs} activeKey={tab} label="Secciones" placement="top" onSelect={(key) => goTab(key)} />
      }
      headerEnd={<IconButton icon="share" label="Compartir recaudación" onClick={() => void share()} />}
      after={
        <div className={styles.bottomTabs}>
          <TabBar
            items={tabs}
            activeKey={tab}
            label="Secciones"
            placement="bottom"
            onSelect={(key) => goTab(key)}
            className={cx(styles.tabBar, typing && styles.tabBarHidden)}
          />
        </div>
      }
    >
      <div className={styles.layout}>
        <aside className={cx(styles.summary, !showSummaryOnPhone && styles.phoneHidden)} aria-label="Resumen de la recaudación">
          {backLink}
          <CollectionHero collection={collection} deadline={deadline} totals={board.data?.totals ?? null} onOpenBoard={() => goTab("avance")} />
          <CollectionDetails collection={collection} deadline={deadline} />
        </aside>

        <div className={styles.flow}>
          {!showSummaryOnPhone && (
            <div className={styles.context}>
              {backLink}
              <Hero
                size="sm"
                headingLevel={2}
                eyebrow={collection.eyebrow ?? undefined}
                title={collection.title}
                topStart={
                  open ? undefined : (
                    <Chip variant="on-image" icon="lock" size="sm">
                      Cerrada
                    </Chip>
                  )
                }
              />
            </div>
          )}
          {open && (
            <section hidden={tab !== "pagar"} aria-label="Pagar" className={styles.tabPanel}>
              <PayPanel collection={collection} flow={flow} active={tab === "pagar"} onViewStatus={(code) => {
                setCodes(readCodes());
                setLookupRequest((prev) => ({ code, nonce: (prev?.nonce ?? 0) + 1 }));
                goTab("estado");
              }} actionBarClassName={actionBarClassName} />
            </section>
          )}
          <section hidden={tab !== "estado"} aria-label="Mi estado" className={styles.tabPanel}>
            <StatusPanel
              collection={collection}
              codes={codes}
              active={tab === "estado"}
              request={lookupRequest}
              onRegisterAgain={() => {
                flow.restart();
                goTab("pagar");
              }}
            />
          </section>
          <section hidden={tab !== "avance"} aria-label="Avance" className={styles.tabPanel}>
            <BoardPanel collection={collection} board={board} />
          </section>
        </div>
      </div>
    </PageFrame>
  );
}
