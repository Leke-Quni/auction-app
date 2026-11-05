"use client";

import { formatEur, type ShippingAddress, type ShippingOption } from "@auction/shared";
import { useState, useTransition } from "react";
import { AddressFields } from "@/app/address-fields";
import { readAddress } from "@/lib/address";
import { saveShippingAndPayAction } from "../../actions";

// Before paying: where to deliver, and which delivery option. The total updates as the option changes.
export function ShippingForm({
  orderId,
  amountCents,
  options,
  saved,
  savedOptionId,
  savedTrackingEmails,
}: {
  orderId: string;
  amountCents: number;
  options: ShippingOption[];
  saved: ShippingAddress | null;
  savedOptionId: string | null;
  savedTrackingEmails: boolean;
}) {
  const [choice, setChoice] = useState(options.find((o) => o.id === savedOptionId)?.id ?? options[0]?.id ?? "");
  const [trackingEmails, setTrackingEmails] = useState(savedTrackingEmails);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const chosen = options.find((o) => o.id === choice);

  const submit = (form: HTMLFormElement) => {
    const address = readAddress(new FormData(form));
    if (!address || !choice) return;
    setError("");
    start(async () => {
      const result = await saveShippingAndPayAction(orderId, address as unknown as ShippingAddress, choice, trackingEmails);
      if (result?.error) setError(result.error);
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
      className="space-y-3"
    >
      <div className="space-y-2 border border-line bg-white p-3">
        <h2 className="text-sm font-bold">Delivery address</h2>
        <AddressFields defaults={saved} required />
      </div>

      <div className="space-y-2 border border-line bg-white p-3">
        <h2 className="text-sm font-bold">Delivery option</h2>
        {options.map((o) => (
          <label key={o.id} className="flex cursor-pointer items-start gap-2 border border-line p-2">
            <input type="radio" name="option" value={o.id} checked={choice === o.id} onChange={() => setChoice(o.id)} className="mt-1" />
            <span className="flex-1">
              <b>{o.name}</b>
              <br />
              <span className="text-xs text-muted">
                About {o.estimatedDays} {o.estimatedDays === 1 ? "day" : "days"} · {o.tracked ? "Tracked" : "Not tracked"} · {o.insured ? "Insured" : "Not insured"}
              </span>
            </span>
            <b>{formatEur(o.priceCents)}</b>
          </label>
        ))}
        <label className="flex cursor-pointer items-center gap-2 pt-1">
          <input type="checkbox" name="trackingEmails" checked={trackingEmails} onChange={(e) => setTrackingEmails(e.target.checked)} />
          <span>Email me tracking updates (shipped, in transit, delivered)</span>
        </label>
        <p className="pt-1 font-bold">Total: {chosen ? formatEur(amountCents + chosen.priceCents) : "-"}</p>
        {error && (
          <p role="alert" className="text-urgent">
            {error}
          </p>
        )}
        <button disabled={pending || !chosen} className="cursor-pointer bg-brand px-4 py-2 font-bold text-white hover:bg-brand-dark disabled:opacity-60">
          {pending ? "Please wait..." : `Continue to payment${chosen ? ` (${formatEur(amountCents + chosen.priceCents)})` : ""}`}
        </button>
      </div>
    </form>
  );
}
