import { describe, expect, it } from "vitest";
import { containsContactDetails } from "./questions";

describe("containsContactDetails", () => {
  it.each([
    "write to me at john@example.com",
    "john.doe+auction@mail.example.co.uk",
    "call +383 44 123 456",
    "call 044 123 456",
    "044-123-456-78",
    "(044) 123 4567",
    "0038344123456",
    "WhatsApp: 355 69 123 4567",
    "044.123.456.78",
    "044/123/456",
  ])("flags %s", (text) => expect(containsContactDetails(text)).toBe(true));

  it.each([
    "Is this genuine?",
    "It costs 1,500 euros",
    "Is it 100% original?",
    "Bought on 2026-11-03",
    "Bought on 03-11-2026",
    "Bought on 3.11.2026 or 03/11/26",
    "Item number 12345",
    "about 3.5 kg and 120 cm",
    "price 1500000",
    "bid 12 or 15 or 20",
    "an @ sign alone, or @handle",
    "",
  ])("leaves %s alone", (text) => expect(containsContactDetails(text)).toBe(false));
});
