import { defineConfig } from "@playwright/test";

// Runs against the local stack: Docker Compose (Postgres, Redis) must be up, then `yarn dev` from the repo root. If the API
// is already answering on port 4000 it is reused; otherwise Playwright starts `yarn dev` and waits for it.
export default defineConfig({
  testDir: "./tests",
  // One browser at a time: the tests share one database and one API with its background sweeps.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_WEB_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "yarn dev",
    cwd: "../..",
    url: "http://localhost:4000/health",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
