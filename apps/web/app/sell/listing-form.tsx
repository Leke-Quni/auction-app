"use client";

import { AUCTION_DURATIONS, CONDITION_LABELS, LISTING_CONDITIONS, SHIPPING_COUNTRIES, formatDuration, formatEur, type ShippingAddress } from "@auction/shared";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
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

const input = "mt-1 w-full border border-field bg-surface p-1.5 text-sm aria-invalid:border-urgent aria-invalid:outline aria-invalid:outline-2 aria-invalid:outline-urgent";
const label = "text-xs text-muted";

export const LISTING_FORM_ID = "listing-form";
const SAVED_PAUSE_MS = 1200;
// An empty element the page puts above the Save button when that button is not inside the form.
export const LISTING_FORM_STATUS_ID = "listing-form-status";

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

// A field's name; the phone number box has none of its own (its value travels in a hidden field), so it carries one as data.
const keyOf = (el: Control) => el.name || el.dataset.fieldName || "";

// What is wrong with a field, in words, for the line under it; null when it is fine. Text is judged without the spaces
// and blank lines around it, as the server does, so Enter or space presses do not count as writing something.
function problemWith(el: Control): string | null {
  if (el instanceof HTMLSelectElement) return el.required && el.value === "" ? "Choose an option." : null;
  if (el instanceof HTMLInputElement && ["hidden", "checkbox", "radio", "file"].includes(el.type)) return null;
  const length = el.value.trim().length;
  if (el.required && length === 0) return "Fill in this field.";
  if (el.minLength > 0 && length < el.minLength) return `Write at least ${el.minLength} characters (you have ${length}).`;
  if (el.maxLength >= 0 && length > el.maxLength) return `Write at most ${el.maxLength} characters (you have ${length}).`;
  return null;
}

// Publishing needs fields a draft may leave empty (the pickup address). Marks the empty ones with a red border and
// takes the seller to the first; true when something was missing.
export function flagIncompleteForPublish(): boolean {
  const form = document.getElementById(LISTING_FORM_ID);
  const empty = Array.from(form?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-publish-required]") ?? []).filter((f) => f.value.trim() === "");
  for (const f of empty) f.setAttribute("aria-invalid", "true");
  empty[0]?.scrollIntoView({ block: "center" });
  empty[0]?.focus({ preventScroll: true });
  return empty.length > 0;
}

const euros = (cents: number | null) => (cents == null ? "" : (cents / 100).toFixed(2));

// Order for a draft: details, photos, then price. `photos` is the photo block, rendered between them
// (inside the form, so the new-listing page can send the uploaded photos along with the rest).
export function ListingForm({
  categories,
  listing,
  photos,
  defaultPickup,
  onUnsavedChange,
  externalSave = false,
}: {
  categories: { id: string; name: string }[];
  listing?: FormListing;
  photos?: ReactNode;
  // The seller's saved default pickup address, offered when the listing has none of its own.
  defaultPickup?: ShippingAddress | null;
  // Told whenever the form gains or loses edits that are not saved yet.
  onUnsavedChange?: (unsaved: boolean) => void;
  // The Save button is rendered elsewhere (next to Publish) and submits this form through its `form` attribute.
  externalSave?: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveListingAction, {});
  const published = listing?.status === "PUBLISHED";
  const formRef = useRef<HTMLFormElement>(null);
  // Every successful save counts, even though its message is always the same text: the form is clean again after each one.
  const [saves, setSaves] = useState(0);
  useEffect(() => {
    if (state.ok) setSaves((n) => n + 1);
  }, [state]);
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(formRef, true, saves, (value) => {
    setDirty(value);
    onUnsavedChange?.(value);
  });

  const [fieldError, setFieldError] = useState<{ name: string; message: string } | null>(null);
  const errorFor = (name: string) =>
    fieldError?.name === name && (
      <span role="alert" className="mt-0.5 block text-xs text-urgent">
        {fieldError.message}
      </span>
    );

  // A refusal from the server shows at the Save button; bring it into view, as it can be far from the field that was edited.
  const errorRef = useRef<HTMLDivElement>(null);
  // After a published listing is saved the seller goes back to the listing, a moment later so "Saving" can be read.
  const router = useRouter();
  useEffect(() => {
    if (!state.redirectTo) return;
    const timer = setTimeout(() => router.push(state.redirectTo!), SAVED_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [state, router]);

  useEffect(() => {
    if (state.error) errorRef.current?.scrollIntoView?.({ block: "center" });
  }, [state]);

  const photosRef = useRef<HTMLDivElement>(null);
  const [photoError, setPhotoError] = useState(false);
  // The photo list is a hidden field set by script; once it holds a photo the message goes away.
  useEffect(() => {
    const field = formRef.current?.elements.namedItem("photos");
    if (!photoError || !(field instanceof HTMLInputElement)) return;
    const observer = new MutationObserver(() => {
      if (field.value !== "[]") setPhotoError(false);
    });
    observer.observe(field, { attributes: true, attributeFilter: ["value"] });
    return () => observer.disconnect();
  }, [photoError]);
  // The browser's "please fill out this field" bubble is switched off (noValidate). The first field, in page order,
  // that is empty or invalid (the photo list counts) gets the red border and the page moves to it; the rest stay as they are.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    // A pickup address is either left empty (a draft needs none) or filled in completely; the server refuses half of one.
    const pickup = Array.from(e.currentTarget.querySelectorAll<Control>("[data-publish-required]"));
    const halfFilled = pickup.some((f) => f.value.trim() !== "") && pickup.some((f) => f.value.trim() === "");
    for (const el of Array.from(e.currentTarget.elements)) {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
      if (el.name === "photos") {
        if (el.value !== "[]") continue;
        e.preventDefault();
        setPhotoError(true);
        photosRef.current?.scrollIntoView({ block: "center" });
        photosRef.current?.focus({ preventScroll: true });
        return;
      }
      const problem = problemWith(el) ?? (halfFilled && el.hasAttribute("data-publish-required") && el.value.trim() === "" ? "Fill in this field." : null);
      if (!problem) continue;
      e.preventDefault();
      el.setAttribute("aria-invalid", "true");
      setFieldError({ name: keyOf(el), message: problem });
      el.scrollIntoView({ block: "center" });
      el.focus({ preventScroll: true });
      return;
    }
    // The form is sent from here and not through the `action` prop, which would reset every field after the save,
    // wiping what was typed when the server refuses it.
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };
  const photoBlock = photos && (
    <div ref={photosRef} tabIndex={-1} data-invalid={photoError || undefined} className="outline-none data-invalid:[&>div]:border-urgent!">
      {photos}
    </div>
  );
  // An existing listing has nothing to save until it is edited; a new one is created by its button.
  const saveLocked = !!listing && !dirty;

  const statusLines = (
    <>
      {(pending || state.redirectTo) && (
        <p role="status" className="text-brand">
          {pending ? "Saving…" : "Saved. Taking you back to the listing…"}
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-urgent">
          {state.error}
        </p>
      )}
    </>
  );
  // Where the Save button is elsewhere on the page, the status goes in a slot just above it.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById(LISTING_FORM_STATUS_ID)), []);
  const showStatus = pending || !!state.redirectTo || !!state.error;

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
      {errorFor("description")}
    </label>
  );

  return (
    <>
      <form id={LISTING_FORM_ID} ref={formRef} onSubmit={onSubmit} noValidate
        onInput={(e) => {
          const field = e.target as Control;
          if (!field.getAttribute("aria-invalid")) return;
          const problem = problemWith(field);
          if (field.value.trim() !== "" && !problem) {
            field.removeAttribute("aria-invalid");
            setFieldError((current) => (current?.name === keyOf(field) ? null : current));
          } else if (problem) {
            setFieldError((current) => (current?.name === keyOf(field) ? { name: keyOf(field), message: problem } : current));
          }
        }}
        className="space-y-3"
      >
        {listing && <input type="hidden" name="listingId" value={listing.id} />}

        {published ? (
          <div className="space-y-3 border border-line bg-surface p-3">
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
                    <th className="w-32 border border-line bg-head p-1.5 text-left font-normal text-muted">{k}</th>
                    <td className="border border-line p-1.5">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {description}
            {photoBlock}
          </div>
        ) : (
          <>
            <div className="space-y-3 border border-line bg-surface p-3">
              <h2 className="text-sm font-bold">{listing ? "Details" : "New listing"}</h2>
              <label className="block">
                <span className={label}>Title</span>
                <input name="title" required minLength={5} maxLength={80} defaultValue={listing?.title} className={input} />
                {errorFor("title")}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className={label}>Category</span>
                  <select key={listing?.categoryId} name="categoryId" required defaultValue={listing?.categoryId ?? ""} className={input}>
                    <option value="" disabled>
                      Choose…
                    </option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {errorFor("categoryId")}
                </label>
                <label className="block">
                  <span className={label}>Condition</span>
                  <select key={listing?.condition} name="condition" required defaultValue={listing?.condition ?? ""} className={input}>
                    <option value="" disabled>
                      Choose…
                    </option>
                    {LISTING_CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {CONDITION_LABELS[c]}
                      </option>
                    ))}
                  </select>
                  {errorFor("condition")}
                </label>
              </div>
              {description}
            </div>

            {photoBlock}

            <div className="space-y-3 border border-line bg-surface p-3">
              {/* The dropdowns are keyed by their saved value: React resets a form after a save, and a dropdown would otherwise keep the old choice once the new one arrives. */}
              <h2 className="text-sm font-bold">Price and duration</h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:items-end">
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
                  {errorFor("startingPrice")}
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
                  <select key={listing?.durationDays} name="durationDays" required defaultValue={listing?.durationDays ?? 7} className={input}>
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

            <div className="space-y-3 border border-line bg-surface p-3">
              <h2 className="text-sm font-bold">Pickup address</h2>
              <p className="text-xs text-muted">
                Our carrier collects the item here when it sells, so give an address and a phone number where someone can hand it over. Buyers never see it.
                {defaultPickup && !listing?.pickupAddress ? " It starts as your default address; change anything for this item." : ""}
              </p>
              <AddressFields prefix="pickup_" defaults={listing?.pickupAddress ?? defaultPickup} nameLabel="Contact name" markRequired error={fieldError} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="saveAsDefault" defaultChecked={!defaultPickup && !listing?.pickupAddress} />
                Save as my default pickup address
              </label>
            </div>
          </>
        )}

        {!externalSave && (
          <div ref={errorRef} className="space-y-2 border border-line bg-surface p-3">
            {statusLines}
            <button
              disabled={pending || saveLocked}
              className="cursor-pointer bg-brand px-3 py-1 font-bold text-on-brand hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "..." : listing ? (saveLocked ? "Saved" : "Save") : "Create draft"}
            </button>
          </div>
        )}
      </form>
      {externalSave && slot && showStatus && createPortal(<div ref={errorRef} className="space-y-1">{statusLines}</div>, slot)}
    </>
  );
}
