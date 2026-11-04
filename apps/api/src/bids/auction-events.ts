import { Injectable } from "@nestjs/common";
import { Subject } from "rxjs";
import type { BidResult } from "./bids.service";

// In-process domain events. They are published only after the database transaction has committed.
export type AuctionEvent =
  | { type: "BidPlaced"; listingId: string; result: BidResult }
  | { type: "AuctionExtended"; listingId: string; endsAt: Date; extensionCount: number }
  // A buyer did not pay in time. `nextBuyerId` is who the item was offered to next (at their own highest bid), or null when
  // no remaining bid qualified and the auction ended without a sale.
  | { type: "OrderExpired"; listingId: string; orderId: string; nextBuyerId: string | null; nextAmountCents: number | null }
  | { type: "AuctionClosed"; listingId: string; outcome: "SOLD" | "NO_SALE" | "NO_BIDS"; winnerId: string | null; finalPriceCents: number | null };

@Injectable()
export class AuctionEvents {
  private readonly subject = new Subject<AuctionEvent>();
  readonly stream = this.subject.asObservable();

  publish(event: AuctionEvent) {
    this.subject.next(event);
  }
}
