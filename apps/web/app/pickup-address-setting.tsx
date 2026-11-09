"use client";

import { SHIPPING_COUNTRIES, type ShippingAddress } from "@auction/shared";
import { useActionState, useEffect, useRef, useState } from "react";
import { savePickupAddressAction } from "./actions";
import { AddressFields } from "./address-fields";
import { useUnsavedChanges } from "./use-unsaved-changes";

// The seller's default pickup address: where our carrier collects what they sell, unless a listing says otherwise.
export function PickupAddressSetting({ address }: { address: ShippingAddress | null }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(savePickupAddressAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  useUnsavedChanges(formRef, editing);

  useEffect(() => {
    if (state.ok) setEditing(false);
  }, [state]);

  const summary = address ? `${address.line1}, ${address.city}, ${SHIPPING_COUNTRIES[address.country] ?? address.country}` : "Not set";
  return (
    <div className="p-3">
      <div hidden={editing} className="flex items-center gap-3">
        <span className="w-24 shrink-0 text-xs text-muted">Pickup address</span>
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        <button type="button" onClick={() => setEditing(true)} aria-label="Edit pickup address" className="cursor-pointer text-brand underline">
          Edit
        </button>
      </div>
      {!editing && state.ok && <p className="mt-1 text-xs text-brand">{state.ok}</p>}
      <form ref={formRef} action={formAction} hidden={!editing} className="space-y-2">
        <p className="text-sm font-bold">Pickup address</p>
        <p className="text-xs text-muted">Where our carrier collects items you sell, and who to ask for. Buyers never see it. Each listing can use another address.</p>
        <AddressFields defaults={address} required nameLabel="Contact name" />
        {editing && state.error && <p className="text-urgent">{state.error}</p>}
        <div className="flex gap-2">
          <button disabled={pending} className="cursor-pointer bg-brand px-3 py-1 font-bold text-white hover:bg-brand-dark disabled:opacity-60">
            {pending ? "..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              formRef.current?.reset();
              setEditing(false);
            }}
            className="cursor-pointer border border-[#888] bg-white px-3 py-1"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
