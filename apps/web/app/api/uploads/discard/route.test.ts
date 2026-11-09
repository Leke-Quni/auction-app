import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, deleteOwnBlobs, authedApiFetch } = vi.hoisted(() => ({ auth: vi.fn(), deleteOwnBlobs: vi.fn(), authedApiFetch: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/blob", () => ({ deleteOwnBlobs }));
vi.mock("@/lib/api", () => ({ authedApiFetch }));

import { POST } from "./route";

const post = (body: unknown) => POST(new Request("http://localhost/api/uploads/discard", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const reply = (urls: string[]) => new Response(JSON.stringify({ urls }), { status: 200 });

beforeEach(() => {
  auth.mockReset();
  deleteOwnBlobs.mockReset();
  authedApiFetch.mockReset();
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

  it("deletes only the photos the API says no listing uses, and ignores anything that is not a string", async () => {
    auth.mockResolvedValue({ user: { id: "u1" } });
    authedApiFetch.mockResolvedValue(reply(["https://a"]));
    expect((await post({ urls: ["https://a", 5, "https://b"] })).status).toBe(204);
    expect(JSON.parse(authedApiFetch.mock.calls[0][1].body)).toEqual({ urls: ["https://a", "https://b"] });
    expect(deleteOwnBlobs).toHaveBeenCalledWith(["https://a"], "u1");
  });

  it("deletes nothing when the API cannot be asked", async () => {
    auth.mockResolvedValue({ user: { id: "u1" } });
    authedApiFetch.mockResolvedValue(new Response(null, { status: 503 }));
    expect((await post({ urls: ["https://a"] })).status).toBe(502);
    expect(deleteOwnBlobs).not.toHaveBeenCalled();
  });
});
