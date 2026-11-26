import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { formatBytes } from "../lib/format";
import { Button } from "./Button";
import styles from "./FileDrop.module.css";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";

export type FileRejectionReason = "type" | "size";

export const DEFAULT_RECEIPT_ACCEPT: readonly string[] = ["image/*", "application/pdf", ".pdf", ".heic", ".heif"];

/** True when `file` matches one accept entry: exact MIME, "type/*" wildcard or ".ext". */
export function acceptsFile(file: Pick<File, "name" | "type">, accept: readonly string[]): boolean {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (!entry) return false;
    if (entry.startsWith(".")) return name.endsWith(entry);
    if (entry.endsWith("/*")) return type.startsWith(entry.slice(0, -1));
    return type === entry;
  });
}

/**
 * Validates a file. Images skip the size check when `compressible` (they are re-encoded before upload);
 * PDFs and non-compressible files must fit `maxBytes`.
 */
export function checkFile(
  file: Pick<File, "name" | "type" | "size">,
  accept: readonly string[],
  maxBytes: number | undefined,
  compressible = true,
): FileRejectionReason | null {
  if (!acceptsFile(file, accept)) return "type";
  const isImage = file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name);
  if (maxBytes !== undefined && file.size > maxBytes && !(compressible && isImage)) return "size";
  return null;
}

const PREVIEWABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export interface FileDropProps {
  /** Accessible label of the picker, e.g. "Comprobante de pago". */
  label: string;
  value: File | null;
  onChange: (file: File | null) => void;
  accept?: readonly string[] | undefined;
  /** Default 5 MB. See `compressible`. */
  maxBytes?: number | undefined;
  /** Images will be compressed before upload, so only PDFs are size-checked. Default true. */
  compressible?: boolean | undefined;
  onReject?: ((reason: FileRejectionReason, file: File) => void) | undefined;
  /** Title of the empty zone. */
  emptyTitle?: string | undefined;
  /** Second line of the empty zone (formats and size). */
  emptyHint?: string | undefined;
  /** Status line for the selected file (default "Listo para enviar"). */
  readyText?: ReactNode;
  /** Shows a processing state (e.g. while compressing). */
  processing?: boolean | undefined;
  /** External error (server-side); overrides the built-in rejection message. */
  error?: ReactNode;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

const REJECTION_TEXT: Record<FileRejectionReason, string> = {
  type: "Ese archivo no se puede subir. Usa una captura de pantalla (JPG, PNG o WEBP) o un PDF.",
  size: "El archivo pesa más de 5 MB. Sube una captura de pantalla en lugar del PDF.",
};

/** Receipt picker: tap or drag a file, image thumbnail or PDF icon, change/remove, inline errors. */
export function FileDrop({
  label,
  value,
  onChange,
  accept = DEFAULT_RECEIPT_ACCEPT,
  maxBytes = 5 * 1024 * 1024,
  compressible = true,
  onReject,
  emptyTitle = "Toca para elegir la captura",
  emptyHint = "Captura de pantalla o PDF · hasta 5 MB",
  readyText = "Listo para enviar",
  processing,
  error,
  disabled,
  className,
}: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const [rejection, setRejection] = useState<FileRejectionReason | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!value || !PREVIEWABLE.has(value.type) || typeof URL.createObjectURL !== "function") {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const take = (file: File | undefined) => {
    if (!file) return;
    const reason = checkFile(file, accept, maxBytes, compressible);
    if (reason) {
      setRejection(reason);
      onReject?.(reason, file);
      return;
    }
    setRejection(null);
    onChange(file);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    take(event.dataTransfer.files[0]);
  };

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (!disabled) setDragging(true);
  };

  const message = error ?? (rejection ? REJECTION_TEXT[rejection] : null);
  const errorId = message ? `${id}-error` : undefined;
  const isPdf = value?.type === "application/pdf" || value?.name.toLowerCase().endsWith(".pdf");

  const input = (
    <input
      ref={inputRef}
      id={`${id}-input`}
      type="file"
      className="visually-hidden"
      accept={accept.join(",")}
      disabled={disabled}
      aria-invalid={message ? true : undefined}
      aria-describedby={errorId}
      onChange={(event) => {
        take(event.target.files?.[0]);
        event.target.value = "";
      }}
    />
  );

  return (
    <div className={cx(styles.wrap, className)} onDragOver={onDragOver} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      {value ? (
        <div className={cx(styles.selected, dragging && styles.dragging, message && styles.invalid)}>
          <div className={styles.thumb} aria-hidden="true">
            {preview ? (
              <img src={preview} alt="" className={styles.thumbImage} />
            ) : (
              <Icon name={isPdf ? "file-text" : "image"} size={26} />
            )}
          </div>
          <div className={styles.meta}>
            <strong className={styles.name}>{value.name}</strong>
            <span className={styles.size}>
              {isPdf ? "PDF" : "Imagen"} · {formatBytes(value.size)}
            </span>
            {processing ? (
              <span className={styles.processing}>Preparando la imagen…</span>
            ) : !message ? (
              <span className={styles.ready}>
                <Icon name="check" size={14} strokeWidth={2.4} />
                {readyText}
              </span>
            ) : null}
          </div>
          <div className={styles.actions}>
            {input}
            <Button variant="glass" size="sm" disabled={disabled} onClick={() => inputRef.current?.click()} aria-label={`Cambiar ${label.toLowerCase()}`}>
              Cambiar
            </Button>
            <IconButton
              icon="x"
              size={36}
              variant="ghost"
              label={`Quitar ${label.toLowerCase()}`}
              disabled={disabled}
              onClick={() => {
                setRejection(null);
                onChange(null);
              }}
            />
          </div>
        </div>
      ) : (
        <label htmlFor={`${id}-input`} className={cx(styles.zone, dragging && styles.dragging, message && styles.invalid, disabled && styles.disabled)}>
          {input}
          <span className={cx("m-ev", styles.zoneIcon)} aria-hidden="true">
            <Icon name="upload" size={22} />
          </span>
          <span className={styles.zoneText}>
            <span className={styles.zoneTitle}>{emptyTitle}</span>
            <span className={styles.zoneHint}>{emptyHint}</span>
          </span>
          <span className="visually-hidden">{label}</span>
        </label>
      )}
      {message ? (
        <p id={errorId} className={styles.error} role="alert">
          <Icon name="alert-circle" size={15} strokeWidth={2} />
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  );
}
