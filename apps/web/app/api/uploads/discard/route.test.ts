import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, deleteOwnBlobs } = vi.hoisted(() => ({ auth: vi.fn(), deleteOwnBlobs: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/blob", () => ({ deleteOwnBlobs }));

import { POST } from "./route";

const post = (body: unknown) => POST(new Request("http://localhost/api/uploads/discard", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  auth.mockReset();
  deleteOwnBlobs.mockReset();
});

describe("POST /api/uploads/discard", () => {
  it("needs a signed-in visitor", async () => {
    auth.mockResolvedValue(null);
    expect((await post({ urls: ["https://x"] })).status).toBe(401);
    expect(deleteOwnBlobs).not.toHaveBeenCalled();
  });

  it("rejects a body without a list of URLs", async () => {
    auth.mockResolvedValue({ user: { id: "u1" } });
    expect((await post("nope")).status).toBe(400);
    expect((await post({ urls: "x" })).status).toBe(400);
  });

  it("deletes the given URLs for the caller only, ignoring anything that is not a string", async () => {
    auth.mockResolvedValue({ user: { id: "u1" } });
    expect((await post({ urls: ["https://a", 5, "https://b"] })).status).toBe(204);
    expect(deleteOwnBlobs).toHaveBeenCalledWith(["https://a", "https://b"], "u1");
  });
});
