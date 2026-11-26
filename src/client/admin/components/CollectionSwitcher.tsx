import type { AdminCollection } from "../../../shared/api";
import { ToneScope } from "../../design";
import { cx } from "../../lib/cx";
import { Chip } from "../../ui";
import styles from "./CollectionSwitcher.module.css";

export interface CollectionSwitcherProps {
  collections: readonly AdminCollection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  className?: string | undefined;
}

/** Glass chips (tone dot per collection) that scope the summary and payment views. Scrolls sideways on phones. */
export function CollectionSwitcher({ collections, selectedId, onSelect, className }: CollectionSwitcherProps) {
  if (collections.length === 0) return null;
  return (
    <div role="group" aria-label="Recaudación" className={cx(styles.switcher, className)}>
      {collections.map((c) => (
        <ToneScope key={c.id} tone={c.tone} as="span" className={styles.item}>
          <Chip dot="event" selected={c.id === selectedId} onClick={() => onSelect(c.id)} className={styles.chip}>
            {c.title}
            {c.status === "cerrada" && <span className={styles.closed}> · cerrada</span>}
          </Chip>
        </ToneScope>
      ))}
    </div>
  );
}
