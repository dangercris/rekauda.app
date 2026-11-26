import { cx } from "../lib/cx";
import { Icon } from "./Icon";
import styles from "./Stepper.module.css";

export interface StepperProps {
  steps: readonly string[];
  /** 0-based index of the current step. */
  current: number;
  /** Accessible name. Default "Progreso". */
  label?: string | undefined;
  className?: string | undefined;
}

/** Progress through a short flow (three steps): done steps show a check, the current one is ringed. */
export function Stepper({ steps, current, label = "Progreso", className }: StepperProps) {
  return (
    <ol aria-label={label} className={cx(styles.stepper, className)}>
      {steps.map((step, index) => {
        const state = index < current ? "done" : index === current ? "current" : "pending";
        return (
          <li key={step} className={cx(styles.step, styles[state])} aria-current={state === "current" ? "step" : undefined}>
            <span className={styles.marker} aria-hidden="true">
              {state === "done" ? <Icon name="check" size={14} strokeWidth={3} /> : index + 1}
            </span>
            <span className={styles.label}>
              <span className="visually-hidden">
                {`Paso ${index + 1} de ${steps.length}${state === "done" ? ", completado" : ""}: `}
              </span>
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
