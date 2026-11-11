import { beforeEach, describe, expect, it, vi } from "vitest";

type Fn = (...args: unknown[]) => void;

const { io, sockets } = vi.hoisted(() => {
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    connected = false;
    listeners = new Map<string, Set<Fn>>();
    emitted: unknown[][] = [];
    close = vi.fn();
    connect = vi.fn();
    on(event: string, fn: Fn) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event)!.add(fn);
    }
    off(event: string, fn: Fn) {
      this.listeners.get(event)?.delete(fn);
    }
    emit(...args: unknown[]) {
      this.emitted.push(args);
    }
    fire(event: string, ...args: unknown[]) {
      this.listeners.get(event)?.forEach((fn) => fn(...args));
    }
  }
  const io = vi.fn(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });
  return { io, sockets };
});
vi.mock("socket.io-client", () => ({ io }));

import { openRealtime } from "./realtime";

beforeEach(() => {
  io.mockClear();
  sockets.length = 0;
});

describe("the shared realtime connection", () => {
  it("opens one socket for everyone who listens, and closes it when the last one lets go", () => {
    const a = openRealtime();
    const b = openRealtime();
    expect(io).toHaveBeenCalledTimes(1);
    a.close();
    expect(sockets[0].close).not.toHaveBeenCalled();
    b.close();
    expect(sockets[0].close).toHaveBeenCalledTimes(1);
  });

  it("opens a new socket once the old one has been closed", () => {
    openRealtime().close();
    openRealtime().close();
    expect(io).toHaveBeenCalledTimes(2);
  });

  it("takes away only the closing listener's handlers", () => {
    const a = openRealtime();
    const b = openRealtime();
    const forA = vi.fn();
    const forB = vi.fn();
    a.socket.on("notice:outbid", forA);
    b.socket.on("notice:outbid", forB);
    a.close();
    sockets[0].fire("notice:outbid", { listingId: "L1" });
    expect(forA).not.toHaveBeenCalled();
    expect(forB).toHaveBeenCalledTimes(1);
    b.close();
  });

  it("tells a 'connect' listener added to a connection that is already up, once", async () => {
    const first = openRealtime();
    sockets[0].connected = true;
    const second = openRealtime();
    const onConnect = vi.fn();
    second.socket.on("connect", onConnect);
    await Promise.resolve();
    expect(onConnect).toHaveBeenCalledTimes(1);
    first.close();
    second.close();
  });

  it("does not tell a listener that closed before the announcement", async () => {
    const first = openRealtime();
    sockets[0].connected = true;
    const second = openRealtime();
    const onConnect = vi.fn();
    second.socket.on("connect", onConnect);
    second.close();
    await Promise.resolve();
    expect(onConnect).not.toHaveBeenCalled();
    first.close();
  });

  it("passes emits through to the shared socket", () => {
    const a = openRealtime();
    a.socket.emit("watch", "L1");
    expect(sockets[0].emitted).toEqual([["watch", "L1"]]);
    a.close();
  });

  it("ignores a second close from the same listener", () => {
    const a = openRealtime();
    const b = openRealtime();
    a.close();
    a.close();
    expect(sockets[0].close).not.toHaveBeenCalled();
    b.close();
    expect(sockets[0].close).toHaveBeenCalledTimes(1);
  });
});
