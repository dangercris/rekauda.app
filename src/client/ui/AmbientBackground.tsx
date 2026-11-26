import { useEventTheme } from "../design/theme";
import { cx } from "../lib/cx";
import styles from "./AmbientBackground.module.css";

export interface AmbientBackgroundProps {
  /** Defaults to the EventThemeProvider cover. Null forces the tone-only light. */
  coverUrl?: string | null | undefined;
  /** fixed (default): behind the whole viewport. contained: fills the nearest positioned parent (cards, gallery). */
  mode?: "fixed" | "contained" | undefined;
  /** Weaker light for dense admin screens. */
  subtle?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Event ambient light: the cover blurred ~90px plus two soft blobs of the derived secondary and accent
 * colors. Without a cover, a tone glow replaces the image. Purely decorative (aria-hidden), static,
 * and replaced by a flat tint under prefers-reduced-transparency.
 * Place it as the first child of the page root; it sits at z-index -1 inside #root's stacking context.
 */
export function AmbientBackground({ coverUrl, mode = "fixed", subtle, className }: AmbientBackgroundProps) {
  const theme = useEventTheme();
  const cover = coverUrl === undefined ? theme.coverUrl : coverUrl;
  return (
    <div aria-hidden="true" className={cx(styles.ambient, styles[mode], subtle && styles.subtle, className)}>
      {cover ? <img className={styles.cover} src={cover} alt="" decoding="async" /> : <div className={styles.glow} />}
      <div className={cx(styles.blob, styles.blob2)} />
      <div className={cx(styles.blob, styles.blob3)} />
      <div className={styles.flat} />
    </div>
  );
}
