import { z } from "zod";

// Countries a listing can ship from and an order can ship to. The three reference countries come first.
export const SHIPPING_COUNTRIES = {
  XK: "Kosovo",
  AL: "Albania",
  MK: "North Macedonia",
  ME: "Montenegro",
  RS: "Serbia",
  BA: "Bosnia and Herzegovina",
  HR: "Croatia",
  SI: "Slovenia",
  DE: "Germany",
  AT: "Austria",
  IT: "Italy",
  GR: "Greece",
  FR: "France",
  GB: "United Kingdom",
  US: "United States",
} as const;
export type ShippingCountry = keyof typeof SHIPPING_COUNTRIES;
export const SHIPPING_COUNTRY_CODES = Object.keys(SHIPPING_COUNTRIES) as [ShippingCountry, ...ShippingCountry[]];

const countryField = z.enum(SHIPPING_COUNTRY_CODES, { errorMap: () => ({ message: "Choose a country" }) });

// International dialling codes (without the +), used to pre-fill the phone prefix from the country.
export const CALLING_CODES: Record<ShippingCountry, string> = {
  XK: "383", AL: "355", MK: "389", ME: "382", RS: "381", BA: "387", HR: "385", SI: "386",
  DE: "49", AT: "43", IT: "39", GR: "30", FR: "33", GB: "44", US: "1",
};

const POSTCODE_PATTERNS: Record<ShippingCountry, RegExp> = {
  XK: /^\d{5}$/, AL: /^\d{4}$/, MK: /^\d{4}$/, ME: /^\d{5}$/, RS: /^\d{5}$/, BA: /^\d{5}$/, HR: /^\d{5}$/, SI: /^\d{4}$/,
  DE: /^\d{5}$/, AT: /^\d{4}$/, IT: /^\d{5}$/, GR: /^\d{3} ?\d{2}$/, FR: /^\d{5}$/, GB: /^[A-Za-z]{1,2}\d[A-Za-z\d]? ?\d[A-Za-z]{2}$/, US: /^\d{5}(-\d{4})?$/,
};

/** A phone number in international form without spaces ("+355691112222"), or null if it is not one. */
export function normalizePhone(input: string): string | null {
  const compact = input.replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{6,14}$/.test(compact) ? compact : null;
}

/** Splits "+355691112222" into the dialling code (known codes, longest first) and the rest. A number with an unknown code keeps its first digits as the code. */
export function splitPhone(phone: string): { code: string; national: string } {
  const digits = phone.replace(/^\+/, "");
  const known = Object.values(CALLING_CODES).sort((a, b) => b.length - a.length).find((c) => digits.startsWith(c));
  const code = known ?? digits.slice(0, 2);
  return { code, national: digits.slice(code.length) };
}

// Names of people and places: letters, spaces, dots, hyphens and apostrophes only. Free text here would let one side slip the
// other a phone number or a message, so digits, symbols and line breaks are refused.
const personOrPlace = (what: string, max: number) =>
  z
    .string({ required_error: `Enter ${what}` })
    .trim()
    .min(2, `Enter ${what}`)
    .max(max, `${what[0]!.toUpperCase()}${what.slice(1)} must be at most ${max} characters`)
    .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'\u2019-]*$/u, `${what[0]!.toUpperCase()}${what.slice(1)} can only contain letters, spaces, dots, hyphens and apostrophes`);

const streetLine = (what: string, required = `Enter ${what.toLowerCase()}`) =>
  z
    .string({ required_error: required })
    .trim()
    .max(120)
    .regex(/^[^\p{Cc}@<>]*$/u, `${what} cannot contain line breaks or symbols such as @`);

const phoneField = z
  .string({ required_error: "Enter a phone number with its country code, such as +355 69 123 4567" })
  .trim()
  .transform((value, ctx) => {
    const phone = normalizePhone(value);
    if (!phone) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a phone number with its country code, such as +355 69 123 4567" });
    return phone ?? value;
  });

// A person and place the carrier deals with: where to collect the item (the seller) or where to deliver it (the buyer).
export const shippingAddressSchema = z
  .object({
    name: personOrPlace("the contact name", 80),
    line1: streetLine("The street address", "Enter the street address").pipe(z.string().min(3, "Enter the street address")),
    line2: streetLine("The second address line").optional(),
    city: personOrPlace("a city", 60),
    postcode: z.string({ required_error: "Enter a postcode" }).trim().min(2, "Enter a postcode").max(10),
    country: countryField,
    phone: phoneField,
  })
  .superRefine((address, ctx) => {
    const pattern = POSTCODE_PATTERNS[address.country];
    if (pattern && !pattern.test(address.postcode)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["postcode"], message: `That does not look like a postcode in ${SHIPPING_COUNTRIES[address.country]}` });
    }
    // "+355 069 ..." is a common slip: the leading 0 of a national number is dropped after the country code (Italy keeps it).
    const { code, national } = splitPhone(address.phone);
    if (national.startsWith("0") && code !== "39") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["phone"], message: "Leave out the leading 0 after the country code" });
    }
  });
export type ShippingAddress = z.infer<typeof shippingAddressSchema>;

// The pickup address a seller gives for a listing has the same parts as a delivery address.
export const pickupAddressSchema = shippingAddressSchema;
export type PickupAddress = ShippingAddress;

// Delivery is handled by the platform, which pays the carriers out of what the buyer pays. The buyer pays a percentage of
// the item price (never below the minimum or above the maximum) plus the extra price of the option they choose.
// The three values are config on the API (`DELIVERY_PERCENT`, `DELIVERY_MIN_CENTS`, `DELIVERY_MAX_CENTS`).
export const DEFAULT_DELIVERY_PERCENT = 5;
export const DEFAULT_DELIVERY_MIN_CENTS = 300;
export const DEFAULT_DELIVERY_MAX_CENTS = 5000;

export interface DeliveryRule {
  percent: number;
  minCents: number;
  maxCents: number;
}
export const DEFAULT_DELIVERY_RULE: DeliveryRule = {
  percent: DEFAULT_DELIVERY_PERCENT,
  minCents: DEFAULT_DELIVERY_MIN_CENTS,
  maxCents: DEFAULT_DELIVERY_MAX_CENTS,
};

export const DELIVERY_OPTIONS = [
  { id: "standard", name: "Standard", estimatedDays: 6, tracked: false, insured: false, extraCents: 0 },
  { id: "express", name: "Express", estimatedDays: 2, tracked: true, insured: true, extraCents: 600 },
  { id: "insured", name: "Tracked and insured", estimatedDays: 6, tracked: true, insured: true, extraCents: 400 },
] as const;

// One option as the buyer is shown it, with the price for this order: the percentage part plus the option's extra.
export interface ShippingOption {
  id: string;
  name: string;
  estimatedDays: number;
  tracked: boolean;
  insured: boolean;
  priceCents: number;
}

/** The percentage part of delivery, in whole cents (a half rounds up), kept between the minimum and the maximum. */
export function deliveryBaseCents(itemCents: number, rule: DeliveryRule = DEFAULT_DELIVERY_RULE): number {
  const raw = Math.round((itemCents * rule.percent) / 100);
  return Math.min(rule.maxCents, Math.max(rule.minCents, raw));
}

/** Every delivery option with its price for an item that sold for `itemCents`. */
export function deliveryOptions(itemCents: number, rule: DeliveryRule = DEFAULT_DELIVERY_RULE): ShippingOption[] {
  const base = deliveryBaseCents(itemCents, rule);
  return DELIVERY_OPTIONS.map(({ extraCents, ...option }) => ({ ...option, priceCents: base + extraCents }));
}

export const saveShippingSchema = z.object({ address: shippingAddressSchema, optionId: z.string().min(1).max(100) });
export type SaveShippingInput = z.infer<typeof saveShippingSchema>;
