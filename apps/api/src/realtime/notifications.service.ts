import { formatEur, SOCKET_EVENTS, type ExtendedNotice, type OutbidNotice } from "@auction/shared";
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Subscription } from "rxjs";
import { AuctionEvents } from "../bids/auction-events";
import type { BidResult } from "../bids/bids.service";
import { webUrl } from "../config";
import { PRISMA, type Prisma } from "../db/db.module";
import { MAIL_SENDER, type MailSender } from "../email/mail-sender";
import { RealtimeGateway } from "./realtime.gateway";

const utc = (date: Date) => `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;

// Tells people what a bid meant for them: the bidder who was outbid gets a toast and an email; every other bidder on an
// auction whose end time moved gets a toast. Nobody else is emailed. Runs after the bid is saved, so a failure here
// is logged and never touches the bid.
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(NotificationsService.name);
  private subscription?: Subscription;

  constructor(
    private readonly events: AuctionEvents,
    private readonly gateway: RealtimeGateway,
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
  ) {}

  onModuleInit() {
    this.subscription = this.events.stream.subscribe((event) => {
      if (event.type !== "BidPlaced" || event.result.replayed) return;
      this.onBid(event.listingId, event.result).catch((error) => this.log.error(`Could not send notices: ${(error as Error).message}`));
    });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  private async onBid(listingId: string, result: BidResult) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId }, select: { title: true, sellerId: true } });
    if (!listing) return;
    const { endsAt, extensionCount, currentBidCents, minimumNextBidCents } = result.listing;
    const newBidderId = result.listing.highBidderId;
    const outbidId = result.previousHighBidderId;

    if (outbidId && outbidId !== newBidderId) {
      const notice: OutbidNotice = {
        listingId,
        title: listing.title,
        currentBidCents,
        minimumNextBidCents,
        endsAt: endsAt.toISOString(),
        extended: result.extended,
        extensionCount,
      };
      this.gateway.emitToUsers([outbidId], SOCKET_EVENTS.outbid, notice);
      await this.emailOutbid(outbidId, listingId, listing.title, result);
    }

    if (result.extended) {
      const bidders = await this.prisma.bid.findMany({ where: { listingId }, distinct: ["bidderId"], select: { bidderId: true } });
      const others = bidders.map((b) => b.bidderId).filter((id) => id !== newBidderId && id !== outbidId && id !== listing.sellerId);
      const notice: ExtendedNotice = {
        listingId,
        title: listing.title,
        endsAt: endsAt.toISOString(),
        extensionCount,
        final: result.listing.finalChance,
      };
      this.gateway.emitToUsers(others, SOCKET_EVENTS.extendedNotice, notice);
    }
  }

  private async emailOutbid(userId: string, listingId: string, title: string, result: BidResult) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) return;
    const { listing, extended } = result;
    const lines = [
      `You've been outbid on "${title}".`,
      "",
      `Current bid: ${formatEur(listing.currentBidCents)}`,
      `Minimum next bid: ${formatEur(listing.minimumNextBidCents)}`,
    ];
    if (extended) lines.push("", `The new bid came in at the last moment, so the auction was extended. It now ends at ${utc(listing.endsAt)}.`);
    else lines.push(`Ends: ${utc(listing.endsAt)}`);
    lines.push("", `${webUrl()}/listings/${listingId}`);
    try {
      await this.mail.send(user.email, `You've been outbid on ${title}`, lines.join("\n"));
    } catch (error) {
      this.log.error(`Could not email the outbid notice: ${(error as Error).message}`);
    }
  }
}
