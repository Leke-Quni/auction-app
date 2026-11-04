import { Logger } from "@nestjs/common";
import type { JobScheduler } from "./job-scheduler";

// QStash's free plan holds a message for at most 7 days, and an auction can run for 30. A message is therefore never set
// further out than this; when it arrives early the job endpoint schedules the next hop (see JobsService).
export const MAX_DELAY_MS = 6 * 24 * 3600_000;
// Fire just after the moment, not on it, so the database's clock has certainly passed the end time (a message that
// arrived a hair early would find nothing to do and wait for the sweep).
const MARGIN_MS = 1000;

export interface QStashPublisher {
  publishJSON(request: { url: string; body: unknown; notBefore: number; deduplicationId: string }): Promise<unknown>;
}

export class QStashJobScheduler implements JobScheduler {
  private readonly log = new Logger(QStashJobScheduler.name);

  constructor(
    private readonly client: QStashPublisher,
    private readonly callbackUrl: string,
  ) {}

  scheduleClose(listingId: string, at: Date) {
    return this.publish(`/jobs/close/${listingId}`, `close-${listingId}`, at);
  }

  scheduleOrderExpiry(orderId: string, at: Date) {
    return this.publish(`/jobs/expire-order/${orderId}`, `expire-${orderId}`, at);
  }

  // (QStash refuses a deduplication id with a colon in it, so the parts are joined with hyphens.)
  // The same job for the same moment is published once (QStash drops a repeated deduplication id for 10 minutes); anything
  // that slips through is harmless, as the jobs are idempotent.
  private async publish(path: string, key: string, at: Date) {
    try {
      const now = Date.now();
      if (Number.isNaN(at.getTime())) throw new Error("invalid time");
      const fireAt = Math.min(Math.max(at.getTime() + MARGIN_MS, now), now + MAX_DELAY_MS);
      const notBefore = Math.ceil(fireAt / 1000); // rounded up, so never before the moment
      await this.client.publishJSON({ url: `${this.callbackUrl}${path}`, body: {}, notBefore, deduplicationId: `${key}-${notBefore}` });
    } catch (error) {
      this.log.error(`Could not schedule ${path} for ${at.toString()}: ${(error as Error).message}`);
    }
  }
}
