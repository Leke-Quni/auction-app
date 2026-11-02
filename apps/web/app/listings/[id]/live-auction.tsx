"use client";

import type { AuctionExtendedEvent, BidPlacedEvent } from "@auction/shared";
import { SOCKET_EVENTS } from "@auction/shared";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { BidRow } from "./bid-history";

const HISTORY_SHOWN = 20;

export interface LiveSnapshot {
  currentBidCents: number | null;
  bidCount: number;
  highBidder: { id: string; username: string } | null;
  minimumNextBidCents: number;
  endsAt: string | null;
  extensionCount: number;
  serverTime: string;
  bids: BidRow[];
}

export interface LiveState extends LiveSnapshot {
  sync: (snapshot: LiveSnapshot) => void;
  applyBid: (event: BidPlacedEvent) => void;
  applyExtended: (event: AuctionExtendedEvent) => void;
}

// Only the live part of the page: what the server sent, plus what the WebSocket has said since. Anything older than
// what is already held is ignored, so a late or repeated message can never move the page backwards.
export function createLiveStore(initial: LiveSnapshot): StoreApi<LiveState> {
  return createStore<LiveState>((set, get) => ({
    ...initial,
    sync: (snapshot) => {
      if (snapshot.bidCount >= get().bidCount) set({ ...snapshot });
    },
    applyBid: (event) => {
      const state = get();
      if (event.bidCount <= state.bidCount) return;
      const row: BidRow = event.bid;
      set({
        currentBidCents: event.currentBidCents,
        bidCount: event.bidCount,
        highBidder: event.highBidder,
        minimumNextBidCents: event.minimumNextBidCents,
        endsAt: event.endsAt,
        extensionCount: event.extensionCount,
        serverTime: event.serverTime,
        bids: [row, ...state.bids.filter((b) => b.id !== row.id)].slice(0, HISTORY_SHOWN),
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

const apiUrl = () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function realtimeToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/realtime-token", { cache: "no-store" });
    return res.ok ? ((await res.json()) as { token: string | null }).token : null;
  } catch {
    return null;
  }
}

// Keeps the store current over a WebSocket. The API machine can stop at any time, so the page does not rely on the
// connection: after every (re)connect and after any gap in the bids it asks the server for the whole picture again.
export function LiveAuction({ listingId, snapshot, connect, children }: { listingId: string; snapshot: LiveSnapshot; connect: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const [store] = useState(() => createLiveStore(snapshot));

  useEffect(() => {
    store.getState().sync(snapshot);
  }, [snapshot.bidCount, snapshot.endsAt, snapshot.extensionCount, snapshot.serverTime]);

  useEffect(() => {
    if (!connect) return;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const socket = io(apiUrl(), {
      transports: ["websocket"],
      auth: (give) => void realtimeToken().then((token) => give(token ? { token } : {})),
    });
    socket.on("connect", () => {
      socket.emit(SOCKET_EVENTS.watch, listingId);
      // Bids placed before this moment (while the page loaded or the connection was down) were never pushed to us.
      router.refresh();
    });
    // The server hangs up on a token it rejects; fetch a fresh one and join again.
    socket.on("disconnect", (reason) => {
      if (reason === "io server disconnect") retry = setTimeout(() => socket.connect(), 2000);
    });
    socket.on(SOCKET_EVENTS.bidPlaced, (event: BidPlacedEvent) => {
      if (event.listingId !== listingId) return;
      const held = store.getState().bidCount;
      store.getState().applyBid(event);
      if (event.bidCount > held + 1) router.refresh();
    });
    socket.on(SOCKET_EVENTS.auctionExtended, (event: AuctionExtendedEvent) => {
      if (event.listingId === listingId) store.getState().applyExtended(event);
    });
    return () => {
      clearTimeout(retry);
      socket.close();
    };
  }, [connect, listingId, router, store]);

  return <LiveContext.Provider value={store}>{children}</LiveContext.Provider>;
}
