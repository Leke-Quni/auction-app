import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import type { ServerOptions } from "socket.io";
import { webUrl } from "../config";

// With a Redis URL, every API machine hears every event, so a bid placed on one reaches viewers connected to another.
export class RealtimeAdapter extends IoAdapter {
  private redis?: ReturnType<typeof createAdapter>;
  private clients: { quit(): Promise<unknown> }[] = [];

  async connectRedis(url: string) {
    const pub = createClient({ url });
    const sub = pub.duplicate();
    // A dropped Redis connection is retried by the client; without a handler the error would crash the process.
    for (const client of [pub, sub]) client.on("error", (error) => console.error("Redis (realtime):", error.message));
    await Promise.all([pub.connect(), sub.connect()]);
    this.clients = [pub, sub];
    this.redis = createAdapter(pub as never, sub as never);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, { ...options, cors: { origin: webUrl() } });
    if (this.redis) server.adapter(this.redis);
    return server;
  }

  override async dispose() {
    await super.dispose();
    await Promise.all(this.clients.map((client) => client.quit().catch(() => undefined)));
  }
}
