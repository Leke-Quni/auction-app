"use client";

import { CALLING_CODES, SHIPPING_COUNTRIES, splitPhone, type ShippingAddress, type ShippingCountry } from "@auction/shared";
import { useState } from "react";

const input = "mt-1 w-full border border-field bg-surface p-1.5 text-sm";
const label = "text-xs text-muted";

// A country's flag as an emoji, built from its two-letter code.
const flag = (code: string) => String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

// The code list: +1 first (the default), then the other countries we serve.
const CODE_OPTIONS = [["US", CALLING_CODES.US], ...Object.entries(CALLING_CODES).filter(([c]) => c !== "US")] as [ShippingCountry, string][];

export type AddressDefaults = Partial<ShippingAddress> | null | undefined;

// The fields of an address (a delivery address or a pickup address), named `${prefix}name`, `${prefix}line1` and so on.
// The phone is a country-code selector (+1 to start, then it follows the chosen country until the person picks a code
// themselves; each option is a flag and a code) and a number box; together they are sent as one international number in `${prefix}phone`.
// `required` is left off where a draft may be saved half-filled; the API checks everything it needs.
export function AddressFields({ prefix = "", defaults, required = false, nameLabel = "Full name" }: { prefix?: string; defaults?: AddressDefaults; required?: boolean; nameLabel?: string }) {
  const [country, setCountry] = useState<string>(defaults?.country ?? "");
  const saved = defaults?.phone ? splitPhone(defaults.phone) : null;
  const [code, setCode] = useState(saved?.code ?? CALLING_CODES[(defaults?.country ?? "") as ShippingCountry] ?? CALLING_CODES.US);
  const [codeChosen, setCodeChosen] = useState(!!saved);
  const [national, setNational] = useState(saved?.national ?? "");
  const digits = national.replace(/\D/g, "");

  return (
    <div className="space-y-2">
      <label className="block">
        <span className={label}>{nameLabel}</span>
        <input name={`${prefix}name`} required={required} defaultValue={defaults?.name} className={input} autoComplete="name" />
      </label>
      <label className="block">
        <span className={label}>Street address</span>
        <input name={`${prefix}line1`} required={required} defaultValue={defaults?.line1} className={input} autoComplete="address-line1" />
      </label>
      <label className="block">
        <span className={label}>Apartment, floor (optional)</span>
        <input name={`${prefix}line2`} defaultValue={defaults?.line2} className={input} autoComplete="address-line2" />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className={label}>City</span>
          <input name={`${prefix}city`} required={required} defaultValue={defaults?.city} className={input} autoComplete="address-level2" />
        </label>
        <label className="block">
          <span className={label}>Postcode</span>
          <input name={`${prefix}postcode`} required={required} defaultValue={defaults?.postcode} className={input} autoComplete="postal-code" />
        </label>
        <label className="block">
          <span className={label}>Country</span>
          <select
            name={`${prefix}country`}
            required={required}
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              if (!codeChosen) setCode(CALLING_CODES[e.target.value as ShippingCountry] ?? CALLING_CODES.US);
            }}
            className={input}
          >
            <option value="" disabled>
              Choose…
            </option>
            {Object.entries(SHIPPING_COUNTRIES).map(([c, name]) => (
              <option key={c} value={c}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <span className={label}>Phone</span>
        <div className="grid grid-cols-[6.5rem_1fr] gap-2">
          <select
            aria-label="Phone country code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setCodeChosen(true);
            }}
            className={input}
          >
            {CODE_OPTIONS.map(([c, dial]) => (
              <option key={c} value={dial}>
                {flag(c)} +{dial}
              </option>
            ))}
            {code && !Object.values(CALLING_CODES).includes(code) && <option value={code}>+{code}</option>}
          </select>
          <input
            aria-label="Phone number"
            value={national}
            onChange={(e) => setNational(e.target.value)}
            required={required}
            inputMode="tel"
            autoComplete="tel-national"
            className={input}
          />
        </div>
        <input type="hidden" name={`${prefix}phone`} value={code && digits ? `+${code}${digits}` : ""} />
      </div>
    </div>
  );
}
