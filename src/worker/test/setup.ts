import { timingSafeEqual } from "node:crypto";
import "./html-rewriter";

// Workers expose crypto.subtle.timingSafeEqual, Node does not.
if (!("timingSafeEqual" in crypto.subtle)) {
  Object.defineProperty(crypto.subtle, "timingSafeEqual", {
    configurable: true,
    writable: true,
    value: (a: ArrayBuffer, b: ArrayBuffer) => timingSafeEqual(new Uint8Array(a), new Uint8Array(b)),
  });
}
