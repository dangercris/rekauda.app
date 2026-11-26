import type { ReactNode } from "react";
import { EventThemeProvider } from "../../design";
import { cx } from "../../lib/cx";
import { AmbientBackground, BrandPill } from "../../ui";
import { useConfig } from "../hooks/data";
import { isAnalyticsEnabled, openPreferences } from "../lib/analytics";
import { CLASS_MARK } from "../../../shared/instance-bundled";
import { footerText } from "../lib/identity";
import styles from "./PageFrame.module.css";

export interface PageFrameProps {
  tone?: string | null | undefined;
  coverUrl?: string | null | undefined;
  /** Wide desktop layout (collection page: summary + flow columns). */
  wide?: boolean | undefined;
  /** Right side of the header row (share button, desktop tabs). */
  headerEnd?: ReactNode;
  headerCenter?: ReactNode;
  /** Rendered after the footer (the phone tab bar and its spacer). */
  after?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
}

/** Page root: event theme, ambient light, brand header, content and the class footer. */
export function PageFrame({ tone, coverUrl, wide, headerEnd, headerCenter, after, className, children }: PageFrameProps) {
  const { className: classLabel, schoolName } = useConfig();
  return (
    <EventThemeProvider tone={tone ?? null} coverUrl={coverUrl ?? null} as="div" className={cx(styles.root, className)}>
      <AmbientBackground />
      <div className={cx(styles.frame, wide && styles.wide)}>
        <header className={styles.header}>
          <BrandPill
            mark={CLASS_MARK}
            title={classLabel}
            subtitle="Recaudaciones de padres de familia"
            href="/"
            className={styles.brand}
          />
          {headerCenter && <div className={styles.headerCenter}>{headerCenter}</div>}
          {headerEnd && <div className={styles.headerEnd}>{headerEnd}</div>}
        </header>
        <main id="main" className={styles.main}>
          {children}
        </main>
        <footer className={styles.footer}>
          <p>{footerText(classLabel, schoolName)}</p>
          <p className={styles.credit}>
            Made with{" "}
            <span role="img" aria-label="brain">
              🧠
            </span>{" "}
            in Ecuador, © {new Date().getFullYear()}{" "}
            <a href="https://x.com/danger_cris" target="_blank" rel="noopener noreferrer" className={styles.creditLink}>
              Christian Segovia
            </a>
          </p>
          {isAnalyticsEnabled() && (
            <p className={styles.credit}>
              <button type="button" className={styles.prefs} onClick={openPreferences}>
                Preferencias de cookies
              </button>
            </p>
          )}
        </footer>
      </div>
      {after}
    </EventThemeProvider>
  );
}
