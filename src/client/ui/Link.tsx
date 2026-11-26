import type { AnchorHTMLAttributes, MouseEvent, Ref } from "react";
import { navigate, shouldBypassRouter } from "../lib/router";

/** True for URLs the in-app router should handle ("/x", "#tab", "?q=1"). */
export function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//") ? true : href.startsWith("#") || href.startsWith("?");
}

/**
 * Click handler for anchors: same-origin internal links navigate through the router
 * (no page reload); everything else is left to the browser.
 */
export function routeClick(
  event: MouseEvent<HTMLAnchorElement>,
  options: { replace?: boolean | undefined; onClick?: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined } = {},
): void {
  options.onClick?.(event);
  const anchor = event.currentTarget;
  const href = anchor.getAttribute("href");
  if (!href || !isInternalHref(href) || shouldBypassRouter(event, anchor)) return;
  event.preventDefault();
  navigate(href, { replace: options.replace });
}

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  /** Replace the current history entry instead of pushing. */
  replace?: boolean | undefined;
  ref?: Ref<HTMLAnchorElement> | undefined;
}

/** Anchor that routes internally without a reload. Plain styling: wrap or pass className. */
export function Link({ replace, onClick, ref, ...rest }: LinkProps) {
  return <a ref={ref} {...rest} onClick={(event) => routeClick(event, { replace, onClick })} />;
}
