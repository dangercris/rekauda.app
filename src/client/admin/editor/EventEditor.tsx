import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from "react";
import type { AdminCollection, CollectionStatus } from "../../../shared/api";
import { EventThemeProvider } from "../../design";
import { createCollection, deleteCover, errorMessage, updateCollection, uploadCover } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { useInstanceConfig } from "../../lib/config/useInstance";
import { formatMoney, longDate } from "../../lib/format";
import { navigate } from "../../lib/router";
import {
  ActionBar,
  AmbientBackground,
  Button,
  Card,
  Chip,
  Hero,
  IconTile,
  InlineConfirm,
  Notice,
  SegmentedBar,
  SegmentedControl,
  SelectField,
  Spinner,
  SwatchPicker,
  TextArea,
  TextField,
  TopBar,
  useToast,
} from "../../ui";
import { useEyebrow } from "../components/common";
import { useAdminData } from "../data/AdminData";
import { useUnsavedGuard } from "../navigation";
import { useApiErrorGate } from "../session/SessionContext";
import { COVER_ACCEPT, CoverError, prepareCover } from "./coverFile";
import {
  MAX_NOTES,
  TONE_PRESETS,
  editorReducer,
  firstErrorKey,
  initEditor,
  isDirty,
  mapServerError,
  parsePrice,
  splitNotes,
  toInput,
  validateDraft,
  type FieldErrors,
  type FieldKey,
} from "./editorState";
import styles from "./EventEditor.module.css";
import { OptionsField, optionFieldId } from "./OptionsField";
import { suggestToneFromImage } from "./toneSuggest";

const STATUS_OPTIONS: ReadonlyArray<{ value: CollectionStatus; label: string }> = [
  { value: "abierta", label: "Abierta" },
  { value: "cerrada", label: "Cerrada" },
  { value: "archivada", label: "Archivada" },
];

const STATUS_HINT: Record<CollectionStatus, string> = {
  abierta: "Las familias ven el enlace y pueden registrar pagos.",
  cerrada: "Se ve el enlace, pero ya no se pueden registrar pagos.",
  archivada: "Se oculta del público. Puedes restaurarla después.",
};

type PlainField = Exclude<FieldKey, `option:${string}`>;

const FIELD_ID: Record<PlainField, string> = {
  title: "ev-title",
  slug: "ev-slug",
  eyebrow: "ev-eyebrow",
  description: "ev-description",
  notes: "ev-notes",
  options: "ev-add-option",
  deadline: "ev-deadline",
  maxPerPayment: "ev-max",
  tone: "ev-tone",
  deunaLink: "ev-deuna-link",
  deunaLinkExpires: "ev-deuna-expires",
};

const isPlainField = (key: FieldKey): key is PlainField => !key.startsWith("option:");

function fieldId(key: FieldKey): string | null {
  if (isPlainField(key)) return FIELD_ID[key];
  const match = /^option:(.+):(label|detail|price|key)$/.exec(key);
  const uid = match?.[1];
  const field = match?.[2];
  if (!uid) return null;
  if (field === "label" || field === "detail" || field === "price" || field === "key") return optionFieldId(uid, field);
  return null;
}

function focusField(key: FieldKey | null): void {
  const id = key ? fieldId(key) : null;
  if (!id) return;
  const element = document.getElementById(id);
  if (element instanceof HTMLElement) {
    element.focus();
    element.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }
}

function priceLabel(prices: number[]): string | null {
  const valid = prices.filter((p) => p > 0);
  if (valid.length === 0) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  return min === max ? formatMoney(min) : `Desde ${formatMoney(min)}`;
}

export interface EventEditorProps {
  /** null creates a new collection. */
  collection: AdminCollection | null;
}

/** AdminEvento: details, options, tone and cover of a collection, with a live preview of the public header. */
export function EventEditor({ collection }: EventEditorProps) {
  const { upsert, reload } = useAdminData().collections;
  const { select } = useAdminData();
  const { defaultTone } = useInstanceConfig();
  const treasuryEyebrow = useEyebrow();
  const gate = useApiErrorGate();
  const toast = useToast();
  const [state, dispatch] = useReducer(editorReducer, undefined, () => initEditor(collection, defaultTone));
  const [saving, setSaving] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = isDirty(state);
  const guard = useUnsavedGuard(dirty && !saving);
  const { draft, errors } = state;

  // Preview URL for a cover picked but not uploaded yet.
  const [localCover, setLocalCover] = useState<string | null>(null);
  const pickedFile = state.cover.kind === "replace" ? state.cover.file : null;
  useEffect(() => {
    if (!pickedFile || typeof URL.createObjectURL !== "function") {
      setLocalCover(null);
      return undefined;
    }
    const url = URL.createObjectURL(pickedFile);
    setLocalCover(url);
    return () => URL.revokeObjectURL(url);
  }, [pickedFile]);

  const coverUrl = state.cover.kind === "replace" ? localCover : state.cover.kind === "remove" ? null : (collection?.coverUrl ?? null);
  const hasCover = coverUrl !== null;
  const price = useMemo(() => priceLabel(draft.options.map((o) => parsePrice(o.price) ?? 0)), [draft.options]);
  const notesCount = splitNotes(draft.notes).length;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const title = draft.title.trim() || (collection ? collection.title : "Nueva recaudación");
  const eyebrow = draft.eyebrow.trim() || (draft.deadline ? `Hasta el ${longDate(draft.deadline)}` : "Fecha límite por definir");

  const pickCover = async (file: File | undefined) => {
    if (!file) return;
    setCoverError(null);
    setCoverBusy(true);
    try {
      const ready = await prepareCover(file);
      dispatch({ type: "cover", change: { kind: "replace", file: ready } });
      setSuggested(null);
    } catch (error) {
      setCoverError(error instanceof CoverError ? error.message : "No pudimos preparar la imagen. Prueba con otra.");
    } finally {
      setCoverBusy(false);
    }
  };

  const removeCover = () => {
    setCoverError(null);
    setSuggested(null);
    dispatch({ type: "cover", change: collection?.coverUrl ? { kind: "remove" } : { kind: "keep" } });
  };

  const suggestTone = async () => {
    const source = pickedFile ?? coverUrl;
    if (!source) return;
    setSuggesting(true);
    const tone = await suggestToneFromImage(source);
    setSuggesting(false);
    if (tone) {
      setSuggested(tone);
      dispatch({ type: "tone", value: tone });
      toast.show({ message: `Tono ${tone} tomado de la portada.`, tone: "ok" });
    } else {
      toast.show({ message: "La portada no tiene un color con suficiente intensidad. Elige uno de la lista.", tone: "info" });
    }
  };

  const save = async (thenCopy: boolean) => {
    if (saving) return;
    const found: FieldErrors = validateDraft(draft);
    dispatch({ type: "submitted", errors: found });
    if (Object.keys(found).length > 0) {
      focusField(firstErrorKey(found, draft));
      toast.show({ message: "Revisa los campos marcados.", tone: "error" });
      return;
    }
    setSaving(true);
    try {
      const input = toInput(draft, state.defaultTone);
      let saved: AdminCollection;
      if (collection) {
        saved = (await updateCollection(collection.id, input)).collection;
      } else {
        saved = (await createCollection(input)).collection;
        // The collection now exists: switch to edit mode BEFORE the cover upload, so a failure there
        // (e.g. an expired session) never leaves the editor in "new" mode, where the next save
        // would try to create the same slug again (slug_taken).
        upsert(saved);
        navigate(`#evento/${saved.id}`, { replace: true });
      }
      let coverWarning: string | null = null;
      try {
        if (state.cover.kind === "replace") saved = (await uploadCover(saved.id, state.cover.file)).collection;
        else if (state.cover.kind === "remove" && saved.coverUrl) saved = (await deleteCover(saved.id)).collection;
      } catch (error) {
        if (gate(error)) return;
        coverWarning = errorMessage(error);
      }
      upsert(saved);
      if (!collection && saved.status !== "archivada") select(saved.id);
      void reload({ silent: true });
      if (thenCopy) {
        const ok = await copyText(`${origin}/r/${saved.slug}`);
        toast.show(ok ? { message: "Guardado. Enlace copiado para WhatsApp.", tone: "ok" } : { message: `Guardado. Copia el enlace: ${origin}/r/${saved.slug}`, tone: "info", duration: 8000 });
      } else {
        toast.show({ message: collection ? "Cambios guardados." : "Recaudación creada.", tone: "ok" });
      }
      if (coverWarning) toast.show({ message: `La portada no se pudo guardar: ${coverWarning}`, tone: "error" });
      // Saved: nothing is unsaved any more, so the guard stays down while leaving.
      dispatch({ type: "reset", collection: saved });
      guard.leave("#eventos");
    } catch (error) {
      if (gate(error)) return;
      const mapped = mapServerError(error, draft);
      dispatch({ type: "serverError", errors: mapped.errors, formError: mapped.formError });
      const key = firstErrorKey(mapped.errors, draft);
      if (key) focusField(key);
      toast.show({ message: mapped.formError ?? "Revisa los campos marcados.", tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save(false);
  };

  return (
    <EventThemeProvider tone={draft.tone} coverUrl={coverUrl} as="div" className={styles.theme}>
      <AmbientBackground />
      <TopBar
        title={collection ? "Editar evento" : "Nueva recaudación"}
        onBack={() => navigate("#eventos")}
        backIcon="x"
        backLabel={dirty ? "Cerrar sin guardar" : "Cerrar"}
        trailing={
          <Button variant="ink" size="sm" type="submit" form="event-form" loading={saving}>
            Guardar
          </Button>
        }
      />

      {guard.pending !== null && (
        <InlineConfirm
          title="Tienes cambios sin guardar"
          description="Si sales ahora, se pierden los cambios de esta recaudación."
          confirmLabel="Descartar cambios"
          cancelLabel="Seguir editando"
          onConfirm={() => guard.leave()}
          onCancel={guard.stay}
        />
      )}
      {state.formError && <Notice tone="bad" icon="alert-circle" title="No se pudo guardar" description={state.formError} live />}

      <div className={styles.layout}>
        <section className={styles.previewArea} aria-label="Vista previa y portada">
          <Hero
            size="md"
            headingLevel={2}
            eyebrow={eyebrow}
            title={title}
            coverAlt={hasCover ? `Portada de ${title}` : ""}
            topStart={<Chip variant="on-image">Vista previa</Chip>}
            topEnd={
              <Button variant="on-image" size="sm" iconStart="image" onClick={() => fileRef.current?.click()} loading={coverBusy} disabled={saving}>
                {hasCover ? "Cambiar imagen" : "Subir portada"}
              </Button>
            }
            aside={price ? <Chip variant="event">{price}</Chip> : undefined}
          />
          <input
            ref={fileRef}
            type="file"
            accept={COVER_ACCEPT}
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              void pickCover(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <div className={styles.coverRow}>
            <span className={styles.coverText}>
              {coverBusy ? (
                <>
                  <Spinner size={14} /> Preparando la imagen…
                </>
              ) : state.cover.kind === "replace" ? (
                "Portada nueva: se sube al guardar."
              ) : state.cover.kind === "remove" ? (
                "La portada se quitará al guardar."
              ) : hasCover ? (
                "JPG, PNG o WEBP. Las fotos grandes se reducen solas."
              ) : (
                "Sin portada: se usa una ilustración con el tono."
              )}
            </span>
            {hasCover && (
              <Button variant="ghost" size="sm" iconStart="trash" onClick={removeCover} disabled={saving || coverBusy}>
                Quitar
              </Button>
            )}
            {state.cover.kind !== "keep" && (
              <Button variant="ghost" size="sm" iconStart="undo" onClick={() => dispatch({ type: "cover", change: { kind: "keep" } })} disabled={saving}>
                Deshacer
              </Button>
            )}
          </div>
          {coverError && (
            <p className={styles.error} role="alert">
              {coverError}
            </p>
          )}
        </section>

        <Card as="section" radius="2xl" padding="lg" gap={16} className={styles.toneArea} aria-labelledby="tone-title">
          <div className={styles.cardHead}>
            <IconTile icon="palette" size={40} tone="event" />
            <span className={styles.cardHeadText}>
              <h2 id="tone-title" className={styles.cardTitle}>
                Tono del evento
              </h2>
              <span className={styles.muted}>Colorea botones, avance y la luz de fondo del enlace.</span>
            </span>
          </div>
          <div id="ev-tone" tabIndex={-1}>
            <SwatchPicker legend="Tono del evento" hideLegend swatches={TONE_PRESETS} value={draft.tone} onChange={(hex) => dispatch({ type: "tone", value: hex })} />
          </div>
          {errors.tone && <p className={styles.error}>{errors.tone}</p>}
          <div className={styles.suggest}>
            <Button variant="soft" size="sm" iconStart="sparkle" onClick={() => void suggestTone()} loading={suggesting} disabled={!hasCover || coverBusy}>
              Sugerir desde la portada
            </Button>
            <span className={styles.muted}>
              {hasCover ? (suggested ? `Sugerido: ${suggested}` : "Toma el color dominante de la imagen.") : "Sube una portada para sugerir un tono."}
            </span>
          </div>
          <SegmentedBar
            size="md"
            legend
            label="Uso del color: 60 por ciento principal, 30 luz ambiental, 10 detalles"
            segments={[
              { key: "ev", value: 60, color: "event", label: "Botones y avance", display: "60" },
              { key: "ev2", value: 30, color: "var(--ev2)", label: "Luz ambiental", display: "30" },
              { key: "ev3", value: 10, color: "var(--ev3)", label: "Detalles", display: "10" },
            ]}
          />
        </Card>

        <form id="event-form" className={styles.formArea} onSubmit={onSubmit} noValidate aria-label="Datos de la recaudación">
          <Card as="section" radius="2xl" padding="lg" gap={14} aria-labelledby="data-title">
            <h2 id="data-title" className={styles.cardTitle}>
              Datos del evento
            </h2>
            <TextField
              id="ev-title"
              label="Título"
              placeholder="Paseo al Cotopaxi"
              value={draft.title}
              maxLength={80}
              autoComplete="off"
              disabled={saving}
              onChange={(e) => dispatch({ type: "field", field: "title", value: e.target.value })}
              error={errors.title}
            />
            <TextField
              id="ev-slug"
              label="Enlace"
              prefix="/r/"
              mono
              value={draft.slug}
              maxLength={48}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={saving}
              onChange={(e) => dispatch({ type: "field", field: "slug", value: e.target.value })}
              error={errors.slug}
              hint={draft.slug.trim() ? `Dirección: ${origin}/r/${draft.slug.trim()}` : "Se sugiere a partir del título. Solo minúsculas, números y guiones."}
            />
            <TextField
              id="ev-eyebrow"
              label="Etiqueta"
              optional
              placeholder="Paseo del curso"
              value={draft.eyebrow}
              maxLength={40}
              autoComplete="off"
              disabled={saving}
              onChange={(e) => dispatch({ type: "field", field: "eyebrow", value: e.target.value })}
              error={errors.eyebrow}
              hint="Texto corto sobre el título."
            />
            <TextArea
              id="ev-description"
              label="Descripción"
              rows={3}
              value={draft.description}
              maxLength={400}
              disabled={saving}
              onChange={(e) => dispatch({ type: "field", field: "description", value: e.target.value })}
              error={errors.description}
              hint={`${draft.description.trim().length}/400 · lo ven las familias antes de pagar.`}
            />
            <TextArea
              id="ev-notes"
              label="Notas"
              optional
              rows={4}
              placeholder="Una nota por línea"
              value={draft.notes}
              disabled={saving}
              onChange={(e) => dispatch({ type: "field", field: "notes", value: e.target.value })}
              error={errors.notes}
              hint={`${notesCount} de ${MAX_NOTES} notas · una por línea, hasta 200 caracteres cada una.`}
            />
          </Card>

          <Card as="section" radius="2xl" padding="lg" gap={14} aria-labelledby="options-title">
            <div className={styles.sectionHead}>
              <h2 id="options-title" className={styles.cardTitle}>
                Opciones y precios
              </h2>
              <span className={styles.muted}>Hasta 6. Una opción con estudiantes registrados no se puede quitar.</span>
            </div>
            {errors.options && (
              <p className={styles.error} role="alert">
                {errors.options}
              </p>
            )}
            <OptionsField options={draft.options} errors={errors} dispatch={dispatch} disabled={saving} />
          </Card>

          <Card as="section" radius="2xl" padding="lg" gap={14} aria-labelledby="rules-title">
            <h2 id="rules-title" className={styles.cardTitle}>
              Plazo y reglas
            </h2>
            <div className={styles.twoCols}>
              <TextField
                id="ev-deadline"
                label="Fecha límite"
                type="date"
                value={draft.deadline}
                disabled={saving}
                onChange={(e) => dispatch({ type: "field", field: "deadline", value: e.target.value })}
                error={errors.deadline}
                hint={draft.deadline && !errors.deadline ? longDate(draft.deadline, true) : undefined}
              />
              <SelectField
                id="ev-max"
                label="Estudiantes por comprobante"
                value={String(draft.maxPerPayment)}
                disabled={saving}
                options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))}
                onChange={(e) => dispatch({ type: "maxPerPayment", value: Number(e.target.value) })}
                error={errors.maxPerPayment}
              />
            </div>
            <div className={styles.statusField}>
              <span className={styles.label} aria-hidden="true">
                Estado
              </span>
              <SegmentedControl label="Estado de la recaudación" options={STATUS_OPTIONS} value={draft.status} onChange={(value) => dispatch({ type: "status", value })} />
              <span className={styles.muted}>{STATUS_HINT[draft.status]}</span>
            </div>
          </Card>

          <Card as="section" radius="2xl" padding="lg" gap={14} aria-labelledby="deuna-title">
            <h2 id="deuna-title" className={styles.cardTitle}>
              Pago con Deuna
            </h2>
            <TextField
              id="ev-deuna-link"
              label="Link de cobro de Deuna"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://pagar.deuna.app/..."
              value={draft.deunaLink}
              disabled={saving}
              onChange={(e) => dispatch({ type: "field", field: "deunaLink", value: e.target.value })}
              error={errors.deunaLink}
              hint="Opcional. Pega el link de cobro que genera Deuna; los padres lo abrirán para pagar el monto exacto."
            />
            <TextField
              id="ev-deuna-expires"
              label="Válido hasta"
              type="date"
              value={draft.deunaLinkExpires}
              disabled={saving}
              onChange={(e) => dispatch({ type: "field", field: "deunaLinkExpires", value: e.target.value })}
              error={errors.deunaLinkExpires}
              hint={draft.deunaLinkExpires && !errors.deunaLinkExpires ? longDate(draft.deunaLinkExpires, true) : "Opcional. Después de esta fecha el link deja de mostrarse."}
            />
          </Card>
        </form>

        <section className={styles.shareArea} aria-hidden="true">
          <h2 className={styles.cardTitle}>Vista previa en WhatsApp</h2>
          <Card radius="xl" padding="sm" gap={8}>
            <Hero size="sm" headingLevel={2} eyebrow={treasuryEyebrow} title={title} aside={price ? <Chip variant="event" size="sm">{price}</Chip> : undefined} />
            <span className={styles.shareText}>
              <strong>{price ? `${title} · ${price}` : title}</strong>
              <span className={styles.muted}>
                {draft.deadline ? `Paga hasta el ${longDate(draft.deadline)} y sube tu comprobante.` : "Paga y sube tu comprobante."}
              </span>
              <span className={styles.shareUrl}>{`${origin.replace(/^https?:\/\//, "")}/r/${draft.slug.trim() || "enlace"}`}</span>
            </span>
          </Card>
        </section>
      </div>

      <ActionBar className={styles.actionBar}>
        <Button size="lg" fullWidth iconStart="share" loading={saving} onClick={() => void save(true)}>
          Guardar y copiar enlace para WhatsApp
        </Button>
      </ActionBar>
    </EventThemeProvider>
  );
}
