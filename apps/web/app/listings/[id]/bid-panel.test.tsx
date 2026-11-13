// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { placeBidAction, refresh } = vi.hoisted(() => ({ placeBidAction: vi.fn(), refresh: vi.fn() }));
vi.mock("./bid-actions", () => ({ placeBidAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { BidPanel, type BidMode } from "./bid-panel";

beforeEach(() => {
  placeBidAction.mockReset();
  refresh.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const panel = (mode: BidMode = "live", minimumNextBidCents = 1100) => <BidPanel listingId="L1" mode={mode} minimumNextBidCents={minimumNextBidCents} />;
const leader = (viewerMaxCents: number | null, onMaxChange?: (cents: number) => void) => (
  <BidPanel listingId="L1" mode="highest" minimumNextBidCents={1100} viewerMaxCents={viewerMaxCents} onMaxChange={onMaxChange} />
);
const raiseBox = () => screen.getByLabelText("Raise your maximum (€)") as HTMLInputElement;
const box = () => screen.getByLabelText("Your maximum bid (€)") as HTMLInputElement;
const place = () => fireEvent.click(screen.getByRole("button", { name: /^place bid$/i }));
const confirmBid = async () => fireEvent.click(await screen.findByRole("button", { name: /^confirm bid of/i }));

describe("BidPanel once the auction has ended in a sale", () => {
  const ended = (order: { viewer: "buyer" | "seller"; status: string }) => <BidPanel listingId="L1" mode="ended" minimumNextBidCents={1100} order={{ id: "o1", amountCents: 3150, ...order }} />;

  it("tells the winner what they owe and links to pay", () => {
    render(ended({ viewer: "buyer", status: "AWAITING_PAYMENT" }));
    expect(screen.getByText(/This auction has ended\./)).toBeTruthy();
    expect(screen.getByText(/You won it for €31\.50/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pay now" }).getAttribute("href")).toBe("/orders/o1");
  });

  it("links the winner who has paid, and the seller, to the order", () => {
    const { rerender } = render(ended({ viewer: "buyer", status: "PAID" }));
    expect(screen.getByRole("link", { name: "View the order" }).getAttribute("href")).toBe("/orders/o1");
    expect(screen.queryByRole("link", { name: "Pay now" })).toBeNull();
    rerender(ended({ viewer: "seller", status: "AWAITING_PAYMENT" }));
    expect(screen.getByText(/This item sold/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View the order" })).toBeTruthy();
  });
});

describe("BidPanel once an order has lapsed", () => {
  const ended = (order: { viewer: "buyer" | "seller"; status: string }) => <BidPanel listingId="L1" mode="ended" minimumNextBidCents={1100} order={{ id: "o1", amountCents: 3150, ...order }} />;

  it("tells a buyer who did not pay that the order was cancelled, and no longer offers to pay", () => {
    render(ended({ viewer: "buyer", status: "EXPIRED" }));
    expect(screen.getByText(/You did not pay for it in time, so the order was cancelled/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Pay now" })).toBeNull();
    expect(screen.queryByText(/You won it/)).toBeNull();
    expect(screen.getByRole("link", { name: "View the order" }).getAttribute("href")).toBe("/orders/o1");
  });

  it("tells the seller the buyer did not pay, not that the item sold", () => {
    render(ended({ viewer: "seller", status: "EXPIRED" }));
    expect(screen.getByText(/The buyer did not pay, so it ended without a sale/)).toBeTruthy();
    expect(screen.queryByText(/This item sold/)).toBeNull();
  });
});

describe("BidPanel when you cannot bid", () => {
  it("says why, for each case", () => {
    const { rerender } = render(panel("signed-out"));
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/sign-in");
    rerender(panel("owner"));
    expect(screen.getByText(/your listing/i)).toBeTruthy();
    rerender(panel("upcoming"));
    expect(screen.getByText(/opens when the auction starts/i)).toBeTruthy();
    rerender(panel("ended"));
    expect(screen.getByText(/has ended/i)).toBeTruthy();
    rerender(panel("highest"));
    expect(screen.getByText("You are the highest bidder.")).toBeTruthy();
    rerender(panel("blocked"));
    expect(screen.getByText(/your account has two strikes/i)).toBeTruthy();
    for (const mode of ["signed-out", "owner", "blocked", "upcoming", "ended", "highest"] as const) {
      rerender(panel(mode));
      expect(screen.queryByRole("button", { name: /place bid/i }), mode).toBeNull();
    }
  });
});

describe("BidPanel when you can bid", () => {
  it("starts at the minimum and says what it is", () => {
    render(panel("live", 1100));
    expect(box().value).toBe("11.00");
    expect(screen.getByText(/Minimum bid: €11\.00/)).toBeTruthy();
  });

  it("explains that the number is a maximum, that we bid for them, and that it cannot be lowered or withdrawn", () => {
    render(panel("live", 1100));
    expect(screen.getByText(/We bid for you, one step at a time, up to this amount/)).toBeTruthy();
    expect(screen.getByText(/only pay what is needed to stay ahead/)).toBeTruthy();
    expect(screen.getByText(/cannot be lowered or withdrawn/)).toBeTruthy();
  });

  it("places a bid in cents with a bid key, then refreshes the page", async () => {
    placeBidAction.mockResolvedValue({ ok: true });
    render(panel("live", 1100));
    fireEvent.change(box(), { target: { value: "12,50" } });
    place();
    await confirmBid();
    await waitFor(() => expect(placeBidAction).toHaveBeenCalledTimes(1));
    const [listingId, cents, key] = placeBidAction.mock.calls[0];
    expect([listingId, cents]).toEqual(["L1", 1250]);
    expect(String(key).length).toBeGreaterThanOrEqual(8);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("does not send a bid below the minimum or one that is not an amount", () => {
    render(panel("live", 1100));
    fireEvent.change(box(), { target: { value: "10.99" } });
    place();
    expect(screen.getByRole("alert").textContent).toMatch(/at least €11\.00/);
    fireEvent.change(box(), { target: { value: "lots" } });
    place();
    expect(screen.getByRole("alert").textContent).toMatch(/Enter an amount/);
    expect(placeBidAction).not.toHaveBeenCalled();
  });

  it("asks to confirm the amount first, and sends nothing until it is confirmed", async () => {
    placeBidAction.mockResolvedValue({ ok: true });
    render(panel("live", 1100));
    place();
    expect(screen.getByText(/You are about to bid up to/).textContent).toContain("€11.00");
    expect(screen.getByText(/You cannot lower or withdraw it/)).toBeTruthy();
    expect(placeBidAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^place bid$/i })).toBeNull();
    await confirmBid();
    await waitFor(() => expect(placeBidAction).toHaveBeenCalledWith("L1", 1100, expect.any(String)));
  });

  it("lets you go back and change the amount without bidding", () => {
    render(panel("live", 1100));
    place();
    expect(box().readOnly).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.queryByText(/You are about to bid/)).toBeNull();
    expect(box().readOnly).toBe(false);
    expect(placeBidAction).not.toHaveBeenCalled();
  });

  it("warns on the confirmation when a bid is ten times the minimum or more", () => {
    render(panel("live", 1100));
    fireEvent.change(box(), { target: { value: "110" } });
    place();
    expect(screen.getByText(/far above the minimum of €11\.00/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.change(box(), { target: { value: "109.99" } });
    place();
    expect(screen.queryByText(/far above the minimum/)).toBeNull();
  });

  it("drops the confirmation when someone else bids, since the minimum changed", () => {
    const { rerender } = render(panel("live", 1100));
    place();
    expect(screen.getByText(/You are about to bid/)).toBeTruthy();
    rerender(panel("live", 1300));
    expect(screen.queryByText(/You are about to bid/)).toBeNull();
    expect(box().value).toBe("13.00");
  });

  it("shows why a bid was refused and puts the right minimum in the box", async () => {
    placeBidAction.mockResolvedValue({ error: "Your bid is below the minimum of €15.00.", minimumNextBidCents: 1500 });
    render(panel("live", 1100));
    place();
    await confirmBid();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Your bid is below the minimum of €15.00."));
    expect(box().value).toBe("15.00");
    expect(screen.getByText(/Minimum bid: €15\.00/)).toBeTruthy();
  });

  it("uses the same key to retry a bid whose outcome is unknown, and a new key after a clear answer or a changed amount", async () => {
    render(panel("live", 1100));
    // The button reads "Placing bid..." while a bid is out, so wait for it before each click.
    const placeWhenReady = async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^place bid$/i }));
      await confirmBid();
    };
    placeBidAction.mockResolvedValueOnce({ error: "Try again", retry: true });
    await placeWhenReady();
    await waitFor(() => expect(placeBidAction).toHaveBeenCalledTimes(1));
    placeBidAction.mockResolvedValueOnce({ error: "Try again", retry: true });
    await placeWhenReady();
    await waitFor(() => expect(placeBidAction).toHaveBeenCalledTimes(2));
    expect(placeBidAction.mock.calls[1][2]).toBe(placeBidAction.mock.calls[0][2]);

    fireEvent.change(box(), { target: { value: "12.00" } });
    placeBidAction.mockResolvedValueOnce({ error: "Your bid is below the minimum of €15.00.", minimumNextBidCents: 1500 });
    await placeWhenReady();
    await waitFor(() => expect(placeBidAction).toHaveBeenCalledTimes(3));
    expect(placeBidAction.mock.calls[2][2]).not.toBe(placeBidAction.mock.calls[0][2]);

    placeBidAction.mockResolvedValueOnce({ ok: true });
    await placeWhenReady();
    await waitFor(() => expect(placeBidAction).toHaveBeenCalledTimes(4));
    expect(placeBidAction.mock.calls[3][2]).not.toBe(placeBidAction.mock.calls[2][2]);
  });

  it("follows the minimum when someone else bids", () => {
    const { rerender } = render(panel("live", 1100));
    rerender(panel("live", 1300));
    expect(box().value).toBe("13.00");
    expect(screen.getByText(/Minimum bid: €13\.00/)).toBeTruthy();
  });

  it("tells the bidder who now leads what the price is, and says when the bid extended the auction", async () => {
    placeBidAction.mockResolvedValue({ ok: true, outcome: "LEADING", currentBidCents: 1200, yourMaxCents: 5000, extended: true, endsAt: "2026-11-02T12:15:00Z" });
    const { rerender } = render(panel("live", 1100));
    place();
    await confirmBid();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    rerender(panel("highest", 1260));
    expect(screen.getByText("You are the highest bidder.")).toBeTruthy();
    expect(screen.getByText(/You are the highest bidder at €12\.00/)).toBeTruthy();
    expect(screen.getByText(/extended and now ends/)).toBeTruthy();
  });

  it("tells a bidder beaten at once that someone has a higher maximum, what the price is now, and offers to raise", async () => {
    placeBidAction.mockResolvedValue({ ok: true, outcome: "OUTBID_BY_PROXY", currentBidCents: 2100, yourMaxCents: 2000 });
    render(panel("live", 1100));
    place();
    await confirmBid();
    await waitFor(() => expect(screen.getByText(/Someone has a higher maximum\. The price is now €21\.00/)).toBeTruthy());
    expect(screen.queryByText(/You are the highest bidder/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Raise your maximum" }));
    expect(document.activeElement).toBe(box());
  });

  it("tells a leader who raised their maximum what it is now", async () => {
    placeBidAction.mockResolvedValue({ ok: true, outcome: "MAX_RAISED", currentBidCents: 1200, yourMaxCents: 8000 });
    const { rerender } = render(panel("live", 1100));
    place();
    await confirmBid();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    rerender(panel("highest", 1260));
    expect(screen.getByText(/Your maximum is now €80\.00/)).toBeTruthy();
  });
});

describe("BidPanel for the person in front", () => {
  it("shows their own maximum and a box to raise it that starts one step above it", () => {
    render(leader(5000));
    expect(screen.getByText("You are the highest bidder.")).toBeTruthy();
    expect(screen.getByText(/Your maximum: €50\.00/)).toBeTruthy();
    expect(raiseBox().value).toBe("52.50");
    expect(screen.queryByLabelText("Your maximum bid (€)")).toBeNull();
  });

  it("shows no raise box when the maximum is not known (an API that does not send it)", () => {
    render(leader(null));
    expect(screen.getByText("You are the highest bidder.")).toBeTruthy();
    expect(screen.queryByLabelText("Raise your maximum (€)")).toBeNull();
    expect(screen.queryByText(/Your maximum:/)).toBeNull();
  });

  it("refuses, before sending, a new maximum that is not higher than the current one", () => {
    render(leader(5000));
    for (const value of ["50", "49.99", "lots"]) {
      fireEvent.change(raiseBox(), { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: /^raise maximum$/i }));
      expect(screen.getByRole("alert").textContent).toMatch(value === "lots" ? /Enter an amount/ : /must be higher than €50\.00/);
    }
    expect(placeBidAction).not.toHaveBeenCalled();
  });

  it("asks for a second click naming the new maximum, then sends it and reports the new maximum", async () => {
    placeBidAction.mockResolvedValue({ ok: true, outcome: "MAX_RAISED", currentBidCents: 1200, yourMaxCents: 8000 });
    const changed = vi.fn();
    render(leader(5000, changed));
    fireEvent.change(raiseBox(), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: /^raise maximum$/i }));
    expect(screen.getByText(/You are about to raise your maximum to/).textContent).toContain("€80.00");
    expect(placeBidAction).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /^confirm new maximum of €80\.00$/i }));
    await waitFor(() => expect(placeBidAction).toHaveBeenCalledWith("L1", 8000, expect.any(String)));
    await waitFor(() => expect(screen.getByText(/Your maximum is now €80\.00/)).toBeTruthy());
    expect(changed).toHaveBeenCalledWith(8000);
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a refusal from the server in words", async () => {
    placeBidAction.mockResolvedValue({ error: "Your new maximum must be higher than your current maximum." });
    render(leader(5000));
    fireEvent.click(screen.getByRole("button", { name: /^raise maximum$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^confirm new maximum of/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Your new maximum must be higher than your current maximum."));
  });

  it("follows the maximum when it changes elsewhere", () => {
    const { rerender } = render(leader(5000));
    rerender(leader(8000));
    expect(screen.getByText(/Your maximum: €80\.00/)).toBeTruthy();
    expect(raiseBox().value).toBe("84.00");
  });
});
