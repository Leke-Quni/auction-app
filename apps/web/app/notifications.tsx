"use client";

import { formatEur, SOCKET_EVENTS, type ExtendedNotice, type OutbidNotice, type QuestionNotice, type UnreadEvent, type WonNotice } from "@auction/shared";
import { MotionConfig, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useNotificationStore } from "@/lib/notification-store";
import { openRealtime } from "@/lib/realtime";
import { LocalTime } from "./local-time";

type Toast =
  | { id: string; v: number; kind: "outbid"; notice: OutbidNotice }
  | { id: string; v: number; kind: "extended"; notice: ExtendedNotice }
  | { id: string; v: number; kind: "won"; notice: WonNotice }
  | { id: string; v: number; kind: "question" | "answer"; notice: QuestionNotice };

const TOAST_MS = 5_000;

// Private notices for a signed-in visitor, on every page: "You've been outbid" with a link to raise their maximum, and a heads-up
// when an auction they bid on is extended. Toasts vanish after a few seconds, and anything missed while disconnected
// is not replayed; the outbid email covers it.
export function Notifications() {
  const pathname = usePathname();
  const [toasts, setToasts] = useState<Toast[]>([]);
  // The page being viewed already shows an extension, so it needs no toast. A ref keeps the connection from reopening on every page.
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
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

  useEffect(() => {
    const { socket, close } = openRealtime();
    const pending = timers.current;
    socket.on(SOCKET_EVENTS.outbid, (notice: OutbidNotice) => {
      show({ id: `outbid:${notice.listingId}`, v: 0, kind: "outbid", notice });
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

  if (toasts.length === 0) return null;
  return (
    <MotionConfig reducedMotion="user">
    <div className="fixed bottom-4 right-4 z-40 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((toast) => {
        const tone = toast.kind === "extended" && !toast.notice.final ? "teal" : "amber";
        return (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            role={toast.kind === "outbid" ? "alert" : "status"}
            className="relative overflow-hidden rounded-lg border border-line bg-surface shadow-xl"
          >
            <div className="flex gap-3 p-3 pr-8">
              {toast.kind === "extended" && (
                <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-brand ${tone === "teal" ? "bg-brand" : "bg-time-warn"}`}>
                  ⏱
                </span>
              )}
              <div className="min-w-0 flex-1">
                {toast.kind === "outbid" ? <OutbidBody notice={toast.notice} onThatPage={pathname.startsWith(`/listings/${toast.notice.listingId}`)} /> : toast.kind === "extended" ? <ExtendedBody notice={toast.notice} /> : toast.kind === "won" ? <WonBody notice={toast.notice} /> : <QuestionBody kind={toast.kind} notice={toast.notice} />}
              </div>
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(toast.id)} className="absolute right-2 top-1 cursor-pointer text-muted hover:text-ink">
              ✕
            </button>
            {/* Shrinks over the toast's lifetime. */}
            <div key={toast.v} className="absolute bottom-0 left-0 h-1 bg-brand" style={{ animation: `toast-timer ${TOAST_MS}ms linear forwards` }} />
          </motion.div>
        );
      })}
    </div>
    </MotionConfig>
  );
}

const link = "font-bold text-brand underline";

// On the listing's own page the bid box is already in view, so a link to the page it is on would do nothing.
function OutbidBody({ notice, onThatPage }: { notice: OutbidNotice; onThatPage: boolean }) {
  return (
    <div className="space-y-1.5">
      <p className="font-bold">You&apos;ve been outbid</p>
      <p className="text-muted">
        Someone&apos;s maximum is higher than yours on{" "}
        <Link href={`/listings/${notice.listingId}`} className={link}>
          {notice.title}
        </Link>
        . The price is now {formatEur(notice.currentBidCents)}.
        {notice.extended && (
          <>
            {" "}
            It was extended and now ends at <LocalTime iso={notice.endsAt} timeFirst />.
          </>
        )}
      </p>
      {!onThatPage && (
        <Link href={`/listings/${notice.listingId}`} className="block w-full rounded bg-brand px-3 py-1.5 text-center font-bold text-on-brand hover:bg-brand-dark">
          Raise your maximum
        </Link>
      )}
    </div>
  );
}

function WonBody({ notice }: { notice: WonNotice }) {
  if (notice.reminder) {
    return (
      <div className="space-y-1.5">
        <p className="font-bold">Less than 24 hours left to pay</p>
        <p className="text-muted">{`Pay for ${notice.title} (${formatEur(notice.finalPriceCents)}) or it will be offered to someone else.`}</p>
        <Link href={notice.orderId ? `/orders/${notice.orderId}` : `/listings/${notice.listingId}`} className="block w-full rounded bg-brand px-3 py-1.5 text-center font-bold text-on-brand hover:bg-brand-dark">
          Pay now
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className="font-bold">{notice.offered ? "The item is yours to pay for" : "You won the auction"}</p>
      <p className="text-muted">
        {notice.offered ? `The first buyer of ${notice.title} did not pay, so it is offered to you at ${formatEur(notice.finalPriceCents)}.` : `${notice.title} for ${formatEur(notice.finalPriceCents)}.`}
      </p>
      <Link href={`/listings/${notice.listingId}`} className="block w-full rounded bg-brand px-3 py-1.5 text-center font-bold text-on-brand hover:bg-brand-dark">
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
