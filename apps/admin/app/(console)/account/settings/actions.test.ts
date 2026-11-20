import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminApiFetch, updateSession } = vi.hoisted(() => ({ adminApiFetch: vi.fn(), updateSession: vi.fn() }));
vi.mock("@/lib/api", () => ({ adminApiFetch }));
vi.mock("@/auth", () => ({ updateSession }));
vi.mock("@/lib/require-admin", () => ({ requireAdmin: async () => ({ id: "a1", email: "a@x.co", isSuperAdmin: false }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { changePasswordAction, updateNameAction } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const password = { currentPassword: "old-password-1", newPassword: "new-password-1", confirmPassword: "new-password-1" };

beforeEach(() => {
  adminApiFetch.mockReset();
  updateSession.mockReset();
});

describe("admin settings: name", () => {
  it("saves the names through the API", async () => {
    adminApiFetch.mockResolvedValue(new Response("{}"));
    expect(await updateNameAction({}, form({ firstName: "Ana", lastName: "K" }))).toEqual({ ok: "Name updated." });
    expect(adminApiFetch).toHaveBeenCalledWith("/me", { method: "PATCH", body: JSON.stringify({ firstName: "Ana", lastName: "K" }) });
  });

  it("answers with the form's own message for a blank name, without calling the API", async () => {
    const result = await updateNameAction({}, form({ firstName: "", lastName: "K" }));
    expect(result.error).toBeTruthy();
    expect(adminApiFetch).not.toHaveBeenCalled();
  });

  it("returns a form error instead of throwing when the API cannot be reached", async () => {
    adminApiFetch.mockRejectedValue(new TypeError("fetch failed"));
    expect(await updateNameAction({}, form({ firstName: "Ana", lastName: "K" }))).toEqual({ error: "Could not reach the server. Try again." });
  });
});

describe("admin settings: password", () => {
  it("changes it, and keeps this browser signed in with the new session number", async () => {
    adminApiFetch.mockResolvedValue(new Response(JSON.stringify({ sessionVersion: 7 })));
    const result = await changePasswordAction({}, form(password));
    expect(result.ok).toContain("Password changed");
    expect(adminApiFetch).toHaveBeenCalledWith("/me/password", { method: "POST", body: JSON.stringify(password) });
    expect(updateSession).toHaveBeenCalledWith({ sessionVersion: 7 });
  });

  it("names a wrong current password, and keeps the session as it was", async () => {
    adminApiFetch.mockResolvedValue(new Response("{}", { status: 403 }));
    expect(await changePasswordAction({}, form(password))).toEqual({ error: "Your current password is incorrect." });
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("rejects a mismatch before calling the API", async () => {
    const result = await changePasswordAction({}, form({ ...password, confirmPassword: "different-1" }));
    expect(result.error).toBe("Passwords do not match");
    expect(adminApiFetch).not.toHaveBeenCalled();
  });
});
