/**
 * Typed client for the Worker API (contract: src/shared/api.ts): public endpoints (re-exported from
 * ./publicApi) and the admin endpoints (cookie session). Admin screens import this module; the public app
 * imports ./publicApi so the admin client stays out of the public bundle.
 *
 * Every function either resolves with the typed body or rejects with an ApiRequestError
 * (never a bare TypeError/DOMException), whose `message` is Spanish copy safe to show to families.
 */
import type {
  AdminCollectionInput,
  AdminCollectionMutationResponse,
  AdminCollectionsResponse,
  AdminMovementImportResponse,
  AdminMovementMutationResponse,
  AdminMovementsResponse,
  AdminPayment,
  AdminPaymentsResponse,
  AdminStatusInput,
} from "../../shared/api";
import { ApiRequestError, DEFAULT_TIMEOUT, expectObject, get, postForm, postJson, seg, send, type RequestOptions } from "./publicApi";

export {
  ApiRequestError,
  createPayment,
  errorMessage,
  getBoard,
  getCollection,
  getConfig,
  isApiRequestError,
  listCollections,
  lookupPayment,
  normalizeTrackingCode,
  type ApiErrorCode,
  type CreatePaymentInput,
  type RequestOptions,
} from "./publicApi";

// ---------------------------------------------------------------- admin API (cookie session)

/** True when the admin cookie session is valid (200), false on 401. Other failures reject. */
export async function getAdminSession(options?: RequestOptions): Promise<boolean> {
  try {
    await send("GET", "/api/admin/session", null, options ?? {}, DEFAULT_TIMEOUT);
    return true;
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) return false;
    throw error;
  }
}

/** Rejects with status 401 on a wrong password and 429 when rate limited. */
export async function adminLogin(password: string, options?: RequestOptions): Promise<void> {
  await send("POST", "/api/admin/login", { kind: "json", value: { password } }, options ?? {}, DEFAULT_TIMEOUT);
}

export async function adminLogout(options?: RequestOptions): Promise<void> {
  await send("POST", "/api/admin/logout", { kind: "json", value: {} }, options ?? {}, DEFAULT_TIMEOUT);
}

export function listAdminCollections(options?: RequestOptions): Promise<AdminCollectionsResponse> {
  return get<AdminCollectionsResponse>("/api/admin/collections", options);
}

export function createCollection(input: AdminCollectionInput, options?: RequestOptions): Promise<AdminCollectionMutationResponse> {
  return postJson<AdminCollectionMutationResponse>("/api/admin/collections", input, options);
}

export function updateCollection(
  id: string,
  input: Partial<AdminCollectionInput>,
  options?: RequestOptions,
): Promise<AdminCollectionMutationResponse> {
  return postJson<AdminCollectionMutationResponse>(`/api/admin/collections/${seg(id)}`, input, options);
}

/** Field `cover`: JPEG/PNG/WEBP, max 5 MB (use lib/image `compressImage` first for big photos). */
export function uploadCover(id: string, cover: Blob, options?: RequestOptions): Promise<AdminCollectionMutationResponse> {
  const form = new FormData();
  form.set("cover", cover, cover instanceof File ? cover.name : "portada.jpg");
  return postForm<AdminCollectionMutationResponse>(`/api/admin/collections/${seg(id)}/cover`, form, options);
}

export async function deleteCover(id: string, options?: RequestOptions): Promise<AdminCollectionMutationResponse> {
  return expectObject<AdminCollectionMutationResponse>(
    await send("DELETE", `/api/admin/collections/${seg(id)}/cover`, null, options ?? {}, DEFAULT_TIMEOUT),
  );
}

export function listPayments(collectionId?: string | null, options?: RequestOptions): Promise<AdminPaymentsResponse> {
  const query = collectionId ? `?collection=${seg(collectionId)}` : "";
  return get<AdminPaymentsResponse>(`/api/admin/payments${query}`, options);
}

function isAdminPayment(value: unknown): value is AdminPayment {
  if (typeof value !== "object" || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return typeof record["id"] === "string" && typeof record["code"] === "string" && typeof record["status"] === "string";
}

/**
 * POST /api/admin/payments/:id/status (`note` required for observado and anulado).
 * The contract does not define the response body yet: resolves with the updated payment when the
 * server returns one (`{ payment }` or the payment itself), otherwise null (refetch the list).
 */
export async function setPaymentStatus(id: string, input: AdminStatusInput, options?: RequestOptions): Promise<AdminPayment | null> {
  const data = await send("POST", `/api/admin/payments/${seg(id)}/status`, { kind: "json", value: input }, options ?? {}, DEFAULT_TIMEOUT);
  if (isAdminPayment(data)) return data;
  if (typeof data === "object" && data !== null) {
    const record: Record<string, unknown> = { ...data };
    if (isAdminPayment(record["payment"])) return record["payment"];
  }
  return null;
}

/** Same-origin URL of a payment receipt (images inline, PDFs as attachment). Admin session required. */
export function receiptUrl(paymentId: string): string {
  return `/api/admin/receipts/${seg(paymentId)}`;
}

// ---------------------------------------------------------------- bank movements (Deuna emails)

/** Incoming Deuna transfers, newest first. Defaults to the ones that still need a payment. */
export function listMovements(status: "unmatched" | "all" = "unmatched", options?: RequestOptions): Promise<AdminMovementsResponse> {
  return get<AdminMovementsResponse>(`/api/admin/movements?status=${status}`, options);
}

/** Manual link. Rejects with 409 when the payment or the movement is already linked. */
export function linkMovement(movementId: string, paymentId: string, options?: RequestOptions): Promise<AdminMovementMutationResponse> {
  return postJson<AdminMovementMutationResponse>(`/api/admin/movements/${seg(movementId)}/link`, { paymentId }, options);
}

export function unlinkMovement(movementId: string, options?: RequestOptions): Promise<AdminMovementMutationResponse> {
  return postJson<AdminMovementMutationResponse>(`/api/admin/movements/${seg(movementId)}/unlink`, {}, options);
}

export function ignoreMovement(movementId: string, options?: RequestOptions): Promise<AdminMovementMutationResponse> {
  return postJson<AdminMovementMutationResponse>(`/api/admin/movements/${seg(movementId)}/ignore`, {}, options);
}

/** Uploads a raw Deuna notification (.eml). Always resolves with the result: stored, duplicate or ignored (with the reason). */
export function importDeunaEml(file: Blob, options?: RequestOptions): Promise<AdminMovementImportResponse> {
  const form = new FormData();
  form.set("eml", file, file instanceof File ? file.name : "correo.eml");
  return postForm<AdminMovementImportResponse>("/api/admin/movements/import", form, options);
}
