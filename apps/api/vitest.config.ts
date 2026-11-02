import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Every test calls from one address and many tests bid a lot, so the bid limits are lifted; the rate-limit tests set their own.
  test: { globals: false, root: "./", fileParallelism: false, env: { BID_LIMIT_USER: "100000", BID_LIMIT_IP: "100000", LOGIN_CODE_COOLDOWN_SECONDS: "0" } },
  plugins: [swc.vite({ module: { type: "es6" } })],
});
