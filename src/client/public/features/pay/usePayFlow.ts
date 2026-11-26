import { useCallback, useEffect, useMemo, useReducer, useRef, type Dispatch, type RefObject } from "react";
import type { CollectionDetail } from "../../../../shared/api";
import type { Instance } from "../../../../shared/instance";
import { createPayment, errorMessage, isApiRequestError } from "../../../lib/publicApi";
import { todayEc } from "../../../lib/format";
import { ImageProcessingError, MAX_UPLOAD_BYTES, prepareReceipt } from "../../../lib/image";
import { track } from "../../lib/analytics";
import { saveCode } from "../../lib/codes";
import { normalizePersonName, cleanText, summarize, validatePayment, type FieldKey } from "../../lib/validation";
import {
  initPayState,
  payReducer,
  selectAmount,
  toPaymentValues,
  type AmountStatus,
  type PayAction,
  type PayState,
} from "./payFlow";
import { clearDraft, loadDraft, usePayDraft } from "./usePayDraft";

export interface PayFlow {
  state: PayState;
  dispatch: Dispatch<PayAction>;
  amount: AmountStatus;
  /** Hidden honeypot input value (bots fill it, people never see it). */
  honeypotRef: RefObject<HTMLInputElement | null>;
  formRef: RefObject<HTMLFormElement | null>;
  chooseReceipt: (file: File | null) => void;
  rejectReceipt: () => void;
  submit: () => Promise<void>;
  focusField: (field: FieldKey) => void;
  /** Back to step 1 keeping what was typed ("Registrar de nuevo" after an observation). */
  restart: () => void;
}

const UNREADABLE = "No pudimos leer esa imagen. Sube una captura de pantalla en JPG o PNG, o el PDF del comprobante.";
const TOO_BIG = "El comprobante supera los 5 MB. Sube una captura de pantalla en lugar de la foto o del PDF completo.";

const FOCUSABLE = 'input:not([type="hidden"]), select, textarea, button';

/** What payment validation needs from the tenant config. */
export type PayFormConfig = Pick<Instance, "banks" | "earliestTransferDate" | "earliestTransferLabel">;

export interface UsePayFlowOptions {
  collection: CollectionDetail;
  /** The tenant values the form validates against. */
  form: PayFormConfig;
  /** Payments can only be registered while the collection is open (no drafts otherwise). */
  enabled: boolean;
  onRegistered?: ((code: string) => void) | undefined;
}

export function usePayFlow({ collection, form, enabled, onRegistered }: UsePayFlowOptions): PayFlow {
  const { slug, options, maxPerPayment } = collection;
  const [state, dispatch] = useReducer(payReducer, undefined, () =>
    initPayState({ options, maxPerPayment, today: todayEc(), draft: enabled ? loadDraft(slug) : null }),
  );
  usePayDraft(slug, state, enabled);

  const amount = useMemo(() => selectAmount(state, options), [state, options]);
  const honeypotRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const receiptToken = useRef(0);
  const submitController = useRef<AbortController | null>(null);
  const onRegisteredRef = useRef(onRegistered);
  onRegisteredRef.current = onRegistered;

  useEffect(
    () => () => {
      receiptToken.current += 1;
      // An in-flight submission is NOT aborted on unmount: the server may already have stored the
      // payment, and the handler below still saves the tracking code so the family can find it.
    },
    [],
  );

  const chooseReceipt = useCallback((file: File | null) => {
    receiptToken.current += 1;
    const token = receiptToken.current;
    if (!file) {
      dispatch({ type: "receiptCleared" });
      return;
    }
    dispatch({ type: "receiptProcessing", file });
    prepareReceipt(file).then(
      (ready) => {
        if (token !== receiptToken.current) return;
        if (ready.size > MAX_UPLOAD_BYTES) dispatch({ type: "receiptFailed", message: TOO_BIG });
        else dispatch({ type: "receiptReady", file: ready });
      },
      (error: unknown) => {
        if (token !== receiptToken.current) return;
        dispatch({ type: "receiptFailed", message: error instanceof ImageProcessingError ? error.message : UNREADABLE });
      },
    );
  }, []);

  const rejectReceipt = useCallback(() => {
    receiptToken.current += 1;
    dispatch({ type: "receiptCleared" });
  }, []);

  const focusField = useCallback((field: FieldKey) => {
    const holder = formRef.current?.querySelector<HTMLElement>(`[data-field="${field}"]`);
    if (!holder) return;
    const target = holder.querySelector<HTMLElement>(FOCUSABLE) ?? holder;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    holder.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "center" });
    target.focus({ preventScroll: true });
  }, []);

  const submit = useCallback(async () => {
    if (state.submitting) return;
    if (state.receipt?.status === "processing") return;
    const values = toPaymentValues(state, amount.value);
    const issues = validatePayment(values, {
      optionKeys: options.map((o) => o.key),
      banks: form.banks,
      earliestTransferDate: form.earliestTransferDate,
      earliestTransferLabel: form.earliestTransferLabel,
    });
    const first = issues[0];
    if (first) {
      dispatch({ type: "invalid", issues, summary: summarize(issues) });
      setTimeout(() => focusField(first.field), 0);
      return;
    }
    const receipt = state.receipt?.file;
    if (!receipt || amount.cents === null) return;
    const students = state.students.map((s) => ({
      givenNames: normalizePersonName(s.givenNames),
      surnames: normalizePersonName(s.surnames),
      option: s.option ?? "",
    }));
    submitController.current?.abort();
    const controller = new AbortController();
    submitController.current = controller;
    dispatch({ type: "submitStart" });
    try {
      const response = await createPayment(
        {
          collection: slug,
          students,
          parentName: normalizePersonName(state.fields.parentName),
          phone: state.fields.phone.trim(),
          transferDate: state.fields.transferDate,
          bank: state.fields.bank,
          amountCents: amount.cents,
          reference: cleanText(state.fields.reference, 40) || null,
          receipt,
          honeypot: honeypotRef.current?.value ?? "",
        },
        { signal: controller.signal },
      );
      saveCode(response.code);
      clearDraft(slug);
      dispatch({ type: "submitSuccess", result: { code: response.code, students, amountCents: amount.cents }, today: todayEc() });
      track("payment_submitted", { collection: slug, students: students.length });
      onRegisteredRef.current?.(response.code);
    } catch (error) {
      if (isApiRequestError(error) && error.code === "aborted") return;
      track("payment_failed", { collection: slug, error_code: isApiRequestError(error) ? error.code : "unknown" });
      dispatch({ type: "submitFailure", message: errorMessage(error) });
    }
  }, [state, amount, options, form, slug, focusField]);

  const restart = useCallback(() => dispatch({ type: "goTo", step: 1 }), []);

  return { state, dispatch, amount, honeypotRef, formRef, chooseReceipt, rejectReceipt, submit, focusField, restart };
}
