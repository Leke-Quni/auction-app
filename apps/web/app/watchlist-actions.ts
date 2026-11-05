"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";

export interface WatchState {
  watching: boolean;
  watcherCount: number;
}

export type WatchResult = ({ error?: undefined } & WatchState) | { error: string };

// Starts or stops watching a listing. Answers the new state, so the button can show it without reloading the page.
export async function setWatchingAction(listingId: string, watching: boolean): Promise<WatchResult> {
  if (!(await auth())) return { error: "Sign in to watch auctions." };
  let res: Response;
  try {
    res = await authedApiFetch(`/listings/${listingId}/watch`, { method: watching ? "PUT" : "DELETE" });
  } catch {
    return { error: "Could not reach the server. Try again." };
  }
  if (res.status === 409) {
    const body = await res.json().catch(() => null);
    return { error: typeof body?.message === "string" ? body.message : "This auction has ended." };
  }
  if (!res.ok) return { error: "Something went wrong. Try again." };
  revalidatePath("/watchlist");
  return res.json();
}

// The watchlist page's "Remove" button.
export async function removeFromWatchlistAction(formData: FormData): Promise<void> {
  const listingId = String(formData.get("listingId") ?? "");
  if (!listingId || !(await auth())) return;
  try {
    const res = await authedApiFetch(`/listings/${listingId}/watch`, { method: "DELETE" });
    if (!res.ok) return; // the card stays, which is the truth; pressing the button again retries
  } catch {
    return;
  }
  revalidatePath("/watchlist");
}
