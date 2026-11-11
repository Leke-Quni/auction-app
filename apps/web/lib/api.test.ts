import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { auth, redirect } = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("next/navigation", () => ({ redirect }));

import { authedApiFetch } from "./api";

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
  auth.mockReset().mockResolvedValue({ user: { id: "u1", email: "a@b.c", role: "USER" } });
  redirect.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("authedApiFetch", () => {
  it("sends a signed-out caller to sign in, without calling the API", async () => {
    auth.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(authedApiFetch("/me")).rejects.toThrow("REDIRECT /sign-in");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a banned account to the suspended page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(403, { code: "BANNED", message: "This account has been suspended." })));
    await expect(authedApiFetch("/notifications")).rejects.toThrow("REDIRECT /suspended");
  });

  it("leaves other refusals to the caller, and returns the body unread", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(403, { code: "NOT_ADMIN" })));
    const res = await authedApiFetch("/x");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "NOT_ADMIN" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { ok: true })));
    expect((await authedApiFetch("/x")).status).toBe(200);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("is not fooled by a 403 that is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 })));
    expect((await authedApiFetch("/x")).status).toBe(403);
    expect(redirect).not.toHaveBeenCalled();
  });
});
