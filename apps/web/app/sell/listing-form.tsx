"use client";

import { AUCTION_DURATIONS, CONDITION_LABELS, LISTING_CONDITIONS, SHIPPING_COUNTRIES, formatDuration, formatEur, type ShippingAddress } from "@auction/shared";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { AddressFields } from "../address-fields";
import { saveListingAction } from "./actions";
import { useUnsavedChanges } from "../use-unsaved-changes";

export interface FormListing {
  id: string;
  title: string;
  description: string;
  categoryId: string;
  condition: keyof typeof CONDITION_LABELS;
  startingPriceCents: number;
  reservePriceCents: number | null;
  durationDays: number;
  pickupAddress?: ShippingAddress | null;
  status: "DRAFT" | "PUBLISHED";
}

const input = "mt-1 w-full border border-[#888] bg-white p-1.5 text-sm";
const label = "text-xs text-muted";

const euros = (cents: number | null) => (cents == null ? "" : (cents / 100).toFixed(2));

// Order for a draft: details, photos, then price. `photos` is the photo block, rendered between them
// (inside the form, so the new-listing page can send the uploaded photos along with the rest).
export function ListingForm({
  categories,
  listing,
  photos,
  defaultPickup,
  onUnsavedChange,
}: {
  categories: { id: string; name: string }[];
  listing?: FormListing;
  photos?: ReactNode;
  // The seller's saved default pickup address, offered when the listing has none of its own.
  defaultPickup?: ShippingAddress | null;
  // Told whenever the form gains or loses edits that are not saved yet.
  onUnsavedChange?: (unsaved: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(saveListingAction, {});
  const published = listing?.status === "PUBLISHED";
  const formRef = useRef<HTMLFormElement>(null);
  // Every successful save counts, even though its message is always the same text: the form is clean again after each one.
  const [saves, setSaves] = useState(0);
  useEffect(() => {
    if (state.ok) setSaves((n) => n + 1);
  }, [state]);
  useUnsavedChanges(formRef, true, saves, onUnsavedChange);

  const description = (
    <label className="block">
      <span className={label}>Description</span>
      <textarea
        name="description"
        required
        minLength={10}
        maxLength={4000}
        rows={6}
        defaultValue={listing?.description}
        className={input}
      />
    </label>
  );

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      {listing && <input type="hidden" name="listingId" value={listing.id} />}

      {published ? (
        <div className="space-y-3 border border-line bg-white p-3">
          <h2 className="text-sm font-bold">Details</h2>
          <p className="text-xs text-muted">Once published, only the description can change.</p>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {[
                ["Title", listing.title],
                ["Category", categories.find((c) => c.id === listing.categoryId)?.name ?? ""],
                ["Condition", CONDITION_LABELS[listing.condition]],
                ["Starting price", formatEur(listing.startingPriceCents)],
                ["Reserve price", listing.reservePriceCents == null ? "None" : formatEur(listing.reservePriceCents)],
                ["Duration", formatDuration(listing.durationDays)],
                ["Pickup", listing.pickupAddress ? `${listing.pickupAddress.city}, ${SHIPPING_COUNTRIES[listing.pickupAddress.country] ?? listing.pickupAddress.country}` : "Not set"],
              ].map(([k, v]) => (
                <tr key={k}>
                  <th className="w-32 border border-line bg-[#f0f0f0] p-1.5 text-left font-normal text-muted">{k}</th>
                  <td className="border border-line p-1.5">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {description}
          {photos}
        </div>
      ) : (
        <>
          <div className="space-y-3 border border-line bg-white p-3">
            <h2 className="text-sm font-bold">{listing ? "Details" : "New listing"}</h2>
            <label className="block">
              <span className={label}>Title</span>
              <input name="title" required minLength={5} maxLength={80} defaultValue={listing?.title} className={input} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className={label}>Category</span>
                <select name="categoryId" required defaultValue={listing?.categoryId ?? ""} className={input}>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={label}>Condition</span>
                <select name="condition" required defaultValue={listing?.condition ?? ""} className={input}>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {LISTING_CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {CONDITION_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {description}
          </div>

          {photos}

          <div className="space-y-3 border border-line bg-white p-3">
            <h2 className="text-sm font-bold">Price and duration</h2>
            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className={label}>Starting price (€)</span>
                <input
                  name="startingPrice"
                  required
                  inputMode="decimal"
                  placeholder="25.00"
                  defaultValue={euros(listing?.startingPriceCents ?? null)}
                  className={input}
                />
              </label>
              <label className="block">
                <span className={label}>Reserve price (€, optional)</span>
                <input
                  name="reservePrice"
                  inputMode="decimal"
                  placeholder="none"
                  defaultValue={euros(listing?.reservePriceCents ?? null)}
                  className={input}
                />
              </label>
              <label className="block">
                <span className={label}>Duration</span>
                <select name="durationDays" required defaultValue={listing?.durationDays ?? 7} className={input}>
                  {AUCTION_DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {formatDuration(d)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-xs text-muted">The reserve price is shown to bidders. If it is not met, the item does not sell.</p>
          </div>

          <div className="space-y-3 border border-line bg-white p-3">
            <h2 className="text-sm font-bold">Pickup address</h2>
            <p className="text-xs text-muted">
              Our carrier collects the item here when it sells, so give an address and a phone number where someone can hand it over. Buyers never see it.
              {defaultPickup && !listing?.pickupAddress ? " It starts as your default address; change anything for this item." : ""}
            </p>
            <AddressFields prefix="pickup_" defaults={listing?.pickupAddress ?? defaultPickup} nameLabel="Contact name" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="saveAsDefault" defaultChecked={!defaultPickup && !listing?.pickupAddress} />
              Save as my default pickup address
            </label>
          </div>
        </>
      )}

      <div className="space-y-2 border border-line bg-white p-3">
        {state.error && <p className="text-urgent">{state.error}</p>}
        {state.ok && <p className="text-brand">{state.ok}</p>}
        <button
          disabled={pending}
          className="cursor-pointer bg-brand px-3 py-1 font-bold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {pending ? "..." : listing ? "Save" : "Create draft"}
        </button>
      </div>
    </form>
  );
}
