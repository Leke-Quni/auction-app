"use client";

import { formatEur, SOCKET_EVENTS, type ExtendedNotice, type OutbidNotice, type QuestionNotice, type UnreadEvent, type WonNotice } from "@auction/shared";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useNotificationStore } from "@/lib/notification-store";
import { openRealtime } from "@/lib/realtime";
import { LocalTime } from "./local-time";
import { placeBidAction } from "./listings/[id]/bid-actions";

type Toast =
  | { id: string; v: number; kind: "outbid"; notice: OutbidNotice; state: "idle" | "confirm" | "pending" | "placed"; error: string }
  | { id: string; v: number; kind: "extended"; notice: ExtendedNotice }
  | { id: string; v: number; kind: "won"; notice: WonNotice }
  | { id: string; v: number; kind: "question" | "answer"; notice: QuestionNotice };
type OutbidToast = Extract<Toast, { kind: "outbid" }>;

const TOAST_MS = 5_000;

// Private notices for a signed-in visitor, on every page: "You've been outbid" with a one-click bid, and a heads-up
// when an auction they bid on is extended. Toasts vanish after a few seconds, and anything missed while disconnected
// is not replayed; the outbid email covers it.
export function Notifications() {
  const pathname = usePathname();
  const [toasts, setToasts] = useState<Toast[]>([]);
  // The page being viewed already shows an extension, so it needs no toast. A ref keeps the connection from reopening on every page.
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  // One key per bid amount, kept while the answer is unknown, so a retried click can never bid twice.
  const keys = useRef(new Map<string, string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const stopTimer = (id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  };
  const dismiss = (id: string) => {
    stopTimer(id);
    setToasts((all) => all.filter((t) => t.id !== id));
  };
  // (Re)starts a toast's countdown; a newer toast for the same thing must not be cut short by an older timer.
  const startTimer = (id: string) => {
    stopTimer(id);
    timers.current.set(id, setTimeout(() => dismiss(id), TOAST_MS));
  };
  const show = (toast: Toast) => {
    setToasts((all) => [...all.filter((t) => t.id !== toast.id), toast]);
    startTimer(toast.id);
  };
  const update = (id: string, change: Partial<OutbidToast>) =>
    setToasts((all) => all.map((t) => (t.id === id && t.kind === "outbid" ? { ...t, ...change, v: t.v + 1 } : t)));

  useEffect(() => {
    const { socket, close } = openRealtime();
    const pending = timers.current;
    socket.on(SOCKET_EVENTS.outbid, (notice: OutbidNotice) => {
      show({ id: `outbid:${notice.listingId}`, v: 0, kind: "outbid", notice, state: "idle", error: "" });
    });
    socket.on(SOCKET_EVENTS.extendedNotice, (notice: ExtendedNotice) => {
      if (pathRef.current.startsWith(`/listings/${notice.listingId}`)) return;
      show({ id: `extended:${notice.listingId}`, v: 0, kind: "extended", notice });
    });
    socket.on(SOCKET_EVENTS.wonNotice, (notice: WonNotice) => {
      show({ id: `won:${notice.listingId}`, v: 0, kind: "won", notice });
    });
    socket.on(SOCKET_EVENTS.questionNotice, (notice: QuestionNotice) => {
      show({ id: `question:${notice.questionId}`, v: 0, kind: "question", notice });
    });
    socket.on(SOCKET_EVENTS.answerNotice, (notice: QuestionNotice) => {
      show({ id: `answer:${notice.questionId}`, v: 0, kind: "answer", notice });
    });
    // Each live notice is also saved; the server says how many are unread, and the bell shows it.
    socket.on(SOCKET_EVENTS.unread, (event: UnreadEvent) => useNotificationStore.getState().setUnread(event.unreadCount));
    return () => {
      close();
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  // The first click only asks; nothing is bid until the second, and the clock stands still while it waits.
  const ask = (toast: OutbidToast) => {
    stopTimer(toast.id);
    update(toast.id, { state: "confirm", error: "" });
  };
  const cancel = (toast: OutbidToast) => {
    update(toast.id, { state: "idle" });
    startTimer(toast.id);
  };

  const bidNow = async (toast: OutbidToast) => {
    const { listingId, minimumNextBidCents: cents } = toast.notice;
    const keyId = `${listingId}:${cents}`;
    if (!keys.current.has(keyId)) keys.current.set(keyId, crypto.randomUUID());
    // The toast stays while the bid is in flight, so its outcome is never lost.
    stopTimer(toast.id);
    update(toast.id, { state: "pending", error: "" });
    const result = await placeBidAction(listingId, cents, keys.current.get(keyId)!);
    if (result.ok) {
      update(toast.id, { state: "placed" });
    } else {
      if (!result.retry) keys.current.delete(keyId);
      update(toast.id, {
        state: "idle",
        error: result.error ?? "That bid could not be placed.",
        notice: result.minimumNextBidCents !== undefined ? { ...toast.notice, minimumNextBidCents: result.minimumNextBidCents } : toast.notice,
      });
    }
    startTimer(toast.id);
  };

  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-40 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((toast) => {
        const tone = toast.kind === "extended" && !toast.notice.final ? "teal" : "amber";
        return (
          <div
            key={toast.id}
            role={toast.kind === "outbid" ? "alert" : "status"}
            className="relative overflow-hidden rounded-lg border border-line bg-white shadow-xl"
          >
            <div className="flex gap-3 p-3 pr-8">
              {toast.kind === "extended" && (
                <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white ${tone === "teal" ? "bg-brand" : "bg-time-warn"}`}>
                  ⏱
                </span>
              )}
              <div className="min-w-0 flex-1">
                {toast.kind === "outbid" ? <OutbidBody toast={toast} onAsk={() => ask(toast)} onCancel={() => cancel(toast)} onConfirm={() => bidNow(toast)} /> : toast.kind === "extended" ? <ExtendedBody notice={toast.notice} /> : toast.kind === "won" ? <WonBody notice={toast.notice} /> : <QuestionBody kind={toast.kind} notice={toast.notice} />}
              </div>
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(toast.id)} className="absolute right-2 top-1 cursor-pointer text-muted hover:text-black">
              ✕
            </button>
            {/* Shrinks over the toast's lifetime; stands still while a bid is being confirmed or placed. */}
            <div
              key={toast.v}
              className="absolute bottom-0 left-0 h-1 bg-brand"
              style={{ animation: `toast-timer ${TOAST_MS}ms linear forwards`, animationPlayState: toast.kind === "outbid" && (toast.state === "pending" || toast.state === "confirm") ? "paused" : "running" }}
            />
          </div>
        );
      })}
    </div>
  );
}

const link = "font-bold text-brand underline";

function OutbidBody({ toast, onAsk, onCancel, onConfirm }: { toast: OutbidToast; onAsk: () => void; onCancel: () => void; onConfirm: () => void }) {
  const { notice, state, error } = toast;
  if (state === "placed") {
    return (
      <p>
        Your bid on{" "}
        <Link href={`/listings/${notice.listingId}`} className={link}>
          {notice.title}
        </Link>{" "}
        was placed.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className="font-bold">You&apos;ve been outbid</p>
      <p className="text-muted">
        <Link href={`/listings/${notice.listingId}`} className={link}>
          {notice.title}
        </Link>{" "}
        is now at {formatEur(notice.currentBidCents)}.
        {notice.extended && (
          <>
            {" "}
            It was extended and now ends at <LocalTime iso={notice.endsAt} timeFirst />.
          </>
        )}
      </p>
      {error && <p className="font-bold text-time-warn">{error}</p>}
      {state === "idle" ? (
        <button type="button" onClick={onAsk} className="w-full cursor-pointer rounded bg-brand px-3 py-1.5 font-bold text-white hover:bg-brand-dark">
          Bid {formatEur(notice.minimumNextBidCents)}
        </button>
      ) : (
        <div className="space-y-1.5">
          <p className="font-bold">Bid {formatEur(notice.minimumNextBidCents)}? A bid cannot be withdrawn.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onConfirm}
              disabled={state === "pending"}
              className="flex-1 cursor-pointer rounded bg-brand px-3 py-1.5 font-bold text-white hover:bg-brand-dark disabled:opacity-60"
            >
              {state === "pending" ? "Placing bid..." : "Confirm"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={state === "pending"}
              className="cursor-pointer rounded border border-line px-3 py-1.5 hover:bg-[#f0f0f0] disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WonBody({ notice }: { notice: WonNotice }) {
  return (
    <div className="space-y-1.5">
      <p className="font-bold">You won the auction</p>
      <p className="text-muted">
        {notice.title} for {formatEur(notice.finalPriceCents)}.
      </p>
      <Link href={`/listings/${notice.listingId}`} className="block w-full rounded bg-brand px-3 py-1.5 text-center font-bold text-white hover:bg-brand-dark">
        Go to the auction
      </Link>
    </div>
  );
}

function QuestionBody({ kind, notice }: { kind: "question" | "answer"; notice: QuestionNotice }) {
  return (
    <div className="space-y-0.5">
      <p className="font-bold">{kind === "question" ? "New question" : "Your question was answered"}</p>
      <p className="text-muted">
        {notice.from} {kind === "question" ? "asked on" : "answered on"}{" "}
        <Link href={`/listings/${notice.listingId}`} className={link}>
          {notice.title}
        </Link>
        : &ldquo;{notice.excerpt}&rdquo;
      </p>
    </div>
  );
}

function ExtendedBody({ notice }: { notice: ExtendedNotice }) {
  return (
    <div className="space-y-0.5">
      <p className="font-bold">{notice.final ? "Final chance to bid" : "Auction extended"}</p>
      <p className="text-muted">
        <Link href={`/listings/${notice.listingId}`} className={link}>
          {notice.title}
        </Link>{" "}
        now ends at <LocalTime iso={notice.endsAt} timeFirst />.{notice.final && " It cannot be extended again."}
      </p>
    </div>
  );
}
