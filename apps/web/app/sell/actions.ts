"use server";

import { MAX_IMAGES, createListingSchema, eurosToCents, updateListingSchema } from "@auction/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error";
import { deleteOwnBlobs } from "@/lib/blob";

// The API reports which photos a change removed; the web app deletes them from Blob (the API has no Blob credentials).
async function deleteRemovedPhotos(res: Response) {
  const body = await res.json().catch(() => null);
  const urls: unknown = body?.removedImageUrls;
  const session = await auth();
  if (session && Array.isArray(urls)) {
    await deleteOwnBlobs(urls.filter((u): u is string => typeof u === "string"), session.user.id);
  }
}

export interface SellFormState {
  error?: string;
  ok?: string;
}

const PRICE_HELP = "Enter an amount like 25 or 25.50";

// Builds the request from whichever fields the form sent. A published listing's form sends only the description.
export async function saveListingAction(_: SellFormState, formData: FormData): Promise<SellFormState> {
  const id = String(formData.get("listingId") ?? "");
  const input: Record<string, unknown> = {};
  for (const key of ["title", "description", "categoryId", "condition"]) {
    if (formData.has(key)) input[key] = String(formData.get(key));
  }
  if (formData.has("durationDays")) input.durationDays = Number(formData.get("durationDays"));
  if (formData.has("startingPrice")) {
    const cents = eurosToCents(String(formData.get("startingPrice")));
    if (cents === null) return { error: `Starting price: ${PRICE_HELP}` };
    input.startingPriceCents = cents;
  }
  if (formData.has("reservePrice")) {
    const raw = String(formData.get("reservePrice")).trim();
    const cents = raw === "" ? null : eurosToCents(raw);
    if (raw !== "" && cents === null) return { error: `Reserve price: ${PRICE_HELP}, or leave it empty` };
    input.reservePriceCents = cents;
  }

  const parsed = (id ? updateListingSchema : createListingSchema).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const res = await authedApiFetch(id ? `/listings/${id}` : "/listings", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(parsed.data),
  });
  if (!res.ok) return { error: await apiErrorMessage(res) };
  if (!id) {
    const created = await res.json();
    // Photos picked in the new-listing form were already uploaded to Blob; attach them to the new draft.
    const photos = readPhotoUrls(formData.get("photos"));
    if (photos.length > 0) {
      const saved = await saveImagesAction(created.id, photos);
      if (saved.error) redirect(`/sell/${created.id}/edit?photosFailed=1`);
    }
    redirect(`/sell/${created.id}/edit`);
  }
  revalidatePath(`/sell/${id}/edit`);
  return { ok: "Saved." };
}

// The new-listing form sends its uploaded photo URLs as JSON in a hidden field. The API checks every URL again.
function readPhotoUrls(value: FormDataEntryValue | null): string[] {
  try {
    const parsed: unknown = JSON.parse(String(value ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((u): u is string => typeof u === "string").slice(0, MAX_IMAGES);
  } catch {
    return [];
  }
}

export async function saveImagesAction(listingId: string, urls: string[]): Promise<{ error?: string }> {
  // The pathname is the part of the URL after the host, which is how the API checks it.
  const images = urls.map((url) => ({ url, pathname: decodeURIComponent(new URL(url).pathname.slice(1)) }));
  const res = await authedApiFetch(`/listings/${listingId}/images`, { method: "PUT", body: JSON.stringify({ images }) });
  if (!res.ok) return { error: await apiErrorMessage(res) };
  await deleteRemovedPhotos(res);
  revalidatePath(`/sell/${listingId}/edit`);
  return {};
}

export async function publishListingAction(listingId: string, startsAt?: string): Promise<{ error?: string }> {
  const res = await authedApiFetch(`/listings/${listingId}/publish`, {
    method: "POST",
    body: JSON.stringify(startsAt ? { startsAt } : {}),
  });
  if (!res.ok) return { error: await apiErrorMessage(res) };
  redirect(`/listings/${listingId}`);
}

export async function deleteListingAction(listingId: string): Promise<{ error?: string }> {
  const res = await authedApiFetch(`/listings/${listingId}`, { method: "DELETE" });
  if (!res.ok) return { error: await apiErrorMessage(res) };
  await deleteRemovedPhotos(res);
  redirect("/sell");
}
