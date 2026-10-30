import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { globals: false, root: "./", fileParallelism: false },
  plugins: [swc.vite({ module: { type: "es6" } })],
});
