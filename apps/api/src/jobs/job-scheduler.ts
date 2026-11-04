export const JOB_SCHEDULER = Symbol("JOB_SCHEDULER");
export const JOB_VERIFIER = Symbol("JOB_VERIFIER");

// Asks for a job to run at a given time. Scheduling is best effort and never throws: the sweeps (every 10 seconds for
// closing, every 30 for expiry) are the safety net, so a missed message only delays the work. Every job it triggers is
// idempotent, so a duplicate or stale message changes nothing.
export interface JobScheduler {
  // Close the auction at its end time. Call again with the new end time when a bid extends it.
  scheduleClose(listingId: string, at: Date): Promise<void>;
  // Give up on an unpaid order at its payment deadline.
  scheduleOrderExpiry(orderId: string, at: Date): Promise<void>;
}

// Without QStash the sweeps are the scheduler, so there is nothing to ask for.
export class InProcessJobScheduler implements JobScheduler {
  async scheduleClose() {}
  async scheduleOrderExpiry() {}
}

// Checks that a call to a job endpoint really came from QStash.
export interface JobVerifier {
  readonly callbackUrl: string;
  verify(rawBody: string, signature: string, url: string): Promise<boolean>;
}
