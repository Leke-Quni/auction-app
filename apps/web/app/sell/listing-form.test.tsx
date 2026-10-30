// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ saveListingAction: vi.fn(async () => ({})) }));

import { ListingForm, type FormListing } from "./listing-form";

afterEach(cleanup);

const categories = [
  { id: "c1", name: "Art" },
  { id: "c2", name: "Electronics" },
];
const listing: FormListing = {
  id: "L1",
  title: "Vintage wristwatch",
  description: "Serviced, original strap.",
  categoryId: "c2",
  condition: "GOOD",
  startingPriceCents: 2550,
  reservePriceCents: null,
  durationDays: 3,
  status: "DRAFT",
};
const field = (name: string) => document.querySelector(`[name="${name}"]`) as HTMLInputElement | null;

describe("ListingForm", () => {
  it("starts empty for a new listing, with a 7-day default and no listing id", () => {
    render(<ListingForm categories={categories} />);
    expect(screen.getByRole("button", { name: "Create draft" })).toBeTruthy();
    expect(field("title")?.value).toBe("");
    expect(field("durationDays")?.value).toBe("7");
    expect(field("listingId")).toBeNull();
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(["Art", "Electronics", "New", "Like new", "Good", "Fair", "Poor", "1 day", "7 days", "30 days (1 month)"]));
    expect(options).not.toContain("For parts or repair");
  });

  it("fills in a draft, showing prices in euros and an empty reserve", () => {
    render(<ListingForm categories={categories} listing={listing} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(field("listingId")?.value).toBe("L1");
    expect(field("title")?.value).toBe("Vintage wristwatch");
    expect(field("categoryId")?.value).toBe("c2");
    expect(field("condition")?.value).toBe("GOOD");
    expect(field("startingPrice")?.value).toBe("25.50");
    expect(field("reservePrice")?.value).toBe("");
    expect(field("durationDays")?.value).toBe("3");
  });

  it("shows an existing reserve price", () => {
    render(<ListingForm categories={categories} listing={{ ...listing, reservePriceCents: 10000 }} />);
    expect(field("reservePrice")?.value).toBe("100.00");
  });

  it("tells sellers the reserve is public", () => {
    render(<ListingForm categories={categories} />);
    expect(screen.getByText(/reserve price is shown to bidders/i)).toBeTruthy();
  });

  it("locks everything but the description once published", () => {
    render(<ListingForm categories={categories} listing={{ ...listing, status: "PUBLISHED", reservePriceCents: 10000 }} />);
    for (const locked of ["title", "categoryId", "condition", "startingPrice", "reservePrice", "durationDays"]) {
      expect(field(locked)).toBeNull();
    }
    expect(field("description")).not.toBeNull();
    expect(field("listingId")?.value).toBe("L1");
    expect(screen.getByText(/only the description can change/i)).toBeTruthy();
    for (const text of ["Vintage wristwatch", "Electronics", "Good", "€25.50", "€100.00", "3 days"]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });
});
