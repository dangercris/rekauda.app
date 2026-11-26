import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom lacks matchMedia; components read color-scheme and reduced-motion preferences through it.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const list: MediaQueryList = {
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      };
      return list;
    },
  });
}

// jsdom logs "Not implemented" for scrollTo; the router calls it after path changes.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "scrollTo", { configurable: true, writable: true, value: () => undefined });
}
