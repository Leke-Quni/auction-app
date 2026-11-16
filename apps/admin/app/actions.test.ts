import { describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn(() => Promise.reject(new TypeError("fetch failed"))) }));
vi.mock("next-auth", () => ({ AuthError: class extends Error {} }));
vi.mock("@/auth", () => ({ signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch }));

import { resendCodeAction, signInAction } from "./actions";

process.env.AUTH_SECRET = "x".repeat(40);

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("admin sign-in when the API cannot be reached", () => {
  it("the password step returns a form error instead of throwing", async () => {
    expect(await signInAction({}, form({ email: "a@b.co", password: "secret" }))).toEqual({ error: "Could not reach the server. Try again." });
    // It says it comes from this app without a visitor address, so the API does not count it under this server's own address.
    expect(apiFetch).toHaveBeenCalledWith("/auth/login/start", expect.objectContaining({ headers: expect.objectContaining({ "x-viewer-ip": "" }) }));
  });

  it("sending a new code returns a form error instead of throwing", async () => {
    expect(await resendCodeAction("a@b.co")).toEqual({ error: "Could not reach the server. Try again." });
  });
});
