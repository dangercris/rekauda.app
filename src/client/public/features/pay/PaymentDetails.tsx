import type { TreasuryAccount } from "../../../../shared/api";
import { cx } from "../../../lib/cx";
import { formatMoney, plainAmount } from "../../../lib/format";
import { track } from "../../lib/analytics";
import { Button, CopyRow, Icon, KeyValue, Money } from "../../../ui";
import styles from "./Pay.module.css";

/** Pieces of the payment data shared by step 1 (transfer) and the "Ver datos de pago" disclosure in step 2. */

export interface PaymentDataProps {
  treasury: TreasuryAccount;
  /** Amount to transfer, or null when it depends on options not chosen yet. */
  total: number | null;
}

/** Bank account rows with copy buttons. */
export function AccountRows({ treasury, total }: PaymentDataProps) {
  return (
    <div className={cx("m-glass-strong", styles.account)}>
      <div className={styles.accountRow}>
        <KeyValue label="Banco" value={treasury.bank} hint={treasury.accountType} />
      </div>
      <div className={styles.accountRow}>
        <CopyRow label="Número de cuenta" value={treasury.accountNumber} size="lg" mono />
      </div>
      <div className={styles.accountRow}>
        <CopyRow label="Titular" value={treasury.holder} copyLabel="Copiar" />
      </div>
      <div className={styles.accountRow}>
        <CopyRow label="Cédula" value={treasury.holderId} mono />
      </div>
      {total !== null && (
        <div className={styles.accountRow}>
          <CopyRow label="Monto" value={plainAmount(total)} display={<Money cents={total} />} />
        </div>
      )}
    </div>
  );
}

/**
 * The single "Pagar con Deuna" button: the collection's charge link when set (a web page, so on every device),
 * otherwise the treasury account in the Deuna app (touch devices only, the app does not open on desktop).
 */
export function DeunaButton({ treasury, total, deunaLink, collectionSlug }: PaymentDataProps & { deunaLink: string | null; collectionSlug: string }) {
  const href = deunaLink ?? treasury.deunaUrl;
  if (!href) return null;
  let hint: string;
  if (!deunaLink) hint = "Se abre Deuna con esta cuenta como destino. Si no tienes Deuna, usa los datos de abajo.";
  else if (total === null) hint = "Se abre el link de cobro de la tesorería en Deuna. Revisa que el monto coincida con tu total antes de confirmar.";
  else hint = `Se abre el link de cobro de la tesorería en Deuna. Revisa que el monto sea ${formatMoney(total)} antes de confirmar.`;
  return (
    <div className={deunaLink ? styles.deuna : cx(styles.onlyTouch, styles.deuna)}>
      <Button
        href={href}
        external
        target="_blank"
        rel="noopener noreferrer"
        size="lg"
        fullWidth
        iconEnd="external"
        onClick={() => track("deuna_click", { collection: collectionSlug, kind: deunaLink ? "charge_link" : "app" })}
      >
        Pagar con Deuna
      </Button>
      <p className={styles.hint}>{hint}</p>
    </div>
  );
}

/** Step 2: collapsed payment data so a parent can check or copy it again without leaving the form. */
export function PaymentDetailsDisclosure({ treasury, total, deunaLink, collectionSlug }: PaymentDataProps & { deunaLink: string | null; collectionSlug: string }) {
  return (
    <details className={cx("m-glass", styles.payDetails)}>
      <summary className={styles.qrSummary}>
        <Icon name="bank" size={19} />
        <span>Ver datos de pago</span>
        <Icon name="chevron-down" size={18} className={styles.qrChevron} />
      </summary>
      <div className={styles.payDetailsBody}>
        <DeunaButton treasury={treasury} total={total} deunaLink={deunaLink} collectionSlug={collectionSlug} />
        <AccountRows treasury={treasury} total={total} />
      </div>
    </details>
  );
}
