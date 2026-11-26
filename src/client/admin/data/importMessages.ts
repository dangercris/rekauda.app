import type { DeunaImportResult } from "../../../shared/api";

export interface ImportOutcome {
  tone: "ok" | "info" | "bad";
  message: string;
  /** True when the movement lists should be refreshed. */
  changed: boolean;
}

const DKIM_REASONS: Record<string, string> = {
  no_signature: "el correo no trae firma de Deuna (reenviarlo o copiarlo la pierde, descarga el mensaje original)",
  malformed_message: "el archivo no parece un correo completo",
  multiple_from: "el correo tiene más de un remitente",
  malformed_signature: "la firma del correo está dañada",
  unsupported_version: "la firma usa una versión no compatible",
  unsupported_algorithm: "la firma usa un algoritmo no compatible",
  unsupported_canonicalization: "la firma usa un formato no compatible",
  body_length_limit: "la firma cubre solo una parte del mensaje",
  from_not_signed: "la firma no cubre al remitente",
  domain_mismatch: "la firma no es de deunaapp.com",
  expired: "la firma venció",
  key_unavailable: "no se pudo consultar la clave de Deuna, intenta de nuevo en unos minutos",
  key_invalid: "la clave publicada por Deuna no es válida",
  body_hash_mismatch: "el contenido del correo fue modificado",
  signature_mismatch: "la firma no coincide, el correo fue modificado",
};

const MISSING_PIECES: Record<string, string> = {
  details_heading: "falta el bloque de detalles del pago",
  intro: "falta la frase de la transferencia recibida",
  transaction_number: "número de transacción",
  amount: "monto",
  amount_matches_intro: "el monto no coincide",
  payer_name: "nombre del ordenante",
  payer_matches_intro: "el nombre no coincide",
  date: "fecha",
  destination_account: "cuenta de destino",
};

/** Spanish message for each import result. */
export function describeImport(result: DeunaImportResult): ImportOutcome {
  switch (result.status) {
    case "stored":
      return result.matched
        ? { tone: "ok", message: `Registrado y vinculado a ${result.paymentCode ?? "un pago"}.`, changed: true }
        : { tone: "info", message: "Registrado sin asignar. Vincúlalo a un pago en la lista de abajo.", changed: true };
    case "duplicate":
      return { tone: "info", message: "Ya estaba registrado.", changed: true };
    case "ignored":
      switch (result.reason) {
        case "dkim_failed":
        case "dkim_unavailable":
          return {
            tone: "bad",
            message: `No se pudo verificar: ${DKIM_REASONS[result.detail ?? ""] ?? "la firma de Deuna no es válida"}.`,
            changed: false,
          };
        case "sender_not_deuna":
          return { tone: "bad", message: "No se pudo verificar: el correo no viene de notificaciones@deunaapp.com.", changed: false };
        case "wrong_account":
          return { tone: "bad", message: "La transferencia no es para la cuenta de la tesorería.", changed: false };
        case "too_large":
          return { tone: "bad", message: "El archivo supera 1 MB.", changed: false };
        case "invalid_message":
          return { tone: "bad", message: "El archivo no parece un correo.", changed: false };
        case "not_a_payment": {
          const pieces = (result.missing ?? []).map((m) => MISSING_PIECES[m] ?? m.replace(/_/g, " "));
          return {
            tone: "bad",
            message: `No es un aviso de transferencia recibida${pieces.length > 0 ? ` (falta o no coincide: ${pieces.join(", ")})` : ""}.`,
            changed: false,
          };
        }
      }
  }
}
