import type { FormEvent, ReactNode } from "react";
import type { CollectionDetail, TreasuryAccount } from "../../../../shared/api";
import { cx } from "../../../lib/cx";
import { formatMoney, plural, todayEc } from "../../../lib/format";
import { ActionBar, Button, Checkbox, Chip, FileDrop, Icon, Notice, SelectField, TextField } from "../../../ui";
import { errorEntries, isFormField, type FieldKey, type FormField } from "../../lib/validation";
import { submitLabel } from "./payFlow";
import { PaymentDetailsDisclosure } from "./PaymentDetails";
import { StepHeading } from "./StepHeading";
import { StudentBlock } from "./StudentBlock";
import type { PayFlow } from "./usePayFlow";
import styles from "./Pay.module.css";

export interface StepRegisterProps {
  collection: CollectionDetail;
  flow: PayFlow;
  banks: readonly string[] | null;
  /** Shown again, collapsed, so the parent can check the account without leaving the form. */
  treasury: TreasuryAccount;
  onBack: () => void;
  actionBarClassName?: string | undefined;
}

export const CONSENT_TEXT =
  "Autorizo usar estos datos solo para coordinar este pago. En el avance del curso se muestra el primer nombre y la inicial del apellido del estudiante.";

/** Step 2: students, receipt, transfer data and representative, validated like the server. */
export function StepRegister({ collection, flow, banks, treasury, onBack, actionBarClassName }: StepRegisterProps) {
  const { state, dispatch, amount, formRef, honeypotRef } = flow;
  const { fields, errors, students } = state;
  const today = todayEc();
  const atMax = students.length >= state.max;
  const fieldId = (key: FieldKey) => `pay-${key.replace(/\./g, "-")}`;
  const bankOptions = (banks ?? (fields.bank ? [fields.bank] : [])).map((b) => ({ value: b, label: b }));
  const processing = state.receipt?.status === "processing";
  const issueCount = Object.keys(errors).length;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void flow.submit();
  };

  let amountHint: ReactNode;
  if (!amount.expected.complete) amountHint = "Elige la opción de cada estudiante para calcular el total.";
  else if (amount.mismatch)
    amountHint = (
      <span className={styles.warnHint}>
        <Icon name="alert" size={14} strokeWidth={2.2} />
        El total esperado es {formatMoney(amount.expected.total)}. Puedes registrarlo igual; lo revisaremos.
      </span>
    );
  else amountHint = `Total esperado: ${formatMoney(amount.expected.total)}`;

  return (
    <>
      <StepHeading
        before={
          <Button variant="ghost" size="sm" iconStart="arrow-left" onClick={onBack} className={styles.backButton}>
            Regresar
          </Button>
        }
        title="Registra tu pago"
        subtitle={
          <>
            Con estos datos confirmamos tu transferencia.{" "}
            <Chip variant="soft" size="sm" dot className={styles.contextChip}>
              <span className="num">
                {collection.title}
                {amount.expected.complete && amount.expected.total > 0 ? ` · ${formatMoney(amount.expected.total)}` : ""}
              </span>
            </Chip>
          </>
        }
      />

      <form ref={formRef} noValidate autoComplete="on" onSubmit={onSubmit} className={styles.form} aria-label="Registrar pago">
        <fieldset className={cx("m-glass", styles.group)}>
          <legend className={styles.groupTitle}>
            <span>Estudiantes</span>
          </legend>
          {students.map((student, index) => (
            <StudentBlock
              key={student.id}
              student={student}
              index={index}
              total={students.length}
              options={collection.options}
              errors={errors}
              onChange={(field, value) => dispatch({ type: "updateStudent", id: student.id, field, value })}
              onRemove={() => dispatch({ type: "removeStudent", id: student.id })}
            />
          ))}
          {atMax ? (
            state.max > 1 && <p className={styles.hint}>Puedes registrar hasta {plural(state.max, "estudiante", "estudiantes")} por comprobante.</p>
          ) : (
            <Button
              variant="glass"
              iconStart="plus"
              fullWidth
              onClick={() => {
                dispatch({ type: "addStudent" });
                setTimeout(() => flow.focusField(`students.${students.length}.givenNames`), 0);
              }}
            >
              Agregar otro estudiante
            </Button>
          )}
        </fieldset>

        {/* Next to the receipt: the parent checks the account / amount right where they attach the proof. */}
        <PaymentDetailsDisclosure
          treasury={treasury}
          total={amount.expected.complete && amount.expected.total > 0 ? amount.expected.total : null}
          deunaLink={collection.deunaLink}
          collectionSlug={collection.slug}
        />

        <fieldset className={cx("m-glass", styles.group)}>
          <legend className={styles.groupTitle}>
            <span>Comprobante</span>
          </legend>
          <div data-field="receipt">
            <FileDrop
              label="Comprobante de pago"
              value={state.receipt?.file ?? null}
              processing={processing}
              onChange={flow.chooseReceipt}
              onReject={flow.rejectReceipt}
              emptyTitle="Sube la captura o el PDF"
              emptyHint="Desde la app de tu banco · JPG, PNG o PDF hasta 5 MB"
              error={state.receiptError ?? errors.receipt}
              disabled={state.submitting}
            />
          </div>
        </fieldset>

        <fieldset className={cx("m-glass", styles.group)}>
          <legend className={styles.groupTitle}>
            <span>Transferencia</span>
          </legend>
          <div className={styles.grid2}>
            <div data-field="amount">
              <TextField
                id={fieldId("amount")}
                label="Monto transferido"
                prefix="$"
                inputMode="decimal"
                autoComplete="off"
                className="num"
                value={amount.value}
                onChange={(e) => dispatch({ type: "setField", field: "amount", value: e.target.value })}
                error={errors.amount}
                hint={errors.amount ? undefined : amountHint}
              />
            </div>
            <div data-field="transferDate">
              <TextField
                id={fieldId("transferDate")}
                label="Fecha de la transferencia"
                type="date"
                max={today}
                value={fields.transferDate}
                onChange={(e) => dispatch({ type: "setField", field: "transferDate", value: e.target.value })}
                error={errors.transferDate}
              />
            </div>
          </div>
          <div data-field="bank">
            <SelectField
              id={fieldId("bank")}
              label="Desde qué banco"
              placeholder="Elige tu banco o cooperativa"
              options={bankOptions}
              value={fields.bank}
              onChange={(e) => dispatch({ type: "setField", field: "bank", value: e.target.value })}
              error={errors.bank}
            />
          </div>
          <div data-field="reference">
            <TextField
              id={fieldId("reference")}
              label="Número de comprobante"
              optional
              mono
              maxLength={40}
              autoComplete="off"
              value={fields.reference}
              onChange={(e) => dispatch({ type: "setField", field: "reference", value: e.target.value })}
              error={errors.reference}
            />
          </div>
        </fieldset>

        <fieldset className={cx("m-glass", styles.group)}>
          <legend className={styles.groupTitle}>
            <span>Representante</span>
          </legend>
          <div data-field="parentName">
            <TextField
              id={fieldId("parentName")}
              label="Nombre y apellido"
              maxLength={60}
              autoComplete="name"
              autoCapitalize="words"
              value={fields.parentName}
              onChange={(e) => dispatch({ type: "setField", field: "parentName", value: e.target.value })}
              error={errors.parentName}
            />
          </div>
          <div data-field="phone">
            <TextField
              id={fieldId("phone")}
              label="Celular"
              type="tel"
              inputMode="tel"
              maxLength={22}
              autoComplete="tel"
              placeholder="099 123 4567"
              className="num"
              value={fields.phone}
              onChange={(e) => dispatch({ type: "setField", field: "phone", value: e.target.value })}
              error={errors.phone}
              hint="Solo para avisarte si hay algo que corregir."
            />
          </div>
        </fieldset>

        <div data-field="consent" className={cx("m-glass", styles.consent)}>
          <Checkbox
            id={fieldId("consent")}
            label={CONSENT_TEXT}
            checked={fields.consent}
            onChange={(e) => dispatch({ type: "setConsent", value: e.target.checked })}
            error={errors.consent}
          />
        </div>

        <div className={styles.honeypot} aria-hidden="true">
          <label htmlFor="hp_c9x">No llenar este campo</label>
          <input ref={honeypotRef} id="hp_c9x" name="hp_c9x" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>

        {state.summary && issueCount > 0 && (
          <div role="alert" className={cx("m-glass", styles.summary)}>
            <span className={styles.summaryHead}>
              <Icon name="alert-circle" size={18} strokeWidth={2.2} />
              <strong>{state.summary}</strong>
            </span>
            {issueCount > 1 && (
              <ul role="list" className={styles.summaryList}>
                {errorEntries(errors).map(([key, message]) => (
                  <li key={key}>
                    <button type="button" className={styles.summaryLink} onClick={() => flow.focusField(key)}>
                      {summaryLabel(key, students.length)}: {message}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {state.serverError && <Notice tone="bad" icon="alert-circle" title="No se pudo registrar el pago" description={state.serverError} live />}

        <ActionBar className={actionBarClassName}>
          <Button type="submit" size="md" fullWidth loading={state.submitting} disabled={processing}>
            <span className="num">{processing ? "Preparando el comprobante…" : submitLabel(amount)}</span>
          </Button>
        </ActionBar>
      </form>
    </>
  );
}

const FIELD_LABELS: Record<FormField, string> = {
  receipt: "Comprobante",
  amount: "Monto",
  transferDate: "Fecha",
  bank: "Banco",
  reference: "Número de comprobante",
  parentName: "Representante",
  phone: "Celular",
  consent: "Autorización",
};

function summaryLabel(key: FieldKey, total: number): string {
  const match = /^students\.(\d+)\.(givenNames|surnames|option)$/.exec(key);
  if (match) {
    const n = Number(match[1]) + 1;
    const field = match[2] === "givenNames" ? "Nombres" : match[2] === "surnames" ? "Apellidos" : "Opción";
    return total > 1 ? `${field} del estudiante ${n}` : field;
  }
  return isFormField(key) ? FIELD_LABELS[key] : key;
}
