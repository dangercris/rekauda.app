import type { ReactNode } from "react";
import { useEventTheme } from "../design/theme";
import { cx } from "../lib/cx";
import styles from "./Hero.module.css";

export interface HeroProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Defaults to the EventThemeProvider cover. Null renders the tone-only artwork. */
  coverUrl?: string | null | undefined;
  /** Describe the cover for screen readers when it carries meaning; empty = decorative. */
  coverAlt?: string | undefined;
  /** Top-left slot (status chip on dark glass). */
  topStart?: ReactNode;
  /** Top-right slot (countdown chip, change-image button). */
  topEnd?: ReactNode;
  /** Bottom-right slot beside the title (price chip in the admin preview). */
  aside?: ReactNode;
  /** Card that overlaps the bottom of the hero (price and progress). */
  overlap?: ReactNode;
  /** lg 480px (event page), md 260px (admin preview), sm 176px (link preview). */
  size?: "lg" | "md" | "sm" | undefined;
  headingLevel?: 1 | 2 | undefined;
  className?: string | undefined;
}

/**
 * Cover header: photo (or tone artwork), top scrim for the chips, and a bottom scrim sized to the text
 * block so white text keeps >= 4.5:1 even over a white photo. Text is never placed on the raw image.
 */
export function Hero({
  title,
  eyebrow,
  description,
  coverUrl,
  coverAlt = "",
  topStart,
  topEnd,
  aside,
  overlap,
  size = "lg",
  headingLevel = 1,
  className,
}: HeroProps) {
  const theme = useEventTheme();
  const cover = coverUrl === undefined ? theme.coverUrl : coverUrl;
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div className={cx(styles.wrap, overlap !== undefined && styles.withOverlap, className)}>
      <div className={cx(styles.hero, styles[size])}>
        {cover ? (
          <img className={styles.cover} src={cover} alt={coverAlt} decoding="async" />
        ) : (
          <div className={styles.toneArt} aria-hidden="true">
            <span className={styles.artBlob1} />
            <span className={styles.artBlob2} />
            <span className={styles.artRing} />
          </div>
        )}
        <div className={styles.topScrim} aria-hidden="true" />
        {(topStart || topEnd) && (
          <div className={styles.top}>
            <span className={styles.topSlot}>{topStart}</span>
            <span className={cx(styles.topSlot, styles.topEnd)}>{topEnd}</span>
          </div>
        )}
        <div className={styles.content}>
          <div className={styles.text}>
            {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
            <Heading className={styles.title}>{title}</Heading>
            {description && <p className={styles.description}>{description}</p>}
          </div>
          {aside && <div className={styles.aside}>{aside}</div>}
        </div>
      </div>
      {overlap !== undefined && <div className={styles.overlap}>{overlap}</div>}
    </div>
  );
}
