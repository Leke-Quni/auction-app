import { describe, expect, it } from "vitest";
import {
  CONDITION_LABELS,
  LISTING_CONDITIONS,
  createListingSchema,
  eurosToCents,
  formatDuration,
  formatEur,
  listingImagesSchema,
  listingPhase,
  publishListingSchema,
  updateListingSchema,
  updatePublishedListingSchema,
} from "./listings";

const valid = {
  title: "Vintage wristwatch",
  description: "Serviced, original strap, runs well.",
  categoryId: "category_watches_jewelry",
  condition: "GOOD" as const,
  startingPriceCents: 1000,
  reservePriceCents: null,
  durationDays: 5,
};

const firstMessage = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;

describe("createListingSchema", () => {
  it("accepts a valid listing, with or without a reserve", () => {
    expect(createListingSchema.safeParse(valid).success).toBe(true);
    expect(createListingSchema.safeParse({ ...valid, reservePriceCents: 1000 }).success).toBe(true);
    expect(createListingSchema.safeParse({ ...valid, reservePriceCents: 5000 }).success).toBe(true);
  });

  it("trims the title and description", () => {
    const r = createListingSchema.parse({ ...valid, title: "  Vintage watch  " });
    expect(r.title).toBe("Vintage watch");
  });

  it("rejects short or long titles and descriptions", () => {
    expect(createListingSchema.safeParse({ ...valid, title: "abcd" }).success).toBe(false);
    expect(createListingSchema.safeParse({ ...valid, title: "a".repeat(81) }).success).toBe(false);
    expect(createListingSchema.safeParse({ ...valid, description: "too short" }).success).toBe(false);
    expect(createListingSchema.safeParse({ ...valid, description: "a".repeat(4001) }).success).toBe(false);
  });

  it("requires a starting price of at least €1.00 in whole cents", () => {
    expect(firstMessage(createListingSchema.safeParse({ ...valid, startingPriceCents: 99 }))).toBe("Starting price must be at least €1.00");
    expect(createListingSchema.safeParse({ ...valid, startingPriceCents: 100 }).success).toBe(true);
    expect(createListingSchema.safeParse({ ...valid, startingPriceCents: 10.5 }).success).toBe(false);
    expect(createListingSchema.safeParse({ ...valid, startingPriceCents: 1_000_000_000 }).success).toBe(false);
  });

  it("rejects a reserve below the starting price", () => {
    const r = createListingSchema.safeParse({ ...valid, reservePriceCents: 999 });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toBe("Reserve price cannot be lower than the starting price");
  });

  it("only allows 1, 3, 5, 7, or 30 day auctions", () => {
    for (const d of [1, 3, 5, 7, 30]) expect(createListingSchema.safeParse({ ...valid, durationDays: d }).success).toBe(true);
    for (const d of [0, 2, 4, 6, 10, 14, 29, 31, 60]) expect(createListingSchema.safeParse({ ...valid, durationDays: d }).success).toBe(false);
  });

  it("offers New, Like new, Good, Fair, and Poor as conditions, and no longer 'for parts'", () => {
    expect([...LISTING_CONDITIONS]).toEqual(["NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR"]);
    expect(CONDITION_LABELS.POOR).toBe("Poor");
    expect(createListingSchema.safeParse({ ...valid, condition: "POOR" }).success).toBe(true);
    expect(createListingSchema.safeParse({ ...valid, condition: "OLD" }).success).toBe(false);
    expect(createListingSchema.safeParse({ ...valid, condition: "FOR_PARTS" }).success).toBe(false);
  });

  it("rejects an unknown condition and a missing category", () => {
    expect(createListingSchema.safeParse({ ...valid, condition: "BROKEN" }).success).toBe(false);
    expect(createListingSchema.safeParse({ ...valid, categoryId: "" }).success).toBe(false);
  });
});

describe("updateListingSchema", () => {
  it("accepts any subset of fields", () => {
    expect(updateListingSchema.safeParse({}).success).toBe(true);
    expect(updateListingSchema.safeParse({ title: "A new title" }).success).toBe(true);
    expect(updateListingSchema.safeParse({ title: "no" }).success).toBe(false);
  });

  it("checks the reserve against the starting price only when both are sent", () => {
    expect(updateListingSchema.safeParse({ reservePriceCents: 500 }).success).toBe(true);
    expect(updateListingSchema.safeParse({ startingPriceCents: 1000, reservePriceCents: 500 }).success).toBe(false);
  });
});

describe("updatePublishedListingSchema", () => {
  it("keeps only the description", () => {
    const r = updatePublishedListingSchema.parse({ description: "A longer description here", title: "Sneaky change" });
    expect(r).toEqual({ description: "A longer description here" });
  });
});

describe("listingImagesSchema", () => {
  const img = (n: number) => ({ url: `https://x.public.blob.vercel-storage.com/listings/u/${n}.jpg`, pathname: `listings/u/${n}.jpg` });

  it("accepts 0 to 8 distinct photos", () => {
    expect(listingImagesSchema.safeParse([]).success).toBe(true);
    expect(listingImagesSchema.safeParse(Array.from({ length: 8 }, (_, i) => img(i))).success).toBe(true);
  });

  it("rejects a ninth photo and duplicates", () => {
    expect(listingImagesSchema.safeParse(Array.from({ length: 9 }, (_, i) => img(i))).success).toBe(false);
    expect(listingImagesSchema.safeParse([img(1), img(1)]).success).toBe(false);
  });

  it("rejects entries that are not URLs", () => {
    expect(listingImagesSchema.safeParse([{ url: "not a url", pathname: "p" }]).success).toBe(false);
  });
});

describe("publishListingSchema", () => {
  const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

  it("starts now when no time is given", () => {
    expect(publishListingSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a start time up to 30 days ahead", () => {
    expect(publishListingSchema.safeParse({ startsAt: inMs(3_600_000) }).success).toBe(true);
    expect(publishListingSchema.safeParse({ startsAt: inMs(29 * 86_400_000) }).success).toBe(true);
  });

  it("rejects the past, more than 30 days ahead, and non-dates", () => {
    expect(publishListingSchema.safeParse({ startsAt: inMs(-3_600_000) }).success).toBe(false);
    expect(publishListingSchema.safeParse({ startsAt: inMs(31 * 86_400_000) }).success).toBe(false);
    expect(publishListingSchema.safeParse({ startsAt: "tomorrow" }).success).toBe(false);
  });
});

describe("eurosToCents", () => {
  it("parses whole and fractional euros, with a dot or a comma", () => {
    expect(eurosToCents("12")).toBe(1200);
    expect(eurosToCents("12.5")).toBe(1250);
    expect(eurosToCents("12.50")).toBe(1250);
    expect(eurosToCents("12,50")).toBe(1250);
    expect(eurosToCents(" 0.99 ")).toBe(99);
    expect(eurosToCents(7)).toBe(700);
  });

  it("returns null for anything that is not a plain amount", () => {
    for (const bad of ["", "abc", "-5", "12.345", "1,000.00", "€5", "5 €", "1e3", "."]) expect(eurosToCents(bad)).toBeNull();
  });

  it("avoids floating-point drift", () => {
    expect(eurosToCents("0.1")).toBe(10);
    expect(eurosToCents("19.99")).toBe(1999);
    expect(eurosToCents("1.15")).toBe(115);
  });
});

describe("formatDuration", () => {
  it("writes 1 day, N days, and 30 days as a month", () => {
    expect(formatDuration(1)).toBe("1 day");
    expect(formatDuration(7)).toBe("7 days");
    expect(formatDuration(30)).toBe("30 days (1 month)");
  });
});

describe("formatEur", () => {
  it("formats cents as euros with two decimals and thousands separators", () => {
    expect(formatEur(0)).toBe("€0.00");
    expect(formatEur(99)).toBe("€0.99");
    expect(formatEur(1250)).toBe("€12.50");
    expect(formatEur(123456789)).toBe("€1,234,567.89");
  });
});

describe("listingPhase", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  const at = (h: number) => new Date(now.getTime() + h * 3_600_000);

  it("is draft until published", () => {
    expect(listingPhase({ status: "DRAFT", startsAt: null, endsAt: null }, now)).toBe("draft");
  });

  it("is upcoming, live, then ended around the start and end times", () => {
    expect(listingPhase({ status: "PUBLISHED", startsAt: at(2), endsAt: at(50) }, now)).toBe("upcoming");
    expect(listingPhase({ status: "PUBLISHED", startsAt: at(-1), endsAt: at(10) }, now)).toBe("live");
    expect(listingPhase({ status: "PUBLISHED", startsAt: at(-10), endsAt: at(-1) }, now)).toBe("ended");
    expect(listingPhase({ status: "PUBLISHED", startsAt: at(-10), endsAt: now }, now)).toBe("ended");
  });

  it("accepts ISO strings", () => {
    expect(listingPhase({ status: "PUBLISHED", startsAt: at(-1).toISOString(), endsAt: at(1).toISOString() }, now)).toBe("live");
  });
});
