"use server";

import { BID_REFUSAL_MESSAGES, BID_REFUSALS, formatEur, type BidRefusal, type ProxyOutcome } from "@auction/shared";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";
import { viewerIpHeaders } from "@/lib/viewer-ip";

export interface BidActionResult {
  ok?: boolean;
  error?: string;
  // The least the next bid may be, when the API said so, so the page can correct the box.
  minimumNextBidCents?: number;
  // True when the bid may or may not have gone through (no answer, or a server error): retry with the same key.
  retry?: boolean;
  extended?: boolean;
  endsAt?: string;
  // What the bid meant for the bidder (an older API says nothing, which is the same as leading), their own maximum now, and the price now.
  outcome?: ProxyOutcome;
  yourMaxCents?: number;
  currentBidCents?: number;
}

const OUTCOMES: readonly string[] = ["LEADING", "OUTBID_BY_PROXY", "MAX_RAISED"] satisfies ProxyOutcome[];
const outcomeOf = (value: unknown): ProxyOutcome => (OUTCOMES.includes(value as string) ? (value as ProxyOutcome) : "LEADING");

const isRefusal =(code: unknown): code is BidRefusal => (BID_REFUSALS as readonly string[]).includes(code as string);

export async function placeBidAction(listingId: string, amountCents: number, idempotencyKey: string): Promise<BidActionResult> {
  const session = await auth();
  if (!session) return { error: "Sign in to place a bid." };

  let res: Response;
  try {
    res = await authedApiFetch(`/listings/${listingId}/bids`, {
      method: "POST",
      headers: await viewerIpHeaders(),
      body: JSON.stringify({ amountCents, idempotencyKey }),
    });
  } catch {
    return { error: "Could not reach the auction server. Your bid may not have been placed; try again.", retry: true };
  }
  const body = await res.json().catch(() => null);

  if (res.ok) {
    revalidatePath(`/listings/${listingId}`);
    return {
      ok: true,
      extended: Boolean(body?.extended),
      endsAt: body?.listing?.endsAt,
      outcome: outcomeOf(body?.outcome),
      yourMaxCents: typeof body?.yourMaxCents === "number" ? body.yourMaxCents : undefined,
      currentBidCents: typeof body?.listing?.currentBidCents === "number" ? body.listing.currentBidCents : undefined,
    };
  }
  if (res.status === 401) return { error: "Your session has expired. Sign in again to bid." };
  if (res.status >= 500) {
    return { error: body?.message ?? "Something went wrong. Your bid may not have been placed; try again.", retry: true };
  }
  const minimumNextBidCents = typeof body?.minimumNextBidCents === "number" ? body.minimumNextBidCents : undefined;
  const code: unknown = body?.code;
  const message =
    code === "TOO_LOW" && minimumNextBidCents !== undefined
      ? `Your bid is below the minimum of ${formatEur(minimumNextBidCents)}.`
      : isRefusal(code)
        ? BID_REFUSAL_MESSAGES[code]
        : typeof body?.message === "string"
          ? body.message
          : "That bid could not be placed.";
  revalidatePath(`/listings/${listingId}`);
  return { error: message, minimumNextBidCents };
}
