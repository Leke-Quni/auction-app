"use client";

import { formatEur, type NotificationItem, type NotificationList } from "@auction/shared";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useNotificationStore } from "@/lib/notification-store";
import { clearNotificationsAction, dismissNotificationAction, loadNotificationsAction, markNotificationReadAction } from "./notification-actions";

const MINUTE = 60_000;

export function timeAgo(iso: string, now = Date.now()) {
  const minutes = Math.floor((now - new Date(iso).getTime()) / MINUTE);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

// Where a notification leads: the order to pay for a win, otherwise its listing.
export const notificationHref = (item: NotificationItem) => (item.type === "WON" && item.data.orderId ? `/orders/${item.data.orderId}` : `/listings/${item.listingId}`);

export function describe(item: NotificationItem): { heading: string; text: string } {
  if (item.type === "OUTBID") {
    return { heading: "You've been outbid", text: `${item.title} is now at ${formatEur(item.data.currentBidCents)}.` };
  }
  if (item.type === "WON") {
    return item.data.offered
      ? { heading: "The item is yours to pay for", text: `The first buyer of ${item.title} did not pay, so it is offered to you at ${formatEur(item.data.finalPriceCents)}. Pay now.` }
      : { heading: "You won the auction", text: `${item.title} for ${formatEur(item.data.finalPriceCents)}. Pay now.` };
  }
  if (item.type === "QUESTION_ASKED") return { heading: "New question", text: `${item.data.from} asked on ${item.title}: "${item.data.excerpt}"` };
  if (item.type === "QUESTION_ANSWERED") return { heading: "Your question was answered", text: `${item.data.from} answered on ${item.title}: "${item.data.excerpt}"` };
  return item.data.final
    ? { heading: "Final chance to bid", text: `${item.title} was extended and cannot be extended again.` }
    : { heading: "Auction extended", text: `${item.title} was extended by a late bid.` };
}

// The bell in the header: an unread count and the latest saved notifications. The list the server rendered with the
// page is used until a live notice makes it stale, and then it is fetched again when the bell is opened.
export function NotificationBell({ initial }: { initial: NotificationList | null }) {
  const { items, unreadCount, seed, markRead, remove, clear, reset } = useNotificationStore();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    seed(initial);
    return reset;
  }, [initial, seed, reset]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = async () => {
    const opening = !open;
    setOpen(opening);
    if (opening && useNotificationStore.getState().stale) {
      setLoading(true);
      seed(await loadNotificationsAction());
      setLoading(false);
    }
  };

  const choose = async (item: NotificationItem) => {
    setOpen(false);
    if (item.readAt !== null) return;
    markRead(item.id);
    const count = await markNotificationReadAction(item.id);
    if (count !== null) markRead(item.id, count);
  };

  // The X on a notification and "Clear all": gone at once, and put back (by loading the list again) if the server refused.
  const dismiss = async (item: NotificationItem) => {
    remove(item.id);
    const count = await dismissNotificationAction(item.id);
    if (count === null) seed(await loadNotificationsAction());
    else remove(item.id, count);
  };

  const clearAll = async () => {
    clear();
    if (!(await clearNotificationsAction())) seed(await loadNotificationsAction());
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-full hover:bg-white/20"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" strokeLinejoin="round" />
          <path d="M10 19.5a2 2 0 0 0 4 0" strokeLinecap="round" />
        </svg>
        {unreadCount > 0 && (
          <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-4 rounded-full bg-urgent px-1 text-center text-[11px] font-bold leading-4 text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-10 mt-2 w-80 max-w-[calc(100vw-1rem)] whitespace-normal border border-line bg-white text-[#222] shadow-md">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <p className="font-bold">Notifications</p>
            {items.length > 0 && (
              <button type="button" onClick={() => void clearAll()} aria-label="Clear all notifications" className="cursor-pointer text-xs text-muted underline hover:text-urgent">
                Clear all
              </button>
            )}
          </div>
          {loading && items.length === 0 ? (
            <p className="px-3 py-3 text-muted">Loading...</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-3 text-muted">You have no new notifications.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((item) => {
                const { heading, text } = describe(item);
                return (
                  <li key={item.id} className="relative border-b border-line last:border-b-0">
                    <Link
                      role="menuitem"
                      href={notificationHref(item)}
                      onClick={() => void choose(item)}
                      className={`block py-2 pl-3 pr-9 hover:bg-[#f0f0f0] ${item.readAt === null ? "bg-[#f0fbf9]" : ""}`}
                    >
                      <span className="flex items-center gap-1.5">
                        {item.readAt === null && <span aria-label="Unread" className="h-2 w-2 shrink-0 rounded-full bg-brand" />}
                        <span className={item.readAt === null ? "font-bold" : ""}>{heading}</span>
                      </span>
                      <span className="block text-muted">{text}</span>
                      <span className="block text-xs text-muted">{timeAgo(item.createdAt)}</span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => void dismiss(item)}
                      aria-label={`Dismiss: ${heading}`}
                      className="absolute right-1.5 top-1.5 flex h-6 w-6 cursor-pointer items-center justify-center text-muted hover:text-urgent"
                    >
                      <span aria-hidden="true">✕</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
