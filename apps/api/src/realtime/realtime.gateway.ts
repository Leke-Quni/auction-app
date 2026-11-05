import {
  AUCTION_ROOM_PREFIX,
  auctionRoom,
  SOCKET_EVENTS,
  userRoom,
  type AuctionExtendedEvent,
  type BidPlacedEvent,
} from "@auction/shared";
import { Inject, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import type { Subscription } from "rxjs";
import { loadTokenUser } from "../auth/jwt-auth.guard";
import { PRISMA, type Prisma } from "../db/db.module";
import { AuctionEvents, type AuctionEvent } from "../bids/auction-events";

const LISTING_ID = /^[\w-]{1,64}$/;
// Enough for several tabs, far short of one client holding thousands of rooms.
const MAX_AUCTIONS_WATCHED = 20;

@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() private server!: Server;
  private readonly log = new Logger(RealtimeGateway.name);
  private subscription?: Subscription;

  constructor(
    private readonly events: AuctionEvents,
    @Inject(PRISMA) private readonly prisma: Prisma,
  ) {}

  onModuleInit() {
    this.subscription = this.events.stream.subscribe((event) => {
      // Sent straight away, with nothing awaited in between, so events leave in the order the bids were saved. A push that
      // fails never touches the bid, which is already saved; viewers catch up when they next resync.
      try {
        this.publish(event);
      } catch (error) {
        this.log.error(`Could not push ${event.type}: ${(error as Error).message}`);
      }
    });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  // Who a connecting socket is, worked out before the connection is announced to the client, so the private room is joined by
  // the time the client hears "connect" and nothing sent to it right after is missed. The token only says who is asking: the
  // account is read from the database, so a banned or deleted account is refused like a bad token.
  afterInit(server: Server) {
    server.use(async (socket, next) => {
      const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      if (token === undefined || token === null || token === "") {
        socket.data.auth = "anonymous";
        return next();
      }
      try {
        const result = typeof token === "string" ? await loadTokenUser(this.prisma, token) : null;
        if (result?.status === "ok") {
          await socket.join(userRoom(result.user.id));
          socket.data.auth = "ok";
        } else {
          socket.data.auth = result?.status === "banned" ? "banned" : "refused";
        }
      } catch (error) {
        // The database could not be asked: that is not the visitor's fault, so say so and let the client try again soon.
        this.log.error(`Could not check a socket's token: ${(error as Error).message}`);
        socket.data.auth = "unavailable";
      }
      next();
    });
  }

  // Anyone may connect and watch an auction. A valid token also put the socket in its own private room (see afterInit); the room
  // name comes from the verified token, never from the client, so nobody can ask to join someone else's.
  handleConnection(client: Socket) {
    const messages: Record<string, { code: string; message: string }> = {
      refused: { code: "INVALID_TOKEN", message: "Invalid or expired token" },
      banned: { code: "BANNED", message: "This account has been suspended." },
      unavailable: { code: "UNAVAILABLE", message: "Could not check the token right now. Try again." },
    };
    const refusal = messages[client.data.auth];
    if (!refusal) return;
    client.emit("connect_error_auth", refusal);
    client.disconnect(true);
  }

  @SubscribeMessage(SOCKET_EVENTS.watch)
  async watch(@ConnectedSocket() client: Socket, @MessageBody() listingId: unknown) {
    if (typeof listingId !== "string" || !LISTING_ID.test(listingId)) return { ok: false };
    const watching = [...client.rooms].filter((room) => room.startsWith(AUCTION_ROOM_PREFIX)).length;
    if (watching >= MAX_AUCTIONS_WATCHED && !client.rooms.has(auctionRoom(listingId))) return { ok: false };
    await client.join(auctionRoom(listingId));
    return { ok: true };
  }

  @SubscribeMessage(SOCKET_EVENTS.unwatch)
  async unwatch(@ConnectedSocket() client: Socket, @MessageBody() listingId: unknown) {
    if (typeof listingId !== "string" || !LISTING_ID.test(listingId)) return { ok: false };
    await client.leave(auctionRoom(listingId));
    return { ok: true };
  }

  // True when any of this person's sockets, on any API machine, is on this auction's page right now.
  async isWatching(userId: string, listingId: string) {
    const sockets = await this.server.in(userRoom(userId)).fetchSockets();
    const room = auctionRoom(listingId);
    return sockets.some((socket) => socket.rooms.has(room));
  }

  // Private notices go to each person's own room, which only the server ever puts a socket in.
  emitToUsers(userIds: string[], event: string, payload: unknown) {
    if (userIds.length === 0) return;
    this.server.to(userIds.map(userRoom)).emit(event, payload);
  }

  // A banned account's open pages are told why and hung up at once (the client does not reconnect after BANNED), instead of
  // keeping their private room until they next reconnect. Works across machines through the Redis adapter.
  suspendUser(userId: string) {
    this.server.to(userRoom(userId)).emit("connect_error_auth", { code: "BANNED", message: "This account has been suspended." });
    this.server.in(userRoom(userId)).disconnectSockets(true);
  }

  private publish(event: AuctionEvent) {
    const serverTime = new Date().toISOString();
    if (event.type === "BidPlaced") {
      const { result } = event;
      if (result.replayed) return;
      const bidder = result.bid.bidder;
      const payload: BidPlacedEvent = {
        listingId: event.listingId,
        currentBidCents: result.listing.currentBidCents,
        bidCount: result.listing.bidCount,
        highBidder: bidder,
        endsAt: result.listing.endsAt.toISOString(),
        extensionCount: result.listing.extensionCount,
        minimumNextBidCents: result.listing.minimumNextBidCents,
        serverTime,
        extended: result.extended,
        bid: { id: result.bid.id, amountCents: result.bid.amountCents, createdAt: result.bid.createdAt.toISOString(), bidder },
      };
      this.server.to(auctionRoom(event.listingId)).emit(SOCKET_EVENTS.bidPlaced, payload);
      return;
    }
    if (event.type !== "AuctionExtended") return;
    const payload: AuctionExtendedEvent = {
      listingId: event.listingId,
      endsAt: event.endsAt.toISOString(),
      extensionCount: event.extensionCount,
      serverTime,
    };
    this.server.to(auctionRoom(event.listingId)).emit(SOCKET_EVENTS.auctionExtended, payload);
  }
}
