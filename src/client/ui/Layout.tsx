import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon, type IconName } from "./Icon";
import { IconButton } from "./IconButton";
import { IconTile } from "./IconTile";
import styles from "./Layout.module.css";
import { Link } from "./Link";

// ---------------------------------------------------------------- headers

export interface SectionHeaderProps {
  title: ReactNode;
  /** Right-side link ("Ver los 7", "Nuevo"). */
  action?: { label: ReactNode; href: string; icon?: IconName | undefined } | undefined;
  /** Uppercase small caption style (list group headings like "HOY"). */
  caption?: boolean | undefined;
  as?: "h2" | "h3" | undefined;
  id?: string | undefined;
  className?: string | undefined;
}

export function SectionHeader({ title, action, caption, as: Tag = "h2", id, className }: SectionHeaderProps) {
  return (
    <div className={cx(styles.sectionHeader, className)}>
      <Tag id={id} className={caption ? styles.caption : styles.sectionTitle}>
        {title}
      </Tag>
      {action && (
        <Link href={action.href} className={styles.sectionAction}>
          {action.icon && <Icon name={action.icon} size={16} />}
          {action.label}
        </Link>
      )}
    </div>
  );
}

export interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string | undefined;
}

/** Admin screen header: eyebrow, 34px title, date line, trailing actions. */
export function PageHeader({ eyebrow, title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <header className={cx(styles.pageHeader, className)}>
      <div className={styles.pageHeading}>
        {eyebrow && <span className={styles.pageEyebrow}>{eyebrow}</span>}
        <h1 className={styles.pageTitle}>{title}</h1>
        {subtitle && <span className={styles.pageSubtitle}>{subtitle}</span>}
      </div>
      {actions && <div className={styles.pageActions}>{actions}</div>}
    </header>
  );
}

export interface TopBarProps {
  title: ReactNode;
  /** Back/close target. */
  backHref?: string | undefined;
  onBack?: (() => void) | undefined;
  backLabel?: string | undefined;
  backIcon?: "chevron-left" | "x" | "arrow-left" | undefined;
  trailing?: ReactNode;
  className?: string | undefined;
}

/** Detail screen bar: 44px back button, centered title, trailing slot (code chip, Guardar). */
export function TopBar({ title, backHref, onBack, backLabel = "Volver", backIcon = "chevron-left", trailing, className }: TopBarProps) {
  return (
    <header className={cx(styles.topBar, className)}>
      <span className={styles.topBarSide}>
        {backHref !== undefined ? (
          <IconButton href={backHref} label={backLabel} icon={backIcon} />
        ) : onBack ? (
          <IconButton onClick={onBack} label={backLabel} icon={backIcon} />
        ) : null}
      </span>
      <h1 className={styles.topBarTitle}>{title}</h1>
      <span className={cx(styles.topBarSide, styles.topBarEnd)}>{trailing}</span>
    </header>
  );
}

// ---------------------------------------------------------------- bars and identity

export interface ActionBarProps {
  children: ReactNode;
  /** Optional summary on the left ("Tu aporte $15,00"). */
  summaryLabel?: ReactNode;
  summaryValue?: ReactNode;
  className?: string | undefined;
}

/** Sticky glass bar at the bottom of the viewport holding the primary action (one thumb). */
export function ActionBar({ children, summaryLabel, summaryValue, className }: ActionBarProps) {
  const hasSummary = summaryLabel !== undefined || summaryValue !== undefined;
  return (
    <div className={cx(styles.actionBarWrap, className)} data-action-bar="">
      <div className={cx("m-glass", styles.actionBar, hasSummary && styles.actionBarSplit)}>
        {hasSummary && (
          <span className={styles.summary}>
            <span className={styles.summaryLabel}>{summaryLabel}</span>
            <strong className={cx(styles.summaryValue, "num")}>{summaryValue}</strong>
          </span>
        )}
        <div className={styles.actionSlot}>{children}</div>
      </div>
    </div>
  );
}

export interface BrandPillProps {
  /** Short mark in the tone circle, e.g. "1A". */
  mark: string;
  title: ReactNode;
  subtitle?: ReactNode;
  href?: string | undefined;
  className?: string | undefined;
}

/** Class identity pill (tone circle + two lines), top-left of public pages. */
export function BrandPill({ mark, title, subtitle, href, className }: BrandPillProps) {
  const body = (
    <>
      <span className={cx("m-ev", styles.brandMark)} aria-hidden="true">
        {mark}
      </span>
      <span className={styles.brandText}>
        <strong className={styles.brandTitle}>{title}</strong>
        {subtitle && <span className={styles.brandSubtitle}>{subtitle}</span>}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className={cx("m-glass", styles.brand, className)}>
      {body}
    </Link>
  ) : (
    <div className={cx("m-glass", styles.brand, className)}>{body}</div>
  );
}

// ---------------------------------------------------------------- content blocks

export interface InfoNoteProps {
  icon?: IconName | undefined;
  children: ReactNode;
  className?: string | undefined;
}

/** Muted icon + sentence (security reminder, where the confirmation goes). */
export function InfoNote({ icon = "info", children, className }: InfoNoteProps) {
  return (
    <div className={cx(styles.infoNote, className)}>
      <Icon name={icon} size={17} />
      <span>{children}</span>
    </div>
  );
}

export interface CheckListProps {
  items: readonly ReactNode[];
  className?: string | undefined;
}

/** "Qué cubre tu aporte": event-tinted check circles. */
export function CheckList({ items, className }: CheckListProps) {
  return (
    <ul role="list" className={cx(styles.checkList, className)}>
      {items.map((item, i) => (
        <li key={i} className={styles.checkItem}>
          <IconTile icon="check" size={26} tone="event" shape="circle" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export interface NumberedStepsProps {
  steps: ReadonlyArray<{ title: ReactNode; description?: ReactNode }>;
  /** Index drawn with the event fill (default 0). */
  highlight?: number | undefined;
  className?: string | undefined;
}

/** "Cómo funciona": numbered circles joined by a rail. */
export function NumberedSteps({ steps, highlight = 0, className }: NumberedStepsProps) {
  return (
    <ol role="list" className={cx(styles.steps, className)}>
      {steps.map((step, i) => (
        <li key={i} className={styles.stepItem}>
          <span className={styles.stepRail} aria-hidden="true">
            <span className={cx(styles.stepNumber, i === highlight ? "m-ev" : "m-glass")}>{i + 1}</span>
            {i < steps.length - 1 && <span className={styles.stepLine} />}
          </span>
          <span className={cx(styles.stepBody, i === steps.length - 1 && styles.stepBodyLast)}>
            <strong className={styles.stepTitle}>{step.title}</strong>
            {step.description && <span className={styles.stepDescription}>{step.description}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export interface CheckItemProps {
  tone: "ok" | "warn" | "bad";
  title: ReactNode;
  detail?: ReactNode;
  className?: string | undefined;
}

const CHECK_ICON = { ok: "check", warn: "alert", bad: "x" } as const;
const CHECK_TEXT = { ok: "Correcto", warn: "Revisar", bad: "Problema" } as const;

/** Automatic validation line (AdminVerificar): tinted icon circle, title, detail. */
export function CheckItem({ tone, title, detail, className }: CheckItemProps) {
  return (
    <div className={cx(styles.checkRow, className)}>
      <IconTile icon={CHECK_ICON[tone]} size={28} tone={tone} shape="circle" />
      <span className={styles.checkText}>
        <strong className={styles.checkTitle}>
          <span className="visually-hidden">{`${CHECK_TEXT[tone]}: `}</span>
          {title}
        </strong>
        {detail && <span className={styles.checkDetail}>{detail}</span>}
      </span>
    </div>
  );
}
