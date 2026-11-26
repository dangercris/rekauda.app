import { cx } from "../../lib/cx";
import { Button } from "../../ui";
import { useInstanceConfig } from "../../lib/config/useInstance";
import { setConsent, useAnalyticsEnabled, useConsent } from "../lib/analytics";
import styles from "./ConsentBanner.module.css";

/**
 * Analytics consent card, fixed above the phone tab bar (bottom-centered on desktop). It never appears on
 * its own: only when the visitor opens "Preferencias de cookies" in the footer (and a Measurement ID is set).
 * Without a choice nothing from Google loads.
 * It never takes focus: it is a region the keyboard can reach after the page content.
 */
export function ConsentBanner() {
  const { preferencesOpen } = useConsent();
  const { gaMeasurementId } = useInstanceConfig().analytics;
  const enabled = useAnalyticsEnabled();
  if (!enabled || !preferencesOpen) return null;
  return (
    <div className={styles.wrap}>
      <section role="region" aria-label="Preferencias de cookies" className={cx("m-glass", styles.card)}>
        <h2 className={styles.title}>
          ¿Nos ayudas a mejorar el sitio?
        </h2>
        <p className={styles.body}>
          Usamos Google Analytics para saber cuántas personas visitan y en qué pasos se traban. No usamos tus datos de pago ni los compartimos para
          publicidad.
        </p>
        <div className={styles.actions}>
          <Button size="sm" variant="ink" onClick={() => setConsent("granted", gaMeasurementId)}>
            Aceptar
          </Button>
          <Button size="sm" variant="soft" onClick={() => setConsent("denied", gaMeasurementId)}>
            No, gracias
          </Button>
        </div>
      </section>
    </div>
  );
}
