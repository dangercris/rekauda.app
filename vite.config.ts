import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const entry = (file: string): string => fileURLToPath(new URL(file, import.meta.url));

/**
 * Dev-only rewrites so the multi-page app behaves like production:
 * `/admin` and `/admin/...` serve admin.html, `/gallery` serves the living style guide.
 * Asset requests (anything with a file extension) and Vite internals pass through.
 */
function mpaDevRewrites(): Plugin {
  return {
    name: "kv-mpa-dev-rewrites",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? "/";
        const path = url.split("?")[0] ?? "/";
        const isAsset = /\.[a-z0-9]+$/i.test(path) || path.startsWith("/@") || path.startsWith("/api/");
        if (!isAsset) {
          if (path === "/admin" || path.startsWith("/admin/")) req.url = "/admin.html";
          else if (path === "/gallery" || path.startsWith("/gallery/")) req.url = "/gallery.html";
        }
        next();
      });
    },
  };
}

/**
 * Vitest never reads the local copy of the config: every import of it (the single-mode ConfigStore in the Worker)
 * resolves to the committed example, so tests are deterministic on any machine.
 */
const testAlias = [{ find: /^(\.{1,2}\/)+rekauda\.config$/, replacement: entry("./rekauda.config.example.ts") }];

/** Build inputs. gallery.html is a dev-only style guide: served by `vite`, never built. */
function inputs(command: "build" | "serve"): Record<string, string> {
  const input: Record<string, string> = { index: entry("./index.html"), admin: entry("./admin.html") };
  if (command === "serve") input["gallery"] = entry("./gallery.html");
  return input;
}

export default defineConfig(({ command }) => ({
  root,
  plugins: [react(), mpaDevRewrites()],
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    rolldownOptions: {
      input: inputs(command),
    },
  },
  server: {
    // Tenants are <slug>.localhost in local Cloud development; the proxy keeps the Host header so the Worker can resolve them.
    allowedHosts: [".localhost"],
    proxy: {
      "/api": { target: "http://localhost:8799", changeOrigin: false },
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "client",
          alias: testAlias,
          environment: "jsdom",
          include: ["src/client/**/*.test.{ts,tsx}"],
          setupFiles: ["src/client/test/setup.ts"],
          css: { modules: { classNameStrategy: "non-scoped" } },
        },
      },
      {
        test: {
          name: "worker",
          alias: testAlias,
          environment: "node",
          setupFiles: ["src/worker/test/setup.ts"],
          include: ["src/worker/**/*.test.ts", "src/shared/**/*.test.ts", "scripts/**/*.test.ts"],
        },
      },
    ],
  },
}));
