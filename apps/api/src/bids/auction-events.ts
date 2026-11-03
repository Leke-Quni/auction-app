import { Injectable } from "@nestjs/common";
import { Subject } from "rxjs";
import type { BidResult } from "./bids.service";

// In-process domain events. They are published only after the database transaction has committed.
export type AuctionEvent =
  | { type: "BidPlaced"; listingId: string; result: BidResult }
  | { type: "AuctionExtended"; listingId: string; endsAt: Date; extensionCount: number }
  | { type: "AuctionClosed"; listingId: string; outcome: "SOLD" | "NO_SALE" | "NO_BIDS"; winnerId: string | null; finalPriceCents: number | null };

@Injectable()
export class AuctionEvents {
  private readonly subject = new Subject<AuctionEvent>();
  readonly stream = this.subject.asObservable();

  publish(event: AuctionEvent) {
    this.subject.next(event);
  }
}
