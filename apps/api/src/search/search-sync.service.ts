import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Subscription } from "rxjs";
import { AuctionEvents } from "../bids/auction-events";
import type { BidResult } from "../bids/bids.service";
import { searchPriceThrottleSeconds } from "../config";
import { SEARCH_INDEX, type LiveFields, type SearchIndex } from "./search-index";

interface Entry {
  timer: ReturnType<typeof setTimeout>;
  pending?: LiveFields;
}

// Keeps the search index in step with bids. A busy auction would otherwise send an update on every bid, so the price
// and bid count go out at most once per throttle window per auction, with the newest values sent when the window ends.
// An extension is sent at once: the index drops auctions that have ended, so a stale end time would remove a live
// auction from search. A failed update is logged and repaired by the next bid, the 5-minute sweep or a reindex.
@Injectable()
export class SearchSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SearchSyncService.name);
  private readonly entries = new Map<string, Entry>();
  private subscription?: Subscription;

  constructor(
    private readonly events: AuctionEvents,
    @Inject(SEARCH_INDEX) private readonly search: SearchIndex,
  ) {}

  onModuleInit() {
    this.subscription = this.events.stream.subscribe((event) => {
      if (event.type === "BidPlaced" && !event.result.replayed) this.onBid(event.listingId, event.result);
    });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
    for (const entry of this.entries.values()) clearTimeout(entry.timer);
    this.entries.clear();
  }

  private onBid(listingId: string, result: BidResult) {
    const { listing } = result;
    const fields: LiveFields = {
      price_cents: listing.currentBidCents,
      bid_count: listing.bidCount,
      final_chance: listing.finalChance,
      ends_at: Math.floor(listing.endsAt.getTime() / 1000),
    };
    const entry = this.entries.get(listingId);
    if (entry && !result.extended) {
      entry.pending = fields; // inside the window: the newest values go out when it ends
      return;
    }
    if (entry) clearTimeout(entry.timer);
    this.send(listingId, fields);
  }

  // Sends now and opens a window; whatever arrives during it is sent when it closes, and the entry is dropped after
  // a quiet window.
  private send(listingId: string, fields: LiveFields) {
    this.search.update(listingId, fields).catch((error) => this.log.error(`Could not update search for ${listingId}: ${(error as Error).message}`));
    const entry: Entry = {
      timer: setTimeout(() => {
        const { pending } = entry;
        this.entries.delete(listingId);
        if (pending) this.send(listingId, pending);
      }, searchPriceThrottleSeconds() * 1000),
    };
    entry.timer.unref();
    this.entries.set(listingId, entry);
  }
}
