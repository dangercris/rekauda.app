import { useId, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { IconButton } from "./IconButton";
import styles from "./Sheet.module.css";

export interface SheetProps {
  title: ReactNode;
  /** Content under the title, typically a soft Chip with the event and amount. */
  subtitle?: ReactNode;
  /** Close control: an href (preferred, works as a link) or a click handler. */
  closeHref?: string | undefined;
  onClose?: (() => void) | undefined;
  closeLabel?: string | undefined;
  /** Sticky bottom area for the primary action. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}

/**
 * Bottom-sheet layout block (not a modal): grabber, title row with close, scrolling body, footer.
 * Use inside <SheetLayout> to sit over the darkened event cover, or alone on the page.
 */
export function Sheet({ title, subtitle, closeHref, onClose, closeLabel = "Cerrar", footer, children, className }: SheetProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cx("m-sheet", styles.sheet, className)}>
      <span className={styles.grabber} aria-hidden="true" />
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {subtitle}
        </div>
        {closeHref !== undefined ? (
          <IconButton href={closeHref} label={closeLabel} icon="x" size={40} />
        ) : onClose ? (
          <IconButton onClick={onClose} label={closeLabel} icon="x" size={40} />
        ) : null}
      </header>
      <div className={styles.body}>{children}</div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </section>
  );
}

export interface SheetLayoutProps {
  /** Event cover; null shows the tone gradient. */
  coverUrl?: string | null | undefined;
  eyebrow?: ReactNode;
  title?: ReactNode;
  children: ReactNode;
}

/** Screen with the event cover dimmed at the top and a Sheet rising over it (EnviarComprobante). */
export function SheetLayout({ coverUrl, eyebrow, title, children }: SheetLayoutProps) {
  return (
    <div className={styles.layout}>
      <div className={styles.backdrop} aria-hidden="true">
        {coverUrl ? <img className={styles.cover} src={coverUrl} alt="" /> : <div className={styles.toneCover} />}
        <div className={styles.dim} />
        {(eyebrow || title) && (
          <div className={styles.context}>
            {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
            {title && <strong className={styles.contextTitle}>{title}</strong>}
          </div>
        )}
      </div>
      <div className={styles.slot}>{children}</div>
    </div>
  );
}
