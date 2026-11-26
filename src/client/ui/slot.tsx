import { isValidElement, type ReactElement } from "react";
import { Icon, type IconName } from "./Icon";

/** An icon slot accepts an icon name or any element (e.g. a custom svg or an Avatar). */
export type IconSlot = IconName | ReactElement;

export function renderSlot(slot: IconSlot | undefined, size: number, strokeWidth?: number) {
  if (slot === undefined) return null;
  if (isValidElement(slot)) return slot;
  return <Icon name={slot} size={size} strokeWidth={strokeWidth} />;
}
