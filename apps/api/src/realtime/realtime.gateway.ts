import {
  auctionRoom,
  SOCKET_EVENTS,
  userRoom,
  type AuctionExtendedEvent,
  type BidPlacedEvent,
} from "@auction/shared";
import { Inject, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import type { Subscription } from "rxjs";
import { verifyToken } from "../auth/jwt-auth.guard";
import { AuctionEvents, type AuctionEvent } from "../bids/auction-events";
import { PRISMA, type Prisma } from "../db/db.module";

const LISTING_ID = /^[\w-]{1,64}$/;

@WebSocketGateway()
export class RealtimeGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() private server!: Server;
  private readonly log = new Logger(RealtimeGateway.name);
  private subscription?: Subscription;

  constructor(
    private readonly events: AuctionEvents,
    @Inject(PRISMA) private readonly prisma: Prisma,
  ) {}

  onModuleInit() {
    this.subscription = this.events.stream.subscribe((event) => {
      // A push that fails never touches the bid, which is already saved; viewers catch up when they next resync.
      this.publish(event).catch((error) => this.log.error(`Could not push ${event.type}: ${(error as Error).message}`));
    });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  // Anyone may connect and watch an auction. A token also puts the socket in its own private room; the room name comes
  // from the verified token, never from the client, so nobody can ask to join someone else's.
  async handleConnection(client: Socket) {
    const token = (client.handshake.auth as { token?: unknown } | undefined)?.token;
    if (token === undefined || token === null || token === "") return;
    const user = typeof token === "string" ? await verifyToken(token) : null;
    if (!user) {
      client.emit("connect_error_auth", { message: "Invalid or expired token" });
      client.disconnect(true);
      return;
    }
    await client.join(userRoom(user.id));
  }

  @SubscribeMessage(SOCKET_EVENTS.watch)
  async watch(@ConnectedSocket() client: Socket, @MessageBody() listingId: unknown) {
    if (typeof listingId !== "string" || !LISTING_ID.test(listingId)) return { ok: false };
    await client.join(auctionRoom(listingId));
    return { ok: true };
  }

  @SubscribeMessage(SOCKET_EVENTS.unwatch)
  async unwatch(@ConnectedSocket() client: Socket, @MessageBody() listingId: unknown) {
    if (typeof listingId !== "string" || !LISTING_ID.test(listingId)) return { ok: false };
    await client.leave(auctionRoom(listingId));
    return { ok: true };
  }

  private async publish(event: AuctionEvent) {
    const serverTime = new Date().toISOString();
    if (event.type === "BidPlaced") {
      const { result } = event;
      if (result.replayed) return;
      const bidder = await this.prisma.user.findUnique({ where: { id: result.listing.highBidderId }, select: { id: true, username: true } });
      if (!bidder) return;
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
    const payload: AuctionExtendedEvent = {
      listingId: event.listingId,
      endsAt: event.endsAt.toISOString(),
      extensionCount: event.extensionCount,
      serverTime,
    };
    this.server.to(auctionRoom(event.listingId)).emit(SOCKET_EVENTS.auctionExtended, payload);
  }
}
