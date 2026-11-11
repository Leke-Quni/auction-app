import { io, type Socket } from "socket.io-client";

const apiUrl = () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function realtimeToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/realtime-token", { cache: "no-store" });
    return res.ok ? ((await res.json()) as { token: string | null }).token : null;
  } catch {
    return null;
  }
}

type Listener = (payload: never) => void;

// What a component sees of the connection: its own listeners, which `close` takes away again without touching anyone else's.
export interface RealtimeView {
  on: (event: string, listener: Listener) => void;
  emit: (event: string, ...args: unknown[]) => void;
}

interface Connection {
  socket: Socket;
  users: number;
  stop: () => void;
}

let shared: Connection | null = null;

// A WebSocket to the API. A signed-in visitor sends a fresh short-lived token on every (re)connect, which also puts
// them in their own private room. The server hangs up on a token it rejects, so the connection is reopened after a pause (not for a suspended account).
function connect(): Connection {
  let retry: ReturnType<typeof setTimeout> | undefined;
  let refusal: string | undefined;
  const socket = io(apiUrl(), {
    transports: ["websocket"],
    auth: (give) => void realtimeToken().then((token) => give(token ? { token } : {})),
  });
  // Why the server hung up, sent just before it does. A suspended account is not retried: it would be refused every time.
  socket.on("connect_error_auth", (info: { code?: string }) => {
    refusal = info?.code;
    // The page the person has open is told at once, whether they were just banned or connected as a banned account.
    if (refusal === "BANNED" && typeof window !== "undefined" && window.location.pathname !== "/suspended") window.location.assign("/suspended");
  });
  socket.on("disconnect", (reason) => {
    if (reason === "io server disconnect" && refusal !== "BANNED") retry = setTimeout(() => socket.connect(), 2000);
  });
  return {
    socket,
    users: 0,
    stop: () => {
      clearTimeout(retry);
      socket.close();
    },
  };
}

// The notifications in the layout and the page of a listing both listen, so they share one connection (and one token request),
// which is closed when the last of them lets go.
export function openRealtime(): { socket: RealtimeView; close: () => void } {
  const connection = (shared ??= connect());
  connection.users += 1;
  const added: [string, Listener][] = [];
  let closed = false;
  const view: RealtimeView = {
    on: (event, listener) => {
      connection.socket.on(event, listener as (...args: unknown[]) => void);
      added.push([event, listener]);
      // "connect" is only announced once, so a listener added to a connection that is already up is told at once.
      if (event === "connect" && connection.socket.connected) queueMicrotask(() => !closed && (listener as () => void)());
    },
    emit: (event, ...args) => void connection.socket.emit(event, ...args),
  };
  return {
    socket: view,
    close: () => {
      if (closed) return;
      closed = true;
      added.forEach(([event, listener]) => connection.socket.off(event, listener as (...args: unknown[]) => void));
      connection.users -= 1;
      if (connection.users === 0) {
        connection.stop();
        if (shared === connection) shared = null;
      }
    },
  };
}
