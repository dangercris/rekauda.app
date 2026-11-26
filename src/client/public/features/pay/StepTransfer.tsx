import { useState } from "react";
import type { CollectionDetail, TreasuryAccount } from "../../../../shared/api";
import { formatMoney, plural } from "../../../lib/format";
import { ActionBar, Button, Card, Counter, Icon, IconTile, Money } from "../../../ui";
import { FINE_POINTER, useMediaQuery } from "../../hooks/ui";
import { priceRangeText, uniformCents } from "../../lib/pricing";
import { AccountRows, DeunaButton } from "./PaymentDetails";
import { StepHeading } from "./StepHeading";
import styles from "./Pay.module.css";

export interface StepTransferProps {
  collection: CollectionDetail;
  count: number;
  onCount: (count: number) => void;
  /** Server config when loaded, otherwise the bundled shared account (rows render immediately). */
  treasury: TreasuryAccount;
  onNext: () => void;
  actionBarClassName?: string | undefined;
}

/** Step 1: how many students, where to transfer (Deuna or bank data with copy buttons). */
export function StepTransfer({ collection, count, onCount, treasury, onNext, actionBarClassName }: StepTransferProps) {
  const unit = uniformCents(collection.options);
  const total = unit === null ? null : unit * count;
  return (
    <>
      <StepHeading title="Transfiere el valor" subtitle="Por Deuna o desde cualquier banco, a esta cuenta." />

      <Card padding="md" gap={12}>
        <Counter
          label="¿Por cuántos estudiantes pagas?"
          description={collection.maxPerPayment > 1 ? `Hasta ${plural(collection.maxPerPayment, "estudiante", "estudiantes")} por comprobante` : undefined}
          value={count}
          min={1}
          max={collection.maxPerPayment}
          onChange={onCount}
          decrementLabel="Quitar un estudiante"
          incrementLabel="Agregar un estudiante"
        />
        <div className={styles.totalRow}>
          <span className={styles.totalLabel}>{total === null ? plural(count, "estudiante", "estudiantes") : "Total a transferir"}</span>
          {total === null ? (
            <span className={styles.totalHint}>{priceRangeText(collection.options)}</span>
          ) : (
            <span className={styles.totalValue}>
              <Money cents={total} variant="title" />
              {count > 1 && unit !== null && <span className={styles.totalHint}>{formatMoney(unit)} por estudiante</span>}
            </span>
          )}
        </div>
      </Card>

      <TreasuryCards treasury={treasury} total={total} deunaLink={collection.deunaLink} collectionSlug={collection.slug} />

      <ActionBar className={actionBarClassName}>
        <Button size="md" iconEnd="arrow-right" onClick={onNext} fullWidth>
          Ya transferí, registrar pago
        </Button>
      </ActionBar>
    </>
  );
}

function TreasuryCards({ treasury, total, deunaLink, collectionSlug }: { treasury: TreasuryAccount; total: number | null; deunaLink: string | null; collectionSlug: string }) {
  const finePointer = useMediaQuery(FINE_POINTER);
  const [qrFailed, setQrFailed] = useState(false);
  const showQr = treasury.qrUrl !== null && !qrFailed;
  const hasDeuna = deunaLink !== null || treasury.deunaUrl !== null || showQr;
  return (
    <>
      {hasDeuna && (
        <Card as="section" padding="md" gap={14} aria-labelledby="pay-deuna-title">
          <div className={styles.sectionHead}>
            <IconTile icon="wallet" size={46} />
            <span className={styles.sectionHeadText}>
              <h3 id="pay-deuna-title" className={styles.sectionTitle}>
                Paga con Deuna
              </h3>
              <span className={styles.sectionSub}>Desde la app, directo a la cuenta de la tesorería</span>
            </span>
          </div>
          <DeunaButton treasury={treasury} total={total} deunaLink={deunaLink} collectionSlug={collectionSlug} />
          {showQr && treasury.qrUrl && (
            <details className={styles.qr} open={finePointer || undefined} key={finePointer ? "fine" : "coarse"}>
              <summary className={styles.qrSummary}>
                <Icon name="qr" size={19} />
                <span className={styles.onlyTouch}>Ver código QR de Deuna</span>
                <span className={styles.onlyPointer}>Código QR de Deuna</span>
                <Icon name="chevron-down" size={18} className={styles.qrChevron} />
              </summary>
              <div className={styles.qrBox}>
                <img
                  src={treasury.qrUrl}
                  alt={`Código QR de Deuna para pagar a ${treasury.holder}`}
                  width={200}
                  height={200}
                  decoding="async"
                  className={styles.qrImage}
                  onError={() => setQrFailed(true)}
                />
                <p className={styles.hint}>Escanéalo con la app Deuna desde tu celular.</p>
              </div>
            </details>
          )}
        </Card>
      )}

      {hasDeuna && (
        <div className={styles.divider} role="separator">
          <span>o desde tu banco</span>
        </div>
      )}

      <Card as="section" padding="md" gap={14} aria-labelledby="pay-account-title">
        <div className={styles.sectionHead}>
          <IconTile icon="bank" size={46} />
          <span className={styles.sectionHeadText}>
            <h3 id="pay-account-title" className={styles.sectionTitle}>
              Datos de la cuenta
            </h3>
            <span className={styles.sectionSub}>Transfiere desde la app o la web de tu banco</span>
          </span>
        </div>
        <AccountRows treasury={treasury} total={total} />
        {treasury.helpUrl && (
          <a className={styles.helpLink} href={treasury.helpUrl} target="_blank" rel="noopener noreferrer">
            <Icon name="info" size={17} />
            <span>Bancos y cooperativas que transfieren a Deuna (de 00:00 a 22:00)</span>
            <Icon name="external" size={15} className={styles.helpExternal} />
          </a>
        )}
      </Card>
    </>
  );
}
