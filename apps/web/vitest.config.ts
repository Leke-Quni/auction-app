import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  // The same "@/" shortcut as tsconfig.json, so tests can load code that uses it.
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { passWithNoTests: true },
});
