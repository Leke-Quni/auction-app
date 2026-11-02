// @vitest-environment jsdom
import type { ExtendedNotice, OutbidNotice } from "@auction/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (payload: unknown) => void>();
const close = vi.fn();
let pathname = "/";
const placeBidAction = vi.fn();

vi.mock("@/lib/realtime", () => ({
  openRealtime: () => ({ socket: { on: (event: string, fn: (payload: unknown) => void) => handlers.set(event, fn) }, close }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("./listings/[id]/bid-actions", () => ({ placeBidAction: (...args: unknown[]) => placeBidAction(...args) }));

import { Notifications } from "./notifications";

const outbid: OutbidNotice = {
  listingId: "l1",
  title: "Old watch",
  currentBidCents: 1200,
  minimumNextBidCents: 1300,
  endsAt: "2026-11-05T10:00:00.000Z",
  extended: false,
  extensionCount: 0,
};
const extended: ExtendedNotice = { listingId: "l2", title: "Blue vase", endsAt: "2026-11-05T10:15:00.000Z", extensionCount: 1, final: false };

const askAndConfirm = (amount = "€13.00") => {
  fireEvent.click(screen.getByRole("button", { name: `Bid ${amount}` }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
};

const push = (event: string, payload: unknown) => act(() => handlers.get(event)!(payload));

beforeEach(() => {
  handlers.clear();
  pathname = "/";
  placeBidAction.mockReset();
  close.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Notifications", () => {
  it("shows nothing until something happens, and closes the connection when it goes away", () => {
    const { container, unmount } = render(<Notifications />);
    expect(container.firstChild).toBeNull();
    unmount();
    expect(close).toHaveBeenCalled();
  });

  it("shows an outbid toast with the title, the current bid and a one-click bid at the minimum", () => {
    render(<Notifications />);
    push("notice:outbid", outbid);
    expect(screen.getByRole("alert").textContent).toContain("You've been outbid");
    expect(screen.getByRole("link", { name: "Old watch" }).getAttribute("href")).toBe("/listings/l1");
    expect(screen.getByRole("alert").textContent).toContain("€12.00");
    expect(screen.getByRole("button", { name: "Bid €13.00" })).toBeTruthy();
  });

  it("mentions the new end time when the outbidding bid extended the auction", () => {
    render(<Notifications />);
    push("notice:outbid", { ...outbid, extended: true, extensionCount: 1 });
    expect(screen.getByRole("alert").textContent).toContain("It was extended and now ends at");
  });

  it("places the minimum bid once it is confirmed, and says so", async () => {
    placeBidAction.mockResolvedValue({ ok: true });
    render(<Notifications />);
    push("notice:outbid", outbid);
    askAndConfirm();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("was placed"));
    expect(placeBidAction).toHaveBeenCalledWith("l1", 1300, expect.any(String));
  });

  it("asks before bidding, and waits as long as it takes without bidding", () => {
    vi.useFakeTimers();
    render(<Notifications />);
    push("notice:outbid", outbid);
    act(() => void vi.advanceTimersByTime(4_000));
    fireEvent.click(screen.getByRole("button", { name: "Bid €13.00" }));
    expect(screen.getByRole("alert").textContent).toContain("A bid cannot be withdrawn");
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(placeBidAction).not.toHaveBeenCalled();
  });

  it("goes back to the plain toast on cancel, with a fresh 5 seconds and no bid", () => {
    vi.useFakeTimers();
    render(<Notifications />);
    push("notice:outbid", outbid);
    fireEvent.click(screen.getByRole("button", { name: "Bid €13.00" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Bid €13.00" })).toBeTruthy();
    act(() => void vi.advanceTimersByTime(4_900));
    expect(screen.getByRole("alert")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(placeBidAction).not.toHaveBeenCalled();
  });

  it("when the minimum has moved on, shows the reason and offers the new minimum", async () => {
    placeBidAction.mockResolvedValue({ error: "Your bid is below the minimum of €14.00.", minimumNextBidCents: 1400 });
    render(<Notifications />);
    push("notice:outbid", outbid);
    askAndConfirm();
    await waitFor(() => expect(screen.getByRole("button", { name: "Bid €14.00" })).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("below the minimum of €14.00");
  });

  it("keeps one key for a retried click and a new one for a new amount", async () => {
    placeBidAction.mockResolvedValueOnce({ error: "No answer", retry: true }).mockResolvedValueOnce({ error: "Too low", minimumNextBidCents: 1400 });
    render(<Notifications />);
    push("notice:outbid", outbid);
    askAndConfirm();
    await waitFor(() => expect(screen.getByText("No answer")).toBeTruthy());
    askAndConfirm();
    await waitFor(() => expect(screen.getByRole("button", { name: "Bid €14.00" })).toBeTruthy());
    expect(placeBidAction.mock.calls[0][2]).toBe(placeBidAction.mock.calls[1][2]);
  });

  it("replaces an older outbid toast for the same listing and dismisses on request", () => {
    render(<Notifications />);
    push("notice:outbid", outbid);
    push("notice:outbid", { ...outbid, currentBidCents: 1300, minimumNextBidCents: 1400 });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Bid €14.00" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("toasts an extension on other pages", () => {
    render(<Notifications />);
    push("notice:extended", extended);
    expect(screen.getByRole("status").textContent).toContain("Auction extended");
    expect(screen.getByRole("status").textContent).toContain("Blue vase");
  });

  it("clears every kind of toast after 5 seconds", () => {
    vi.useFakeTimers();
    render(<Notifications />);
    push("notice:outbid", outbid);
    push("notice:extended", extended);
    act(() => void vi.advanceTimersByTime(4_900));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("gives a replacing toast its own full 5 seconds", () => {
    vi.useFakeTimers();
    render(<Notifications />);
    push("notice:outbid", outbid);
    act(() => void vi.advanceTimersByTime(3_000));
    push("notice:outbid", { ...outbid, currentBidCents: 1300, minimumNextBidCents: 1400 });
    act(() => void vi.advanceTimersByTime(3_000));
    expect(screen.getByRole("button", { name: "Bid €14.00" })).toBeTruthy();
    act(() => void vi.advanceTimersByTime(2_100));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the toast while a bid is being placed, then shows the outcome for 5 seconds", async () => {
    vi.useFakeTimers();
    let finish: (value: unknown) => void = () => {};
    placeBidAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<Notifications />);
    push("notice:outbid", outbid);
    act(() => void vi.advanceTimersByTime(4_000));
    askAndConfirm();
    act(() => void vi.advanceTimersByTime(20_000));
    expect(screen.getByRole("alert").textContent).toContain("Placing bid");
    await act(async () => finish({ ok: true }));
    expect(screen.getByRole("alert").textContent).toContain("was placed");
    act(() => void vi.advanceTimersByTime(5_100));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("marks the last extension as a final chance", () => {
    render(<Notifications />);
    push("notice:extended", { ...extended, extensionCount: 2, final: true });
    expect(screen.getByRole("status").textContent).toContain("Final chance to bid");
    expect(screen.getByRole("status").textContent).toContain("cannot be extended again");
  });

  it("skips the extension toast on the listing page itself, which already shows it", () => {
    pathname = "/listings/l2";
    render(<Notifications />);
    push("notice:extended", extended);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
