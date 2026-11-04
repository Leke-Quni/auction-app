import { describe, expect, it } from "vitest";
import { CALLING_CODES, DELIVERY_OPTIONS, SHIPPING_COUNTRIES, deliveryBaseCents, deliveryOptions, normalizePhone, pickupAddressSchema, saveShippingSchema, shippingAddressSchema, splitPhone } from "./shipping";

const address = { name: "Ada Buyer", line1: "Rr. Nene Tereza 1", city: "Prishtina", postcode: "10000", country: "XK", phone: "+383 44 111 222" };

describe("shippingAddressSchema", () => {
  it("accepts a full address and trims it", () => {
    expect(shippingAddressSchema.parse({ ...address, name: "  Ada Buyer  " }).name).toBe("Ada Buyer");
    expect(shippingAddressSchema.safeParse({ ...address, line2: "Floor 3" }).success).toBe(true);
  });

  it("rejects missing parts, unknown countries and phone numbers with letters", () => {
    for (const bad of [{ name: "A" }, { line1: "" }, { city: "" }, { postcode: "" }, { country: "ZZ" }, { phone: "call me" }, { phone: "123" }]) {
      expect(shippingAddressSchema.safeParse({ ...address, ...bad }).success).toBe(false);
    }
  });

  it("is the same shape for a seller's pickup address", () => {
    expect(pickupAddressSchema.safeParse(address).success).toBe(true);
    expect(pickupAddressSchema.safeParse({ ...address, phone: "" }).success).toBe(false);
  });
});

describe("saveShippingSchema", () => {
  it("carries the chosen option by id only", () => {
    const parsed = saveShippingSchema.parse({ address, optionId: "standard", priceCents: 1 });
    expect(parsed).not.toHaveProperty("priceCents");
  });
});

describe("deliveryBaseCents", () => {
  it("is 5% of the item price, to the nearest cent", () => {
    expect(deliveryBaseCents(40_000)).toBe(2000);
    expect(deliveryBaseCents(40_010)).toBe(2001); // 2000.5 rounds up
  });

  it("never goes below 3 euros or above 50", () => {
    expect(deliveryBaseCents(1000)).toBe(300);
    expect(deliveryBaseCents(6000)).toBe(300); // exactly the minimum
    expect(deliveryBaseCents(100_000)).toBe(5000); // exactly the maximum
    expect(deliveryBaseCents(5_000_000)).toBe(5000);
  });

  it("follows a different rule", () => {
    expect(deliveryBaseCents(10_000, { percent: 10, minCents: 100, maxCents: 800 })).toBe(800);
  });
});

describe("deliveryOptions", () => {
  it("adds each option's extra to the base", () => {
    expect(deliveryOptions(40_000).map((o) => [o.id, o.priceCents])).toEqual([["standard", 2000], ["express", 2600], ["insured", 2400]]);
  });

  it("describes the options and leaves no config field in them", () => {
    const [standard, express, insured] = deliveryOptions(1000);
    expect(standard).toEqual({ id: "standard", name: "Standard", estimatedDays: 6, tracked: false, insured: false, priceCents: 300 });
    expect(express).toMatchObject({ estimatedDays: 2, tracked: true, insured: true });
    expect(insured).toMatchObject({ tracked: true, insured: true });
    expect(standard).not.toHaveProperty("extraCents");
    expect(DELIVERY_OPTIONS.map((o) => o.id)).toEqual(["standard", "express", "insured"]);
  });
});

describe("normalizePhone and splitPhone", () => {
  it("turns common spellings into one international form", () => {
    for (const typed of ["+355 69 111 2222", "+355(69)111-2222", "+355.69.111.2222", " +355691112222 "]) expect(normalizePhone(typed)).toBe("+355691112222");
  });

  it("refuses anything that is not +, a code that does not start with 0, and 7 to 15 digits", () => {
    for (const bad of ["", "abc", "- - - -", "+++++++", "0691112222", "355691112222", "+0691112222", "+12345", "+1234567890123456"]) expect(normalizePhone(bad), bad).toBeNull();
  });

  it("splits a number into the dialling code and the rest, using the longest known code", () => {
    expect(splitPhone("+355691112222")).toEqual({ code: "355", national: "691112222" });
    expect(splitPhone("+38344111222")).toEqual({ code: "383", national: "44111222" });
    expect(splitPhone("+12025550123")).toEqual({ code: "1", national: "2025550123" });
    expect(splitPhone("+4930123456")).toEqual({ code: "49", national: "30123456" });
    expect(splitPhone("+41791234567")).toEqual({ code: "41", national: "791234567" }); // not a code we list: the first two digits
  });

  it("has a code for every country we serve", () => {
    expect(Object.keys(CALLING_CODES).sort()).toEqual(Object.keys(SHIPPING_COUNTRIES).sort());
  });
});

describe("address rules", () => {
  it("normalises the phone it stores", () => {
    expect(shippingAddressSchema.parse({ ...address, phone: "+383 44 111 222" }).phone).toBe("+38344111222");
  });

  it("refuses text in names and cities that could carry a message, a number or markup", () => {
    for (const bad of [{ city: "Prishtina\nCall me" }, { city: "Prishtina 044111222" }, { city: "a@b.co" }, { city: "<b>x</b>" }, { name: "Ben\nBuyer" }, { name: "Ben 044111222" }, { line1: "Rr 1\nsecond" }, { line1: "me@example.com" }]) {
      expect(shippingAddressSchema.safeParse({ ...address, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("accepts accented letters, hyphens, apostrophes and dots", () => {
    expect(shippingAddressSchema.safeParse({ ...address, name: "Ëlira O'Connor-Gashi", city: "Shkodër" }).success).toBe(true);
    expect(shippingAddressSchema.safeParse({ ...address, name: "Dr. Zoran Đorđević" }).success).toBe(true);
  });

  it("checks the postcode against the country", () => {
    expect(shippingAddressSchema.safeParse({ ...address, postcode: "1000" }).success).toBe(false); // Kosovo has 5 digits
    expect(shippingAddressSchema.safeParse({ ...address, country: "AL", postcode: "1001", phone: "+355 69 111 2222" }).success).toBe(true);
    expect(shippingAddressSchema.safeParse({ ...address, country: "GB", postcode: "SW1A 1AA", phone: "+44 20 7946 0958" }).success).toBe(true);
    expect(shippingAddressSchema.safeParse({ ...address, country: "US", postcode: "10001-1234", phone: "+1 202 555 0123" }).success).toBe(true);
  });

  it("asks for the leading 0 to be left out after the country code, except in Italy", () => {
    expect(shippingAddressSchema.safeParse({ ...address, country: "AL", postcode: "1001", phone: "+355 069 111 2222" }).success).toBe(false);
    expect(shippingAddressSchema.safeParse({ ...address, country: "IT", postcode: "00100", phone: "+39 06 1234 5678" }).success).toBe(true);
  });
});

describe("messages for missing parts", () => {
  it("says what to enter rather than 'Required'", () => {
    const result = shippingAddressSchema.safeParse({});
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((i) => i.message);
    expect(messages).not.toContain("Required");
    expect(messages).toEqual(expect.arrayContaining(["Enter the contact name", "Enter the street address", "Enter a city", "Enter a postcode", "Choose a country", "Enter a phone number with its country code, such as +355 69 123 4567"]));
  });
});
