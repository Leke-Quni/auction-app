"use client";

import { AUCTION_DURATIONS, CONDITION_LABELS, LISTING_CONDITIONS, formatEur } from "@auction/shared";
import { useActionState } from "react";
import { saveListingAction } from "./actions";

export interface FormListing {
  id: string;
  title: string;
  description: string;
  categoryId: string;
  condition: keyof typeof CONDITION_LABELS;
  startingPriceCents: number;
  reservePriceCents: number | null;
  durationDays: number;
  status: "DRAFT" | "PUBLISHED";
}

const input = "mt-1 w-full border border-[#888] bg-white p-1.5 text-sm";
const label = "text-xs text-muted";

const euros = (cents: number | null) => (cents == null ? "" : (cents / 100).toFixed(2));

export function ListingForm({
  categories,
  listing,
}: {
  categories: { id: string; name: string }[];
  listing?: FormListing;
}) {
  const [state, formAction, pending] = useActionState(saveListingAction, {});
  const published = listing?.status === "PUBLISHED";

  return (
    <form action={formAction} className="space-y-3 border border-line bg-white p-3">
      <h2 className="text-sm font-bold">{listing ? "Details" : "New listing"}</h2>
      {listing && <input type="hidden" name="listingId" value={listing.id} />}

      {published ? (
        <>
          <p className="text-xs text-muted">Once published, only the description can change.</p>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {[
                ["Title", listing.title],
                ["Category", categories.find((c) => c.id === listing.categoryId)?.name ?? ""],
                ["Condition", CONDITION_LABELS[listing.condition]],
                ["Starting price", formatEur(listing.startingPriceCents)],
                ["Reserve price", listing.reservePriceCents == null ? "None" : formatEur(listing.reservePriceCents)],
                ["Duration", `${listing.durationDays} ${listing.durationDays === 1 ? "day" : "days"}`],
              ].map(([k, v]) => (
                <tr key={k}>
                  <th className="w-32 border border-line bg-[#f0f0f0] p-1.5 text-left font-normal text-muted">{k}</th>
                  <td className="border border-line p-1.5">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <>
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
                    {d} {d === 1 ? "day" : "days"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-muted">The reserve price is shown to bidders. If it is not met, the item does not sell.</p>
        </>
      )}

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

      {state.error && <p className="text-urgent">{state.error}</p>}
      {state.ok && <p className="text-brand">{state.ok}</p>}
      <button
        disabled={pending}
        className="cursor-pointer bg-brand px-3 py-1 font-bold text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? "..." : listing ? "Save" : "Create draft"}
      </button>
    </form>
  );
}
