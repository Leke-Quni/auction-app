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

// A WebSocket to the API. A signed-in visitor sends a fresh short-lived token on every (re)connect, which also puts
// them in their own private room. The server hangs up on a token it rejects, so the connection is reopened after a pause.
export function openRealtime(): { socket: Socket; close: () => void } {
  let retry: ReturnType<typeof setTimeout> | undefined;
  const socket = io(apiUrl(), {
    transports: ["websocket"],
    auth: (give) => void realtimeToken().then((token) => give(token ? { token } : {})),
  });
  socket.on("disconnect", (reason) => {
    if (reason === "io server disconnect") retry = setTimeout(() => socket.connect(), 2000);
  });
  return {
    socket,
    close: () => {
      clearTimeout(retry);
      socket.close();
    },
  };
}
