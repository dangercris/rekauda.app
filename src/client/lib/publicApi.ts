/**
 * Typed client for the PUBLIC Worker API (contract: src/shared/api.ts), plus the request core shared with
 * the admin client. The public app imports this module directly so the admin client never ships in the
 * public bundle; `./api` re-exports everything here for backward compatibility.
 *
 * Every function either resolves with the typed body or rejects with an ApiRequestError
 * (never a bare TypeError/DOMException), whose `message` is Spanish copy safe to show to families.
 */
import type {
  ApiError,
  BoardResponse,
  CollectionDetail,
  CollectionsResponse,
  ConfigResponse,
  CreatePaymentResponse,
  LookupResponse,
  PaymentStudentInput,
} from "../../shared/api";
import { plainAmount } from "./format";

export type ApiErrorCode =
  | "network_error"
  | "timeout"
  | "aborted"
  | "invalid_response"
  | (string & {});

export class ApiRequestError extends Error {
  override readonly name = "ApiRequestError";
  /** HTTP status, or 0 when the request never got a response (network, timeout, abort). */
  readonly status: number;
  /** `ApiError.error` from the server, or a client code: network_error, timeout, aborted, invalid_response, http_<status>. */
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isApiRequestError(value: unknown): value is ApiRequestError {
  return value instanceof ApiRequestError;
}

const MESSAGES = {
  network: "No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.",
  timeout: "La conexión está tardando demasiado. Intenta de nuevo.",
  aborted: "La solicitud se canceló.",
  invalid: "Recibimos una respuesta inesperada. Intenta de nuevo.",
  unauthorized: "Tu sesión expiró. Vuelve a ingresar.",
  tooLarge: "El archivo es demasiado grande.",
  rateLimited: "Demasiados intentos. Espera un minuto e intenta de nuevo.",
  server: "Tuvimos un problema en el servidor. Intenta de nuevo en unos minutos.",
  generic: "No se pudo completar la acción. Intenta de nuevo.",
} as const;

/** Spanish message for anything caught in a try/catch. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return MESSAGES.generic;
}

export interface RequestOptions {
  signal?: AbortSignal | undefined;
  /** Milliseconds before the request is aborted with code `timeout`. Default 20 s (120 s for uploads). */
  timeoutMs?: number | undefined;
}

/** @internal Request body for `send`. */
export type Body = { kind: "json"; value: unknown } | { kind: "form"; value: FormData } | null;

/** @internal */
export const DEFAULT_TIMEOUT = 20_000;
const UPLOAD_TIMEOUT = 120_000;

function fallbackMessage(status: number): string {
  if (status === 401) return MESSAGES.unauthorized;
  if (status === 413) return MESSAGES.tooLarge;
  if (status === 429) return MESSAGES.rateLimited;
  if (status >= 500) return MESSAGES.server;
  return MESSAGES.generic;
}

function isApiErrorBody(value: unknown): value is ApiError {
  if (typeof value !== "object" || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return typeof record["error"] === "string" && typeof record["message"] === "string";
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

/** @internal Request core shared with the admin client (./api). */
export async function send(method: string, path: string, body: Body, options: RequestOptions, defaultTimeout: number): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? defaultTimeout);
  const onAbort = (): void => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const headers: Record<string, string> = { Accept: "application/json" };
  let payload: BodyInit | undefined;
  if (body?.kind === "json") {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body.value);
  } else if (body?.kind === "form") {
    payload = body.value;
  }

  // The timer and the abort link stay armed until the body is fully read, so a stalled response body
  // cannot hang forever either.
  const cleanup = (): void => {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  };

  let response: Response;
  let data: unknown;
  try {
    try {
      response = await fetch(path, {
        method,
        headers,
        body: payload ?? null,
        credentials: "same-origin",
        signal: controller.signal,
      });
    } catch {
      if (timedOut) throw new ApiRequestError(0, "timeout", MESSAGES.timeout);
      if (options.signal?.aborted) throw new ApiRequestError(0, "aborted", MESSAGES.aborted);
      throw new ApiRequestError(0, "network_error", MESSAGES.network);
    }
    try {
      data = await readJson(response);
    } catch {
      if (timedOut) throw new ApiRequestError(0, "timeout", MESSAGES.timeout);
      if (options.signal?.aborted) throw new ApiRequestError(0, "aborted", MESSAGES.aborted);
      data = undefined;
    }
  } finally {
    cleanup();
  }

  if (!response.ok) {
    if (isApiErrorBody(data)) {
      throw new ApiRequestError(response.status, data.error, data.message.trim() || fallbackMessage(response.status));
    }
    throw new ApiRequestError(response.status, `http_${response.status}`, fallbackMessage(response.status));
  }
  if (data === undefined) throw new ApiRequestError(response.status, "invalid_response", MESSAGES.invalid);
  return data;
}

/**
 * The server is the source of truth for response shapes (src/shared/api.ts); the client only checks
 * that a JSON object came back before handing it to typed code.
 */
/** @internal */
export function expectObject<T extends object>(data: unknown, status = 200): T {
  if (typeof data !== "object" || data === null) throw new ApiRequestError(status, "invalid_response", MESSAGES.invalid);
  return data as T;
}

/** @internal */
export const get = async <T extends object>(path: string, options: RequestOptions = {}): Promise<T> =>
  expectObject<T>(await send("GET", path, null, options, DEFAULT_TIMEOUT));

/** @internal */
export const postJson = async <T extends object>(path: string, value: unknown, options: RequestOptions = {}): Promise<T> =>
  expectObject<T>(await send("POST", path, { kind: "json", value }, options, DEFAULT_TIMEOUT));

/** @internal */
export const postForm = async <T extends object>(path: string, form: FormData, options: RequestOptions = {}): Promise<T> =>
  expectObject<T>(await send("POST", path, { kind: "form", value: form }, options, UPLOAD_TIMEOUT));

/** @internal */
export const seg = (value: string): string => encodeURIComponent(value);

// ---------------------------------------------------------------- public API

export function getConfig(options?: RequestOptions): Promise<ConfigResponse> {
  return get<ConfigResponse>("/api/config", options);
}

export function listCollections(options?: RequestOptions): Promise<CollectionsResponse> {
  return get<CollectionsResponse>("/api/collections", options);
}

/** Rejects with status 404 / code `collection_not_found` when missing or archived. */
export function getCollection(slug: string, options?: RequestOptions): Promise<CollectionDetail> {
  return get<CollectionDetail>(`/api/collections/${seg(slug)}`, options);
}

export function getBoard(slug: string, options?: RequestOptions): Promise<BoardResponse> {
  return get<BoardResponse>(`/api/collections/${seg(slug)}/board`, options);
}

export interface CreatePaymentInput {
  /** Collection slug. */
  collection: string;
  students: PaymentStudentInput[];
  parentName: string;
  phone: string;
  /** YYYY-MM-DD */
  transferDate: string;
  /** One of ConfigResponse.banks. */
  bank: string;
  amountCents: number;
  reference?: string | null | undefined;
  /** JPEG/PNG/WEBP/PDF, max 5 MB (use lib/image `prepareReceipt` first). */
  receipt: Blob;
  /** File name sent with the receipt; defaults to the File name or "comprobante". */
  receiptName?: string | undefined;
  /**
   * Value of the hidden honeypot input (`hp_c9x`) rendered in the form. People never fill it; bots that
   * fill every field get a fake success from the server. Defaults to "" (the field is always sent).
   */
  honeypot?: string | undefined;
}

/** POST /api/payments (multipart). Consent is implied by calling this after the checkbox is ticked. */
export function createPayment(input: CreatePaymentInput, options?: RequestOptions): Promise<CreatePaymentResponse> {
  const form = new FormData();
  form.set("collection", input.collection);
  form.set("students", JSON.stringify(input.students));
  form.set("parentName", input.parentName);
  form.set("phone", input.phone);
  form.set("transferDate", input.transferDate);
  form.set("bank", input.bank);
  form.set("amount", plainAmount(input.amountCents));
  if (input.reference) form.set("reference", input.reference);
  form.set("consent", "si");
  form.set("hp_c9x", input.honeypot ?? "");
  const name = input.receiptName ?? (input.receipt instanceof File ? input.receipt.name : "comprobante");
  form.set("receipt", input.receipt, name);
  return postForm<CreatePaymentResponse>("/api/payments", form, options);
}

/** Normalizes what people type ("abc123", "abc 123") into the `XXX-XXX` tracking code format. */
export function normalizeTrackingCode(input: string): string {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length === 6 ? `${compact.slice(0, 3)}-${compact.slice(3)}` : input.trim().toUpperCase();
}

/** GET /api/lookup/:code (rate limited: 429 surfaces as a friendly message). */
export function lookupPayment(code: string, options?: RequestOptions): Promise<LookupResponse> {
  return get<LookupResponse>(`/api/lookup/${seg(normalizeTrackingCode(code))}`, options);
}
