import type { MouseEvent } from "react";
import { cx } from "../lib/cx";
import { Badge } from "./Chip";
import { Icon, type IconName } from "./Icon";
import { routeClick } from "./Link";
import styles from "./TabBar.module.css";

export interface TabItem<K extends string> {
  key: K;
  label: string;
  icon: IconName;
  /** Path or hash ("/admin/pagos", "#pagos"). */
  href: string;
  /** Pending count bubble. */
  badge?: number | undefined;
  /** Spoken badge text, e.g. "7 por verificar". */
  badgeLabel?: string | undefined;
}

export interface TabBarProps<K extends string> {
  items: readonly TabItem<K>[];
  activeKey: K;
  /** Accessible name of the navigation, e.g. "Secciones de tesorería". */
  label: string;
  /** Intercept selection (otherwise the href is routed). */
  onSelect?: ((key: K, event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
  /** auto: fixed bottom bar on phones, top segmented bar from 960px. Force one for previews. */
  placement?: "auto" | "bottom" | "top" | undefined;
  className?: string | undefined;
}

/**
 * Primary navigation. Phones: floating glass bar at the bottom (with a spacer so content is never hidden).
 * Desktop (>= 960px): a segmented glass bar in the page flow, placed where it is rendered (usually the header).
 */
export function TabBar<K extends string>({ items, activeKey, label, onSelect, placement = "auto", className }: TabBarProps<K>) {
  return (
    <>
      <nav aria-label={label} className={cx("m-glass", styles.bar, styles[placement], className)}>
        <ul role="list" className={styles.list}>
          {items.map((item) => {
            const active = item.key === activeKey;
            return (
              <li key={item.key} className={styles.cell}>
                <a
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(styles.tab, active && styles.active)}
                  onClick={(event) => {
                    if (onSelect) {
                      event.preventDefault();
                      onSelect(item.key, event);
                    } else {
                      routeClick(event, { replace: item.href.startsWith("#") });
                    }
                  }}
                >
                  <span className={styles.iconWrap}>
                    <Icon name={item.icon} size={21} />
                    {item.badge !== undefined && item.badge > 0 && (
                      <Badge count={item.badge} label={item.badgeLabel} className={styles.badge} />
                    )}
                  </span>
                  <span className={styles.label}>{item.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      {placement !== "top" && <div className={cx(styles.spacer, styles[`spacer_${placement}`])} aria-hidden="true" />}
    </>
  );
}
