import { copyText } from "./clipboard";

export interface ShareData {
  title?: string | undefined;
  text?: string | undefined;
  /** Absolute or same-origin relative URL. */
  url: string;
}

export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

/**
 * Opens the native share sheet (WhatsApp, etc.) when available; otherwise copies the link.
 * Resolves "cancelled" when the person closes the share sheet. Never throws.
 */
export async function shareLink(data: ShareData): Promise<ShareResult> {
  const url = typeof window !== "undefined" ? new URL(data.url, window.location.href).href : data.url;
  const payload: { url: string; title?: string; text?: string } = { url };
  if (data.title) payload.title = data.title;
  if (data.text) payload.text = data.text;
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      if (typeof navigator.canShare !== "function" || navigator.canShare(payload)) {
        await navigator.share(payload);
        return "shared";
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  return (await copyText(url)) ? "copied" : "failed";
}
