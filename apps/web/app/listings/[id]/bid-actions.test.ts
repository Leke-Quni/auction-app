import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, authedApiFetch, revalidatePath, viewerIpHeaders } = vi.hoisted(() => ({
  auth: vi.fn(),
  authedApiFetch: vi.fn(),
  revalidatePath: vi.fn(),
  viewerIpHeaders: vi.fn(),
}));
vi.mock("@/lib/viewer-ip", () => ({ viewerIpHeaders }));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/api", () => ({ authedApiFetch }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { placeBidAction } from "./bid-actions";

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ user: { id: "u1" } });
  authedApiFetch.mockReset();
  revalidatePath.mockReset();
  viewerIpHeaders.mockReset().mockResolvedValue({});
});

describe("placeBidAction", () => {
  it("needs a signed-in user and does not call the API without one", async () => {
    auth.mockResolvedValue(null);
    expect(await placeBidAction("L1", 1000, "key-123456")).toEqual({ error: "Sign in to place a bid." });
    expect(authedApiFetch).not.toHaveBeenCalled();
  });

  it("sends the amount and the key, and refreshes the listing page on success", async () => {
    authedApiFetch.mockResolvedValue(reply(201, { extended: true, listing: { endsAt: "2026-11-02T12:15:00Z" } }));
    const result = await placeBidAction("L1", 1250, "key-123456");
    expect(result).toEqual({ ok: true, extended: true, endsAt: "2026-11-02T12:15:00Z", outcome: "LEADING" });
    expect(authedApiFetch).toHaveBeenCalledWith("/listings/L1/bids", {
      method: "POST",
      headers: {},
      body: JSON.stringify({ amountCents: 1250, idempotencyKey: "key-123456" }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/listings/L1");
  });

  it("passes on what the bid meant: the outcome, the bidder's own maximum and the price now", async () => {
    authedApiFetch.mockResolvedValue(reply(201, { outcome: "OUTBID_BY_PROXY", yourMaxCents: 2000, extended: false, listing: { endsAt: "2026-11-02T12:00:00Z", currentBidCents: 2100 } }));
    expect(await placeBidAction("L1", 2000, "key-123456")).toEqual({ ok: true, extended: false, endsAt: "2026-11-02T12:00:00Z", outcome: "OUTBID_BY_PROXY", yourMaxCents: 2000, currentBidCents: 2100 });
  });

  it("treats an answer without an outcome (an older API) as leading", async () => {
    authedApiFetch.mockResolvedValue(reply(201, { listing: { endsAt: "2026-11-02T12:00:00Z", currentBidCents: 1000 } }));
    expect(await placeBidAction("L1", 1000, "key-123456")).toMatchObject({ ok: true, outcome: "LEADING", currentBidCents: 1000 });
  });

  it("passes the bidder's own address on to the API", async () => {
    viewerIpHeaders.mockResolvedValue({ "x-viewer-ip": "203.0.113.9", "x-viewer-ip-signature": "sig" });
    authedApiFetch.mockResolvedValue(reply(201, { listing: {} }));
    await placeBidAction("L1", 1250, "key-123456");
    expect(authedApiFetch.mock.calls[0][1].headers).toEqual({ "x-viewer-ip": "203.0.113.9", "x-viewer-ip-signature": "sig" });
  });

  it("treats the answer to a retried bid (200) as a success", async () => {
    authedApiFetch.mockResolvedValue(reply(200, { replayed: true, extended: false, listing: { endsAt: "2026-11-02T12:00:00Z" } }));
    expect((await placeBidAction("L1", 1250, "key-123456")).ok).toBe(true);
  });

  it("says in words why a bid was refused, and passes the minimum on", async () => {
    authedApiFetch.mockResolvedValue(reply(422, { code: "TOO_LOW", message: "x", minimumNextBidCents: 1500 }));
    expect(await placeBidAction("L1", 1000, "key-123456")).toEqual({ error: "Your bid is below the minimum of €15.00.", minimumNextBidCents: 1500 });
    authedApiFetch.mockResolvedValue(reply(409, { code: "MAX_NOT_HIGHER", message: "x" }));
    expect((await placeBidAction("L1", 2000, "key-654321")).error).toBe("Your new maximum must be higher than your current maximum.");
    authedApiFetch.mockResolvedValue(reply(409, { code: "NOT_LIVE", message: "x" }));
    expect((await placeBidAction("L1", 2000, "key-111111")).error).toBe("This auction is not open for bids.");
    authedApiFetch.mockResolvedValue(reply(400, { message: "Enter your bid" }));
    expect((await placeBidAction("L1", 2000, "key-222222")).error).toBe("Enter your bid");
  });

  it("marks a server error or no answer as safe to retry with the same key", async () => {
    authedApiFetch.mockResolvedValue(reply(503, { code: "BUSY", message: "Bidding is busy right now. Your bid was not placed; try again." }));
    expect(await placeBidAction("L1", 1000, "key-123456")).toMatchObject({ retry: true, error: expect.stringContaining("not placed") });
    authedApiFetch.mockResolvedValue(reply(500, {}));
    expect((await placeBidAction("L1", 1000, "key-123456")).retry).toBe(true);
    authedApiFetch.mockRejectedValue(new Error("connect ECONNREFUSED"));
    expect(await placeBidAction("L1", 1000, "key-123456")).toMatchObject({ retry: true, error: expect.stringContaining("may not have been placed") });
  });

  it("does not mark a clear refusal as retryable, and asks to sign in again when the session has expired", async () => {
    authedApiFetch.mockResolvedValue(reply(403, { code: "OWN_LISTING", message: "x" }));
    expect((await placeBidAction("L1", 1000, "key-123456")).retry).toBeUndefined();
    authedApiFetch.mockResolvedValue(reply(401, {}));
    expect((await placeBidAction("L1", 1000, "key-123456")).error).toMatch(/Sign in again/);
  });
});
