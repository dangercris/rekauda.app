import type { AnchorHTMLAttributes, ButtonHTMLAttributes, Ref } from "react";
import { cx } from "../lib/cx";
import styles from "./IconButton.module.css";
import { routeClick } from "./Link";
import { renderSlot, type IconSlot } from "./slot";

export type IconButtonVariant = "glass" | "soft" | "ink" | "event" | "ghost" | "on-image";

interface IconButtonOwnProps {
  /** Accessible name (required: the button has no visible text). */
  label: string;
  icon: IconSlot;
  variant?: IconButtonVariant | undefined;
  /** 36, 40 or 44 px circle. Smaller sizes keep a 44px hit area. Default 44. */
  size?: 36 | 40 | 44 | undefined;
  /** Small amber dot (pending items). */
  dot?: boolean | undefined;
  className?: string | undefined;
}

type AsButton = IconButtonOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof IconButtonOwnProps | "children"> & {
    href?: undefined;
    ref?: Ref<HTMLButtonElement> | undefined;
  };

type AsLink = IconButtonOwnProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof IconButtonOwnProps | "children"> & {
    href: string;
    ref?: Ref<HTMLAnchorElement> | undefined;
  };

export type IconButtonProps = AsButton | AsLink;

function classes(p: IconButtonOwnProps): string {
  const variant = p.variant ?? "glass";
  return cx(
    styles.iconButton,
    styles[`s${p.size ?? 44}`],
    styles[variant.replace("-", "_")],
    variant === "glass" && "m-glass",
    variant === "ink" && "m-ink",
    variant === "event" && "m-ev",
    variant === "on-image" && "m-glass-dark",
    p.className,
  );
}

const ICON_SIZE = { 36: 17, 40: 18, 44: 19 } as const;

const isLink = (props: IconButtonProps): props is AsLink => typeof props.href === "string";

export function IconButton(props: IconButtonProps) {
  if (isLink(props)) {
    const { label, icon, variant, size, dot, className, onClick, ref, ...rest } = props;
    return (
      <a ref={ref} {...rest} aria-label={label} className={classes({ label, icon, variant, size, className })} onClick={(e) => routeClick(e, { onClick })}>
        {renderSlot(icon, ICON_SIZE[size ?? 44])}
        {dot && <span className={styles.dot} aria-hidden="true" />}
      </a>
    );
  }
  const { label, icon, variant, size, dot, className, type, ref, ...rest } = props;
  return (
    <button ref={ref} type={type ?? "button"} {...rest} aria-label={label} className={classes({ label, icon, variant, size, className })}>
      {renderSlot(icon, ICON_SIZE[size ?? 44])}
      {dot && <span className={styles.dot} aria-hidden="true" />}
    </button>
  );
}
