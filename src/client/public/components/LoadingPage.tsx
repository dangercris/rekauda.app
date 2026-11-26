import { Card, Skeleton } from "../../ui";
import { PageFrame } from "./PageFrame";
import styles from "./LoadingPage.module.css";

/** Skeleton while the first request is in flight (home list or collection hero). */
export function LoadingPage({ collection }: { collection?: boolean | undefined }) {
  return (
    <PageFrame wide={collection}>
      <div className={styles.wrap} aria-busy="true">
        <span className="visually-hidden" role="status">
          Cargando…
        </span>
        {collection ? (
          <div className={styles.layout}>
            <div className={styles.column}>
              <Skeleton height={420} radius={34} />
              <Card padding="md" gap={12}>
                <Skeleton height={14} width="40%" />
                <Skeleton height={40} width="55%" />
                <Skeleton height={8} radius="pill" />
              </Card>
            </div>
            <div className={styles.column}>
              <Skeleton height={28} radius="pill" />
              <Card padding="md" gap={12}>
                <Skeleton height={22} width="60%" />
                <Skeleton height={14} lines={3} />
              </Card>
            </div>
          </div>
        ) : (
          <>
            <Skeleton height={12} width="30%" />
            <Skeleton height={34} width="75%" />
            <Skeleton height={14} lines={2} />
            <Skeleton height={88} radius={26} />
            <Skeleton height={88} radius={26} />
          </>
        )}
      </div>
    </PageFrame>
  );
}
