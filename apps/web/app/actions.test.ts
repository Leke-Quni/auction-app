import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch, authedApiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn(), authedApiFetch: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), updateSession: vi.fn() }));
vi.mock("next-auth", () => ({ AuthError: class extends Error {} }));
vi.mock("@/lib/api", () => ({ apiFetch, authedApiFetch }));
vi.mock("@/lib/blob", () => ({ deleteOwnBlobs: vi.fn() }));
vi.mock("@/lib/viewer-ip", () => ({ viewerIpHeaders: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { redirect } from "next/navigation";
import { changePasswordAction, signInAction, signUpAction } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const down = () => Promise.reject(new TypeError("fetch failed"));

beforeEach(() => {
  apiFetch.mockReset().mockImplementation(down);
  authedApiFetch.mockReset().mockImplementation(down);
});

describe("auth actions when the API cannot be reached", () => {
  it("sign-in returns a form error instead of throwing", async () => {
    expect(await signInAction({}, form({ email: "a@b.co", password: "secret" }))).toEqual({ error: "Could not reach the server. Try again." });
  });

  it("sign-up returns a form error instead of throwing", async () => {
    const fields = { firstName: "Ana", lastName: "Berisha", username: "ana_b", email: "a@b.co", password: "correct-horse-9", confirmPassword: "correct-horse-9" };
    expect(await signUpAction({}, form(fields))).toEqual({ error: "Could not reach the server. Try again." });
    expect(apiFetch).toHaveBeenCalledWith("/auth/signup", expect.anything());
  });

  it("an account action still follows a redirect thrown from the call, such as an ended session", async () => {
    authedApiFetch.mockImplementation(() => redirect("/sign-in"));
    const fields = { currentPassword: "old-password-1", newPassword: "new-password-12", confirmPassword: "new-password-12" };
    await expect(changePasswordAction({}, form(fields))).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });
});
