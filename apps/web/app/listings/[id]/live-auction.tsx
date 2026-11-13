"use client";

import type { AuctionExtendedEvent, BidPlacedEvent } from "@auction/shared";
import { BID_HISTORY_SHOWN, SOCKET_EVENTS } from "@auction/shared";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { openRealtime } from "@/lib/realtime";
import type { BidRow } from "./bid-history";

export interface LiveSnapshot {
  currentBidCents: number | null;
  bidCount: number;
  highBidder: { id: string; username: string } | null;
  minimumNextBidCents: number;
  endsAt: string | null;
  extensionCount: number;
  serverTime: string;
  // The signed-in viewer's own hidden maximum on this auction, or null if they have none. Nobody else is ever sent it.
  viewerMaxCents: number | null;
  bids: BidRow[];
}

// A maximum only ever rises, so whichever of two copies is higher is the newer one.
const higher = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));

// The rows an event carries; an older server sends only the top one.
const rowsOf = (event: BidPlacedEvent) => event.bids ?? [event.bid];

// True when the event skips bids this page never saw, so it must ask the server for the whole picture. A bid can add several
// rows (a defended bid makes two), so the gap is measured against the rows in the event, not against one.
export function missedBids(heldCount: number, event: BidPlacedEvent): boolean {
  return event.bidCount > heldCount + rowsOf(event).length;
}

export interface LiveState extends LiveSnapshot {
  sync: (snapshot: LiveSnapshot) => void;
  setViewerMax: (cents: number) => void;
  applyBid: (event: BidPlacedEvent) => void;
  applyExtended: (event: AuctionExtendedEvent) => void;
}

// Only the live part of the page: what the server sent, plus what the WebSocket has said since. Anything older than
// what is already held is ignored, so a late or repeated message can never move the page backwards.
export function createLiveStore(initial: LiveSnapshot): StoreApi<LiveState> {
  return createStore<LiveState>((set, get) => ({
    ...initial,
    sync: (snapshot) => {
      if (snapshot.bidCount >= get().bidCount) set({ ...snapshot, viewerMaxCents: higher(get().viewerMaxCents, snapshot.viewerMaxCents) });
    },
    setViewerMax: (cents) => set({ viewerMaxCents: higher(get().viewerMaxCents, cents) }),
    applyBid: (event) => {
      const state = get();
      if (event.bidCount <= state.bidCount) return;
      const rows: BidRow[] = rowsOf(event);
      set({
        currentBidCents: event.currentBidCents,
        bidCount: event.bidCount,
        highBidder: event.highBidder,
        minimumNextBidCents: event.minimumNextBidCents,
        endsAt: event.endsAt,
        extensionCount: event.extensionCount,
        serverTime: event.serverTime,
        bids: [...[...rows].reverse(), ...state.bids.filter((b) => !rows.some((r) => r.id === b.id))].slice(0, BID_HISTORY_SHOWN),
      });
    },
    applyExtended: (event) => {
      const state = get();
      if (event.extensionCount < state.extensionCount) return;
      set({ endsAt: event.endsAt, extensionCount: event.extensionCount, serverTime: event.serverTime });
    },
  }));
}

const LiveContext = createContext<StoreApi<LiveState> | null>(null);

export function useLive<T>(select: (state: LiveState) => T): T {
  const store = useContext(LiveContext);
  if (!store) throw new Error("useLive must be used inside LiveAuction");
  return useStore(store, select);
}

// Keeps the store current over a WebSocket. The API machine can stop at any time, so the page does not rely on the
// connection: after every (re)connect and after any gap in the bids it asks the server for the whole picture again.
export function LiveAuction({ listingId, snapshot, connect, children }: { listingId: string; snapshot: LiveSnapshot; connect: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const [store] = useState(() => createLiveStore(snapshot));

  useEffect(() => {
    store.getState().sync(snapshot);
  }, [snapshot.bidCount, snapshot.endsAt, snapshot.extensionCount, snapshot.serverTime, snapshot.viewerMaxCents]);

  useEffect(() => {
    if (!connect) return;
    const { socket, close } = openRealtime();
    socket.on("connect", () => {
      socket.emit(SOCKET_EVENTS.watch, listingId);
      // Bids placed before this moment (while the page loaded or the connection was down) were never pushed to us.
      router.refresh();
    });
    socket.on(SOCKET_EVENTS.bidPlaced, (event: BidPlacedEvent) => {
      if (event.listingId !== listingId) return;
      const held = store.getState().bidCount;
      store.getState().applyBid(event);
      if (missedBids(held, event)) router.refresh();
    });
    socket.on(SOCKET_EVENTS.auctionExtended, (event: AuctionExtendedEvent) => {
      if (event.listingId === listingId) store.getState().applyExtended(event);
    });
    // The connection is shared with the notifications, so the room is left explicitly rather than by hanging up.
    return () => {
      socket.emit(SOCKET_EVENTS.unwatch, listingId);
      close();
    };
  }, [connect, listingId, router, store]);

  return <LiveContext.Provider value={store}>{children}</LiveContext.Provider>;
}
