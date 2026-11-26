import type { ReactNode } from "react";
import { ToneScope } from "../design/theme";
import { cx } from "../lib/cx";
import { Icon } from "./Icon";
import { Link } from "./Link";
import styles from "./ListRow.module.css";

export interface ListGroupProps {
  children: ReactNode;
  /** glass panel (default) or dense strong group (inside another glass card). */
  variant?: "glass" | "strong" | undefined;
  /** Divider start: "leading" aligns with text after a 42px avatar (68px), "text" 16px, "none" full width. */
  inset?: "leading" | "text" | "none" | undefined;
  /** Accessible name for the list. */
  label?: string | undefined;
  className?: string | undefined;
}

/** Glass group of rows with hairline dividers. Children should be <ListRow> (rendered as <li>). */
export function ListGroup({ children, variant = "glass", inset = "leading", label, className }: ListGroupProps) {
  return (
    <ul
      role="list"
      aria-label={label}
      className={cx(styles.group, variant === "glass" ? "m-glass" : "m-glass-strong", styles[variant], styles[`inset_${inset}`], className)}
    >
      {children}
    </ul>
  );
}

/** Plain list item for custom content inside a ListGroup (e.g. a CopyRow), with the group divider. */
export function ListItem({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <li className={cx(styles.item, className)}>{children}</li>;
}

export interface ListRowProps {
  /** Avatar, IconTile or thumbnail. */
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Extra line in the bad tone (e.g. an observation note). */
  note?: ReactNode;
  /** Right column, top (amount, status pill). */
  trailing?: ReactNode;
  /** Right column, bottom (time ago, pill). */
  trailingMeta?: ReactNode;
  href?: string | undefined;
  onClick?: (() => void) | undefined;
  /** Chevron at the end; defaults to true for interactive rows. */
  chevron?: boolean | undefined;
  /** Event tone for this row (avatar and accents) when a list mixes events. */
  tone?: string | null | undefined;
  className?: string | undefined;
}

/** Generic row: leading visual, title and subtitle, trailing values. A link or button when interactive. */
export function ListRow({ leading, title, subtitle, note, trailing, trailingMeta, href, onClick, chevron, tone, className }: ListRowProps) {
  const interactive = href !== undefined || onClick !== undefined;
  const showChevron = chevron ?? interactive;
  const content = (
    <>
      {leading}
      <span className={styles.text}>
        <strong className={styles.title}>{title}</strong>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        {note && <span className={styles.note}>{note}</span>}
      </span>
      {(trailing || trailingMeta) && (
        <span className={styles.trailing}>
          {trailing && <span className={cx(styles.trailingMain, "num")}>{trailing}</span>}
          {trailingMeta && <span className={styles.trailingMeta}>{trailingMeta}</span>}
        </span>
      )}
      {showChevron && <Icon name="chevron-right" size={18} className={styles.chevron} />}
    </>
  );
  const row =
    href !== undefined ? (
      <Link href={href} className={cx(styles.row, styles.interactive)}>
        {content}
      </Link>
    ) : onClick ? (
      <button type="button" onClick={onClick} className={cx(styles.row, styles.interactive)}>
        {content}
      </button>
    ) : (
      <div className={styles.row}>{content}</div>
    );
  if (tone !== undefined) {
    return (
      <ToneScope tone={tone} as="li" className={cx(styles.item, className)}>
        {row}
      </ToneScope>
    );
  }
  return <li className={cx(styles.item, className)}>{row}</li>;
}
