import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "../lib/cx";
import styles from "./Button.module.css";
import { routeClick } from "./Link";
import { renderSlot, type IconSlot } from "./slot";
import { Spinner } from "./Spinner";

export type ButtonVariant = "event" | "ink" | "glass" | "soft" | "ghost" | "ok" | "danger" | "danger-soft" | "on-image";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonOwnProps {
  /** event = tone fill (primary), ink = neutral dark, glass = on glass, soft = dense glass chip,
   *  ghost = text only, ok = verify, danger = destructive fill, danger-soft = destructive on glass,
   *  on-image = dark glass over photos. */
  variant?: ButtonVariant | undefined;
  /** sm 40px (pill, hit area 44px), md 50px, lg 56px. Default md. */
  size?: ButtonSize | undefined;
  fullWidth?: boolean | undefined;
  /** Shows a spinner, keeps the width, sets aria-busy and blocks clicks. */
  loading?: boolean | undefined;
  iconStart?: IconSlot | undefined;
  iconEnd?: IconSlot | undefined;
  /** Force the pill shape on md/lg (sm is always a pill). */
  pill?: boolean | undefined;
  children?: ReactNode;
  className?: string | undefined;
}

export type ButtonAsButton = ButtonOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonOwnProps> & {
    href?: undefined;
    ref?: Ref<HTMLButtonElement> | undefined;
  };

export type ButtonAsLink = ButtonOwnProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonOwnProps> & {
    /** Renders an <a>. Internal hrefs ("/x", "#y") route without reloading. */
    href: string;
    /** Opt out of in-app routing (downloads, wa.me, deep links). */
    external?: boolean | undefined;
    ref?: Ref<HTMLAnchorElement> | undefined;
  };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

const ICON_SIZE: Record<ButtonSize, number> = { sm: 15, md: 17, lg: 18 };

function classes(p: ButtonOwnProps): string {
  const variant = p.variant ?? "event";
  const size = p.size ?? "md";
  return cx(
    styles.button,
    styles[size],
    styles[variant.replace(/-/g, "_")],
    variant === "event" && "m-ev",
    variant === "ink" && "m-ink",
    variant === "glass" && "m-glass",
    variant === "ok" && "m-ok",
    variant === "danger" && "m-bad",
    variant === "on-image" && "m-glass-dark",
    (p.pill || size === "sm") && styles.pill,
    p.fullWidth && styles.full,
    p.loading && styles.loading,
    p.className,
  );
}

function Content({ size = "md", loading, iconStart, iconEnd, children }: ButtonOwnProps) {
  const iconSize = ICON_SIZE[size];
  return (
    <>
      <span className={styles.content}>
        {renderSlot(iconStart, iconSize)}
        {children !== undefined && children !== null && <span className={styles.label}>{children}</span>}
        {renderSlot(iconEnd, iconSize)}
      </span>
      {loading && (
        <span className={styles.spinner}>
          <Spinner size={iconSize + 1} />
        </span>
      )}
    </>
  );
}

const isLink = (props: ButtonProps): props is ButtonAsLink => typeof props.href === "string";

export function Button(props: ButtonProps) {
  if (isLink(props)) {
    const { variant, size, fullWidth, loading, iconStart, iconEnd, pill, children, className, external, onClick, ref, ...rest } = props;
    const own = { variant, size, fullWidth, loading, iconStart, iconEnd, pill, children, className };
    return (
      <a
        ref={ref}
        {...rest}
        className={classes(own)}
        aria-busy={loading || undefined}
        onClick={(event) => {
          if (loading) {
            event.preventDefault();
            return;
          }
          if (external) onClick?.(event);
          else routeClick(event, { onClick });
        }}
      >
        <Content {...own} />
      </a>
    );
  }
  const { variant, size, fullWidth, loading, iconStart, iconEnd, pill, children, className, type, disabled, ref, ...rest } = props;
  const own = { variant, size, fullWidth, loading, iconStart, iconEnd, pill, children, className };
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes(own)}
    >
      <Content {...own} />
    </button>
  );
}
