import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminApiFetch } = vi.hoisted(() => ({ adminApiFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ adminApiFetch }));
vi.mock("@/lib/require-admin", () => ({ requireAdmin: async () => ({ id: "a1", email: "a@x.co", isSuperAdmin: true }) }));

import Account from "./page";

const text = (node: unknown): string => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  return text((node as { props?: { children?: unknown } }).props?.children);
};

beforeEach(() => adminApiFetch.mockReset());

describe("admin My account page", () => {
  it("shows the admin's own details and role", async () => {
    adminApiFetch.mockResolvedValue(new Response(JSON.stringify({ username: "ana_k", firstName: "Ana", lastName: "K", email: "a@x.co", emailVerified: "2026-11-01T10:00:00.000Z" })));
    const out = text(await Account());
    expect(adminApiFetch).toHaveBeenCalledWith("/me");
    for (const expected of ["ana_k", "Ana", "a@x.co", "Super admin", "Sun, 01 Nov 2026 10:00:00 GMT"]) expect(out).toContain(expected);
  });

  it("fails loudly when the API refuses, instead of showing an empty page", async () => {
    adminApiFetch.mockResolvedValue(new Response("no", { status: 500 }));
    await expect(Account()).rejects.toThrow("API /me failed: 500");
  });
});
