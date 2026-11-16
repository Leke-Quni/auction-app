import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ adminApiFetch: () => Promise.reject(new TypeError("fetch failed")) }));
vi.mock("@/lib/require-admin", () => ({ requireAdmin: async () => ({ id: "a1", email: "a@x.co", isSuperAdmin: false }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { banUserAction } from "./actions";

describe("user actions when the API cannot be reached", () => {
  it("return a form error instead of throwing", async () => {
    const data = new FormData();
    data.set("id", "u1");
    data.set("reason", "spam");
    expect(await banUserAction({}, data)).toEqual({ error: "Could not reach the server. Try again." });
  });
});
