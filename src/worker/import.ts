/** Admin import of a raw Deuna notification (.eml), for mails that were missed or arrived before the inbox existed. */
import type { AdminMovementImportResponse } from "../shared/api";
import { MAX_RAW_BYTES, processDeunaRaw } from "./email/handler";
import { HttpError, json, readMultipart } from "./http";

/** Room for the multipart envelope around a file of at most MAX_RAW_BYTES. */
const MULTIPART_OVERHEAD = 16 * 1024;
const TOO_LARGE = "El archivo supera 1 MB. Descarga el mensaje original desde Gmail.";

export async function importDeunaEml(request: Request, env: Env): Promise<Response> {
  const form = await readMultipart(request, MAX_RAW_BYTES + MULTIPART_OVERHEAD, TOO_LARGE);
  const file = form.get("eml");
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "eml_required", "Adjunta el archivo .eml del correo de Deuna.");
  if (file.size > MAX_RAW_BYTES) throw new HttpError(413, "too_large", TOO_LARGE);

  const result: AdminMovementImportResponse = await processDeunaRaw(new Uint8Array(await file.arrayBuffer()), env);
  if (result.status === "stored" && result.paymentId) {
    const payment = await env.DB.prepare("SELECT code FROM payments WHERE id = ?").bind(result.paymentId).first<{ code: string }>();
    if (payment) return json({ ...result, paymentCode: payment.code } satisfies AdminMovementImportResponse);
  }
  return json(result satisfies AdminMovementImportResponse);
}
