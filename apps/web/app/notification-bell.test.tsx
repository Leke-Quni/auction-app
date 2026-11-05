// @vitest-environment jsdom
import type { NotificationItem, NotificationList } from "@auction/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadNotificationsAction, markNotificationReadAction, dismissNotificationAction, clearNotificationsAction } = vi.hoisted(() => ({
  loadNotificationsAction: vi.fn(),
  markNotificationReadAction: vi.fn(),
  dismissNotificationAction: vi.fn(),
  clearNotificationsAction: vi.fn(),
}));
vi.mock("./notification-actions", () => ({ loadNotificationsAction, markNotificationReadAction, dismissNotificationAction, clearNotificationsAction }));

import { useNotificationStore } from "@/lib/notification-store";
import { describe as describeItem, NotificationBell, timeAgo } from "./notification-bell";

const outbid = (over: Partial<NotificationItem> = {}): NotificationItem =>
  ({
    id: "n1",
    type: "OUTBID",
    listingId: "l1",
    title: "Old watch",
    readAt: null,
    createdAt: new Date().toISOString(),
    data: { listingId: "l1", title: "Old watch", currentBidCents: 1200, minimumNextBidCents: 1300, endsAt: "2026-11-05T10:00:00.000Z", extended: false, extensionCount: 0 },
    ...over,
  }) as NotificationItem;
const extended = (final: boolean): NotificationItem =>
  ({
    id: "n2",
    type: "AUCTION_EXTENDED",
    listingId: "l2",
    title: "Blue vase",
    readAt: "2026-11-03T10:00:00.000Z",
    createdAt: new Date().toISOString(),
    data: { listingId: "l2", title: "Blue vase", endsAt: "2026-11-05T10:15:00.000Z", extensionCount: 1, final },
  }) as NotificationItem;
const list = (items: NotificationItem[], unreadCount = items.filter((i) => i.readAt === null).length): NotificationList => ({ items, unreadCount });

beforeEach(() => {
  loadNotificationsAction.mockReset();
  markNotificationReadAction.mockReset();
  dismissNotificationAction.mockReset();
  clearNotificationsAction.mockReset();
  useNotificationStore.getState().reset();
});
afterEach(cleanup);

describe("NotificationBell", () => {
  it("shows the unread count on the bell, and nothing when all are read", () => {
    render(<NotificationBell initial={list([outbid(), extended(false)])} />);
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeTruthy();
    cleanup();
    render(<NotificationBell initial={list([extended(false)])} />);
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
  });

  it("opens the list with each notification linking to its listing, without fetching when the list is fresh", () => {
    render(<NotificationBell initial={list([outbid(), extended(true)])} />);
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(screen.getByText("You've been outbid")).toBeTruthy();
    expect(screen.getByText("Old watch is now at €12.00.")).toBeTruthy();
    expect(screen.getByText("Final chance to bid")).toBeTruthy();
    expect(screen.getAllByRole("menuitem").map((a) => a.getAttribute("href"))).toEqual(["/listings/l1", "/listings/l2"]);
    expect(loadNotificationsAction).not.toHaveBeenCalled();
  });

  it("says so when there is nothing yet", () => {
    render(<NotificationBell initial={list([])} />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText(/You have no new notifications/)).toBeTruthy();
  });

  it("marks a notification read when it is clicked, and uses the count the server answers", async () => {
    markNotificationReadAction.mockResolvedValue(0);
    render(<NotificationBell initial={list([outbid()])} />);
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    fireEvent.click(screen.getByRole("menuitem"));
    expect(markNotificationReadAction).toHaveBeenCalledWith("n1");
    await waitFor(() => expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy());
    expect(useNotificationStore.getState().items[0].readAt).not.toBeNull();
  });

  it("does not call the server for one that is already read", () => {
    render(<NotificationBell initial={list([extended(false)])} />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    fireEvent.click(screen.getByRole("menuitem"));
    expect(markNotificationReadAction).not.toHaveBeenCalled();
  });

  it("shows a live count, and loads the list again on opening after a live notice", async () => {
    loadNotificationsAction.mockResolvedValue(list([outbid({ id: "n9" })], 1));
    render(<NotificationBell initial={list([])} />);
    act(() => useNotificationStore.getState().setUnread(3));
    expect(screen.getByRole("button", { name: "Notifications, 3 unread" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    await waitFor(() => expect(screen.getByText("You've been outbid")).toBeTruthy());
    expect(loadNotificationsAction).toHaveBeenCalledTimes(1);
  });

  it("loads the list on opening when the page could not", async () => {
    loadNotificationsAction.mockResolvedValue(list([outbid()]));
    render(<NotificationBell initial={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    await waitFor(() => expect(screen.getByText("You've been outbid")).toBeTruthy());
  });

  it("closes on Escape", () => {
    render(<NotificationBell initial={list([outbid()])} />);
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("helpers", () => {
  it("words each kind of notification", () => {
    expect(describeItem(extended(false))).toEqual({ heading: "Auction extended", text: "Blue vase was extended by a late bid." });
  });
  it("words question and answer notifications", () => {
    const data = { listingId: "l1", questionId: "q1", title: "Old watch", from: "sam", excerpt: "Does it run?" };
    const base = { id: "n3", listingId: "l1", title: "Old watch", readAt: null, createdAt: "2026-11-03T11:59:00.000Z" };
    expect(describeItem({ ...base, type: "QUESTION_ASKED", data })).toEqual({ heading: "New question", text: 'sam asked on Old watch: "Does it run?"' });
    expect(describeItem({ ...base, type: "QUESTION_ANSWERED", data })).toEqual({ heading: "Your question was answered", text: 'sam answered on Old watch: "Does it run?"' });
  });
  it("says how long ago", () => {
    const now = Date.parse("2026-11-03T12:00:00Z");
    const ago = (ms: number) => timeAgo(new Date(now - ms).toISOString(), now);
    expect([ago(10_000), ago(5 * 60_000), ago(3 * 3600_000), ago(2 * 86400_000)]).toEqual(["just now", "5 min ago", "3 h ago", "2 d ago"]);
  });

  it("shows a win as a pay-now notice that leads to the order, and an offer as such", () => {
    const won = (offered?: boolean) =>
      ({
        id: "w1",
        type: "WON",
        listingId: "l9",
        title: "Brass lamp",
        readAt: null,
        createdAt: new Date().toISOString(),
        data: { listingId: "l9", title: "Brass lamp", finalPriceCents: 3150, orderId: "o9", ...(offered ? { offered } : {}) },
      }) as NotificationItem;
    expect(describeItem(won())).toEqual({ heading: "You won the auction", text: "Brass lamp for €31.50. Pay now." });
    expect(describeItem(won(true)).heading).toBe("The item is yours to pay for");
    render(<NotificationBell initial={list([won()])} />);
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(screen.getByRole("menuitem").getAttribute("href")).toBe("/orders/o9");
  });

  it("removes one notification with its X and updates the unread count", async () => {
    dismissNotificationAction.mockResolvedValue(0);
    render(<NotificationBell initial={list([outbid(), extended(false)])} />);
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss: You've been outbid" }));
    await waitFor(() => expect(dismissNotificationAction).toHaveBeenCalledWith("n1"));
    expect(screen.queryByText("You've been outbid")).toBeNull();
    expect(screen.getByText("Auction extended")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
  });

  it("clears the whole inbox with Clear all", async () => {
    clearNotificationsAction.mockResolvedValue(true);
    render(<NotificationBell initial={list([outbid(), extended(true)])} />);
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all notifications" }));
    await waitFor(() => expect(clearNotificationsAction).toHaveBeenCalled());
    expect(screen.getByText(/You have no new notifications/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear all notifications" })).toBeNull();
  });

  it("puts the notifications back when the server could not remove them", async () => {
    dismissNotificationAction.mockResolvedValue(null);
    loadNotificationsAction.mockResolvedValue(list([outbid()]));
    render(<NotificationBell initial={list([outbid()])} />);
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss: You've been outbid" }));
    expect(await screen.findByText("You've been outbid")).toBeTruthy();
  });
});
