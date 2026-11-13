// @vitest-environment jsdom
import type { ExtendedNotice, OutbidNotice } from "@auction/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

import { useNotificationStore } from "@/lib/notification-store";
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
  it("tells the winner they won, and offers a link to the auction", () => {
    vi.useFakeTimers();
    render(<Notifications />);
    push("notice:won", { listingId: "l9", title: "Old watch", finalPriceCents: 3150 });
    expect(screen.getByRole("status").textContent).toContain("You won the auction");
    expect(screen.getByRole("status").textContent).toContain("Old watch for €31.50");
    expect(screen.getByRole("link", { name: "Go to the auction" }).getAttribute("href")).toBe("/listings/l9");
    act(() => void vi.advanceTimersByTime(5_000));
    expect(screen.queryByRole("status")).toBeNull(); // like the others, it goes after 5 seconds
  });

  it("tells the next bidder the item is theirs to pay for, worded as an offer and not as a win", () => {
    render(<Notifications />);
    push("notice:won", { listingId: "l9", title: "Old watch", finalPriceCents: 2500, offered: true });
    const toast = screen.getByRole("status").textContent!;
    expect(toast).toContain("The item is yours to pay for");
    expect(toast).toContain("did not pay");
    expect(toast).toContain("€25.00");
    expect(toast).not.toContain("You won the auction");
  });

  it("shows a toast for a new question and for an answer, each linking to the listing", () => {
    render(<Notifications />);
    const notice = { listingId: "l3", questionId: "q1", title: "Old watch", from: "sam", excerpt: "Does it run?" };
    push("notice:question", notice);
    expect(screen.getByRole("status").textContent).toContain("New question");
    expect(screen.getByRole("status").textContent).toContain("sam asked on");
    expect(screen.getByRole("status").textContent).toContain("Does it run?");
    expect(screen.getByRole("link", { name: "Old watch" }).getAttribute("href")).toBe("/listings/l3");
    cleanup();
    render(<Notifications />);
    push("notice:answer", { ...notice, from: "seller1", excerpt: "Yes, it does." });
    expect(screen.getByRole("status").textContent).toContain("Your question was answered");
    expect(screen.getByRole("status").textContent).toContain("seller1 answered on");
  });

  it("shows nothing until something happens, and closes the connection when it goes away", () => {
    const { container, unmount } = render(<Notifications />);
    expect(container.firstChild).toBeNull();
    unmount();
    expect(close).toHaveBeenCalled();
  });

  it("tells the outbid bidder that someone's maximum is higher, with the price now and a link to raise their maximum", () => {
    render(<Notifications />);
    push("notice:outbid", outbid);
    const toast = screen.getByRole("alert").textContent!;
    expect(toast).toContain("You've been outbid");
    expect(toast).toContain("Someone's maximum is higher than yours");
    expect(toast).toContain("€12.00");
    expect(screen.getByRole("link", { name: "Old watch" }).getAttribute("href")).toBe("/listings/l1");
    expect(screen.getByRole("link", { name: "Raise your maximum" }).getAttribute("href")).toBe("/listings/l1");
  });

  it("offers no one-click bid: a minimum bid is an easily beaten maximum, so raising is done on the listing page", () => {
    render(<Notifications />);
    push("notice:outbid", outbid);
    expect(screen.queryByRole("button", { name: /^Bid / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    expect(placeBidAction).not.toHaveBeenCalled();
  });

  it("mentions the new end time when the outbidding bid extended the auction", () => {
    render(<Notifications />);
    push("notice:outbid", { ...outbid, extended: true, extensionCount: 1 });
    expect(screen.getByRole("alert").textContent).toContain("It was extended and now ends at");
  });

  it("replaces an older outbid toast for the same listing and dismisses on request", () => {
    render(<Notifications />);
    push("notice:outbid", outbid);
    push("notice:outbid", { ...outbid, currentBidCents: 1300, minimumNextBidCents: 1400 });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toContain("€13.00");
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
    expect(screen.getByRole("alert").textContent).toContain("€13.00");
    act(() => void vi.advanceTimersByTime(2_100));
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

  it("tells the bell the unread count when the server announces it", () => {
    render(<Notifications />);
    push("notifications:unread", { unreadCount: 4 });
    expect(useNotificationStore.getState().unreadCount).toBe(4);
    expect(useNotificationStore.getState().stale).toBe(true);
  });
});
