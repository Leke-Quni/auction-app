import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, authedApiFetch, issueSignedToken } = vi.hoisted(() => ({ auth: vi.fn(), authedApiFetch: vi.fn(), issueSignedToken: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/api", () => ({ authedApiFetch }));
vi.mock("@vercel/blob", () => ({ issueSignedToken }));
// Stands in for the Blob library's request handling: it asks for a token for one file, as it does for each file in a real request.
vi.mock("@vercel/blob/client", () => ({
  handleUploadPresigned: vi.fn(async ({ getSignedToken }: { getSignedToken: (pathname: string) => Promise<unknown> }) => ({ type: "ok", signed: await getSignedToken("listings/u1/a.jpg") })),
}));

import { POST } from "./route";

const post = (body: string) => POST(new Request("http://localhost/api/uploads", { method: "POST", body }));

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ user: { id: "u1" } });
  authedApiFetch.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  issueSignedToken.mockReset().mockResolvedValue("signed");
});

describe("POST /api/uploads", () => {
  it("answers 400, not a server error, to a body that is not JSON", async () => {
    expect((await post("not json")).status).toBe(400);
    expect(authedApiFetch).not.toHaveBeenCalled();
  });

  it("asks the API for permission for each photo, then issues the token", async () => {
    const res = await post("{}");
    expect(res.status).toBe(200);
    expect(authedApiFetch).toHaveBeenCalledWith("/uploads/authorize", { method: "POST" });
    expect(issueSignedToken).toHaveBeenCalledTimes(1);
  });

  it("answers 429 and issues nothing when the API says the person is over the limit", async () => {
    authedApiFetch.mockResolvedValue(new Response(JSON.stringify({ code: "RATE_LIMITED" }), { status: 429 }));
    const res = await post("{}");
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/uploaded a lot of photos/);
    expect(issueSignedToken).not.toHaveBeenCalled();
  });

  it("issues nothing when the API cannot be asked", async () => {
    authedApiFetch.mockResolvedValue(new Response(null, { status: 503 }));
    expect((await post("{}")).status).toBe(400);
    expect(issueSignedToken).not.toHaveBeenCalled();
  });

  it("does not ask the API for a signed-out visitor, and issues nothing", async () => {
    auth.mockResolvedValue(null);
    expect((await post("{}")).status).toBe(400);
    expect(authedApiFetch).not.toHaveBeenCalled();
    expect(issueSignedToken).not.toHaveBeenCalled();
  });
});
