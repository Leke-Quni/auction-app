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

  it("puts the photos between the details and the price on a draft, and on the new-listing form", () => {
    const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    for (const props of [{}, { listing }]) {
      cleanup();
      render(<ListingForm categories={categories} {...props} photos={<div data-testid="photos">photos</div>} />);
      const title = field("title")!;
      const descriptionField = field("description")!;
      const photos = screen.getByTestId("photos");
      const price = field("startingPrice")!;
      expect(before(title, descriptionField)).toBe(true);
      expect(before(descriptionField, photos)).toBe(true);
      expect(before(photos, price)).toBe(true);
      expect(before(photos, field("reservePrice")!)).toBe(true);
      expect(before(photos, field("durationDays")!)).toBe(true);
    }
  });

  it("does not render the photo slot inside the locked form of a published listing", () => {
    render(<ListingForm categories={categories} listing={{ ...listing, status: "PUBLISHED" }} photos={<div data-testid="photos">photos</div>} />);
    expect(screen.queryByTestId("photos")).toBeNull();
  });

  it("offers the seller's default pickup address on a new listing, with a Save as default box only when there is none", () => {
    const pickup = { name: "Sam Seller", line1: "Rr. Dardania 12", city: "Prizren", postcode: "20000", country: "XK" as const, phone: "+38344000111" };
    const { unmount } = render(<ListingForm categories={categories} defaultPickup={pickup} />);
    expect(field("pickup_line1")?.value).toBe("Rr. Dardania 12");
    expect(field("pickup_phone")?.value).toBe("+38344000111");
    expect(field("saveAsDefault")?.checked).toBe(false);
    unmount();
    render(<ListingForm categories={categories} />);
    expect(field("pickup_line1")?.value).toBe("");
    expect(field("saveAsDefault")?.checked).toBe(true);
  });

  it("shows the listing's own pickup address instead of the default", () => {
    const own = { name: "Pia", line1: "Ul. Makedonija 8", city: "Skopje", postcode: "1000", country: "MK" as const, phone: "+38970000444" };
    render(<ListingForm categories={categories} listing={{ ...listing, pickupAddress: own }} defaultPickup={{ ...own, line1: "Elsewhere 1" }} />);
    expect(field("pickup_line1")?.value).toBe("Ul. Makedonija 8");
  });
});
