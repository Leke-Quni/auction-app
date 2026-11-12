"use client";

import { SHIPPING_COUNTRIES, type ShippingAddress } from "@auction/shared";
import { useActionState, useEffect, useRef, useState } from "react";
import { AddressFields } from "../address-fields";
import { updatePickupAddressAction } from "./actions";
import { useUnsavedChanges } from "../use-unsaved-changes";

// Where the carrier collects an item, with a way to correct it. Used on a published listing and on the seller's order,
// since a wrong street or phone number found late must still be fixable.
export function PickupAddressEditor({ listingId, address }: { listingId: string; address: ShippingAddress | null }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updatePickupAddressAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(formRef, editing, undefined, setDirty);
  // A saved address has nothing to save until it is edited; a first address can always be saved.
  const locked = !!address && !dirty;

  useEffect(() => {
    if (state.ok) setEditing(false);
  }, [state]);

  return (
    <div className="space-y-2 border border-line bg-surface p-3">
      <h2 className="text-sm font-bold">Pickup address</h2>
      {!editing && (
        <>
          {address ? (
            <p className="whitespace-pre-line">
              {[address.name, address.line1, address.line2, `${address.postcode} ${address.city}`, SHIPPING_COUNTRIES[address.country] ?? address.country, address.phone].filter(Boolean).join("\n")}
            </p>
          ) : (
            <p>No pickup address saved.</p>
          )}
          {state.ok && <p className="text-brand">{state.ok}</p>}
          <button type="button" onClick={() => setEditing(true)} className="cursor-pointer text-brand underline">
            {address ? "Correct the pickup address" : "Add a pickup address"}
          </button>
        </>
      )}
      {editing && (
        <form ref={formRef} action={formAction} className="space-y-2">
          <input type="hidden" name="listingId" value={listingId} />
          <p className="text-xs text-muted">The carrier calls this number before collecting. Buyers never see this address.</p>
          <AddressFields defaults={address} required nameLabel="Contact name" />
          {state.error && <p className="text-urgent">{state.error}</p>}
          <div className="flex gap-2">
            <button disabled={pending || locked} className="cursor-pointer bg-brand px-3 py-1 font-bold text-on-brand hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60">
              {pending ? "..." : "Save pickup address"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="cursor-pointer border border-field bg-surface px-3 py-1">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
