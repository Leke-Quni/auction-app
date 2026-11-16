import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch, rarelyChanging: () => ({}) }));

import { loadTopPriceCents } from "./top-price";

const reply = (items: unknown[]) => new Response(JSON.stringify({ items }), { status: 200 });

beforeEach(() => apiFetch.mockReset());

describe("loadTopPriceCents", () => {
  it("uses the current bid of the dearest auction, as the price sort does", async () => {
    apiFetch.mockResolvedValue(reply([{ startingPriceCents: 1000, currentBidCents: 25_000 }]));
    expect(await loadTopPriceCents()).toBe(25_000);
  });

  it("uses the starting price when nobody has bid", async () => {
    apiFetch.mockResolvedValue(reply([{ startingPriceCents: 1000, currentBidCents: null }]));
    expect(await loadTopPriceCents()).toBe(1000);
  });

  it("gives nothing for no results, an error, or an unreachable API", async () => {
    apiFetch.mockResolvedValueOnce(reply([]));
    expect(await loadTopPriceCents()).toBeUndefined();
    apiFetch.mockResolvedValueOnce(new Response("", { status: 500 }));
    expect(await loadTopPriceCents()).toBeUndefined();
    apiFetch.mockRejectedValueOnce(new Error("down"));
    expect(await loadTopPriceCents()).toBeUndefined();
  });
});
