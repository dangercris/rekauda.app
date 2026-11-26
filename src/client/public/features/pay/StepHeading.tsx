import type { ReactNode } from "react";
import styles from "./Pay.module.css";

/** Step title: receives the focus after each step change (`data-step-title`). */
export function StepHeading({ title, subtitle, before }: { title: string; subtitle?: ReactNode; before?: ReactNode }) {
  return (
    <div className={styles.stepHead}>
      {before}
      <h2 className={styles.stepTitle} tabIndex={-1} data-step-title="">
        {title}
      </h2>
      {subtitle && <p className={styles.stepSub}>{subtitle}</p>}
    </div>
  );
}
