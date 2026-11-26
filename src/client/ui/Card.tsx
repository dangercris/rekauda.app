import { createElement, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { cx } from "../lib/cx";
import styles from "./Card.module.css";

export type CardVariant = "glass" | "strong" | "on-image" | "dashed";
export type CardRadius = "md" | "lg" | "xl" | "2xl" | "3xl";
export type CardPadding = "none" | "sm" | "md" | "lg";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** glass = liquid glass panel (default), strong = dense inner group on glass,
   *  on-image = dark glass over photos, dashed = hint box with a dashed line. */
  variant?: CardVariant | undefined;
  /** 16 / 20 / 22 / 26 / 28 px. Default 2xl (26). */
  radius?: CardRadius | undefined;
  /** none / 12 / 16-18 / 20 px. Default md. */
  padding?: CardPadding | undefined;
  /** Vertical gap between children (flex column). Pass 0 to disable. Default 14. */
  gap?: 0 | 6 | 8 | 10 | 12 | 14 | 16 | undefined;
  as?: "div" | "section" | "article" | "aside" | "header" | "footer" | "li" | "nav" | "form" | undefined;
  ref?: Ref<HTMLElement> | undefined;
  children?: ReactNode;
}

/** Glass surface. The base building block for panels, groups and tiles. */
export function Card({ variant = "glass", radius = "2xl", padding = "md", gap = 14, as: Tag = "div", className, ref, children, ...rest }: CardProps) {
  return createElement(
    Tag,
    {
      ...rest,
      ref,
      className: cx(
        styles.card,
        styles[variant.replace("-", "_")],
        variant === "glass" && "m-glass",
        variant === "strong" && "m-glass-strong",
        variant === "on-image" && "m-glass-dark",
        styles[`r_${radius}`],
        styles[`p_${padding}`],
        gap !== 0 && styles[`g_${gap}`],
        className,
      ),
    },
    children,
  );
}
