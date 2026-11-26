import type { CSSProperties } from "react";
import { cx } from "../lib/cx";
import styles from "./Skeleton.module.css";

export interface SkeletonProps {
  width?: number | string | undefined;
  height?: number | string | undefined;
  /** "pill", "circle" or a radius in px. Default 10. */
  radius?: "pill" | "circle" | number | undefined;
  /** Render N text lines (last one shorter). */
  lines?: number | undefined;
  className?: string | undefined;
}

/** Loading placeholder with a soft shimmer (static under reduced motion). Always aria-hidden. */
export function Skeleton({ width = "100%", height = 14, radius = 10, lines, className }: SkeletonProps) {
  const borderRadius = radius === "pill" ? 999 : radius === "circle" ? "50%" : radius;
  if (lines && lines > 1) {
    return (
      <span className={cx(styles.lines, className)} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className={styles.block} style={{ width: i === lines - 1 ? "62%" : "100%", height, borderRadius }} />
        ))}
      </span>
    );
  }
  const style: CSSProperties = { width, height, borderRadius };
  return <span className={cx(styles.block, className)} style={style} aria-hidden="true" />;
}
