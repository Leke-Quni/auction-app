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
  useUnsavedChanges(formRef, editing);

  useEffect(() => {
    if (state.ok) setEditing(false);
  }, [state]);

  return (
    <div className="space-y-2 border border-line bg-white p-3">
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
            <button disabled={pending} className="cursor-pointer bg-brand px-3 py-1 font-bold text-white hover:bg-brand-dark disabled:opacity-60">
              {pending ? "..." : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="cursor-pointer border border-[#888] bg-white px-3 py-1">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
