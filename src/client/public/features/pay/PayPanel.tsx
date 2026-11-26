import { useEffect, useRef } from "react";
import type { CollectionDetail } from "../../../../shared/api";
import { cx } from "../../../lib/cx";
import { Stepper } from "../../../ui";
import { useInstanceConfig } from "../../../lib/config/useInstance";
import { scrollToTop } from "../../hooks/ui";
import { track } from "../../lib/analytics";
import { StepDone } from "./StepDone";
import { StepRegister } from "./StepRegister";
import { StepTransfer } from "./StepTransfer";
import type { PayFlow } from "./usePayFlow";
import styles from "./Pay.module.css";

export interface PayPanelProps {
  collection: CollectionDetail;
  flow: PayFlow;
  active: boolean;
  onViewStatus: (code: string) => void;
  actionBarClassName?: string | undefined;
}

const STEPS = ["Transfiere", "Registra", "Listo"] as const;

/** Guided payment: transfer, register, done. Each step change scrolls up and focuses the step title. */
export function PayPanel({ collection, flow, active, onViewStatus, actionBarClassName }: PayPanelProps) {
  const { treasury, banks } = useInstanceConfig();
  const { state, dispatch } = flow;
  const panelRef = useRef<HTMLDivElement>(null);
  const lastStep = useRef(state.step);

  const slug = collection.slug;
  const step = state.step;
  useEffect(() => {
    if (active) track("pay_step_view", { step, collection: slug });
  }, [active, step, slug]);

  useEffect(() => {
    if (lastStep.current === state.step) return;
    lastStep.current = state.step;
    if (!active) return;
    scrollToTop();
    const frame = setTimeout(() => {
      scrollToTop();
      panelRef.current?.querySelector<HTMLElement>("[data-step-title]")?.focus({ preventScroll: true });
    });
    return () => clearTimeout(frame);
  }, [state.step, active]);

  return (
    <div ref={panelRef} className={styles.panel}>
      <h2 className="visually-hidden">Pagar</h2>
      <Stepper steps={STEPS} current={state.step - 1} label="Pasos para pagar" className={styles.stepper} />
      <div key={state.step} className={cx(styles.step, state.direction === "forward" && styles.enterForward, state.direction === "back" && styles.enterBack)}>
        {state.step === 1 && (
          <StepTransfer
            collection={collection}
            count={state.count}
            onCount={(count) => dispatch({ type: "setCount", count })}
            treasury={treasury}
            onNext={() => dispatch({ type: "goTo", step: 2 })}
            actionBarClassName={actionBarClassName}
          />
        )}
        {state.step === 2 && (
          <StepRegister
            collection={collection}
            flow={flow}
            banks={banks}
            treasury={treasury}
            onBack={() => dispatch({ type: "goTo", step: 1 })}
            actionBarClassName={actionBarClassName}
          />
        )}
        {state.step === 3 && state.result && (
          <StepDone collection={collection} result={state.result} onViewStatus={onViewStatus} onAnother={() => dispatch({ type: "startAnother" })} />
        )}
      </div>
    </div>
  );
}
