// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push, router } = vi.hoisted(() => {
  const push = vi.fn();
  return { push, router: { push } };
});
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./actions", () => ({ saveListingAction: vi.fn(async () => ({})) }));

import { saveListingAction } from "./actions";
import { ListingForm, flagIncompleteForPublish, type FormListing } from "./listing-form";

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
    expect(screen.getByRole("button", { name: "Saved" })).toBeTruthy();
    expect(field("listingId")?.value).toBe("L1");
    expect(field("title")?.value).toBe("Vintage wristwatch");
    expect(field("categoryId")?.value).toBe("c2");
    expect(field("condition")?.value).toBe("GOOD");
    expect(field("startingPrice")?.value).toBe("25.50");
    expect(field("reservePrice")?.value).toBe("");
    expect(field("durationDays")?.value).toBe("3");
  });

  it("locks Save on an existing listing until something is edited", () => {
    render(<ListingForm categories={categories} listing={listing} />);
    const save = screen.getByRole("button", { name: "Saved" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.input(field("title")!, { target: { value: "Vintage wristwatch, boxed" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(save.disabled).toBe(false);
  });

  it("does not submit without a photo; it marks the photo section and scrolls to it", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<ListingForm categories={categories} listing={listing} photos={<input type="hidden" name="photos" value="[]" />} />);
    const form = document.getElementById("listing-form")!;
    expect(fireEvent.submit(form)).toBe(false);
    expect(document.querySelector("[data-invalid]")?.contains(field("photos"))).toBe(true);
    expect(scroll).toHaveBeenCalled();
  });

  it("when saving, marks only the first empty required field, the title here, and leaves the rest alone", () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(<ListingForm categories={categories} />);
    (document.getElementById("listing-form") as HTMLFormElement).requestSubmit();
    expect(field("title")?.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field("title"));
    for (const name of ["categoryId", "condition", "description", "startingPrice"]) {
      expect(field(name)?.getAttribute("aria-invalid")).toBeNull();
    }
    fireEvent.input(field("title")!, { target: { value: "Vintage wristwatch" } });
    expect(field("title")?.getAttribute("aria-invalid")).toBeNull();
  });

  it("says what is wrong under the field: too short, then updates as the text grows, and goes when fixed", () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(<ListingForm categories={categories} listing={listing} />);
    fireEvent.input(field("description")!, { target: { value: "Short" } });
    act(() => (document.getElementById("listing-form") as HTMLFormElement).requestSubmit());
    expect(screen.getByText("Write at least 10 characters (you have 5).")).toBeTruthy();
    fireEvent.input(field("description")!, { target: { value: "Short one" } });
    expect(screen.getByText("Write at least 10 characters (you have 9).")).toBeTruthy();
    fireEvent.input(field("description")!, { target: { value: "Long enough now" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not count spaces and blank lines as writing: they are refused like an empty field", () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(<ListingForm categories={categories} listing={listing} />);
    fireEvent.input(field("description")!, { target: { value: "\n\n\n\n\n\n\n\n\n\n\n\n" } });
    act(() => (document.getElementById("listing-form") as HTMLFormElement).requestSubmit());
    expect(screen.getByRole("alert").textContent).toBe("Fill in this field.");
    expect(field("description")?.getAttribute("aria-invalid")).toBe("true");
    fireEvent.input(field("description")!, { target: { value: "  abc  " } });
    expect(screen.getByRole("alert").textContent).toBe("Write at least 10 characters (you have 3).");
  });

  it("says a required field is empty", () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(<ListingForm categories={categories} />);
    act(() => (document.getElementById("listing-form") as HTMLFormElement).requestSubmit());
    expect(screen.getByRole("alert").textContent).toBe("Fill in this field.");
  });

  it("takes the seller to the first empty pickup field, with a message, when the address is only half filled in", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<ListingForm categories={categories} listing={listing} />);
    fireEvent.input(field("pickup_city")!, { target: { value: "Pristina" } });
    act(() => (document.getElementById("listing-form") as HTMLFormElement).requestSubmit());
    expect(field("pickup_name")?.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field("pickup_name"));
    expect(scroll).toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Fill in this field.");
    expect(field("pickup_name")?.closest("label")?.contains(screen.getByRole("alert"))).toBe(true);
    fireEvent.input(field("pickup_name")!, { target: { value: "Ana" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lets a draft be saved with the whole pickup address empty", () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(<ListingForm categories={categories} listing={listing} />);
    fireEvent.input(field("title")!, { target: { value: "Vintage wristwatch, boxed" } });
    act(() => (document.getElementById("listing-form") as HTMLFormElement).requestSubmit());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("flags the empty pickup fields for publishing with a red border and moves to the first", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<ListingForm categories={categories} listing={listing} />);
    expect(flagIncompleteForPublish()).toBe(true);
    expect(field("pickup_name")?.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field("pickup_name"));
    fireEvent.input(field("pickup_name")!, { target: { value: "Ana" } });
    expect(field("pickup_name")?.getAttribute("aria-invalid")).toBeNull();
    expect(field("pickup_line1")?.getAttribute("aria-invalid")).toBe("true");
  });

  it("shows the new duration once the saved listing arrives with a different one", () => {
    const { rerender } = render(<ListingForm categories={categories} listing={{ ...listing, durationDays: 7 }} />);
    expect(field("durationDays")?.value).toBe("7");
    rerender(<ListingForm categories={categories} listing={{ ...listing, durationDays: 1 }} />);
    expect(field("durationDays")?.value).toBe("1");
  });

  it("says it saved, then a moment later goes to the listing page when the save asks for it", async () => {
    vi.mocked(saveListingAction).mockResolvedValueOnce({ ok: "Saved.", redirectTo: "/listings/L1" });
    render(
      <>
        <ListingForm categories={categories} listing={{ ...listing, status: "PUBLISHED" }} externalSave />
        <div id="listing-form-status" />
      </>,
    );
    fireEvent.input(field("description")!, { target: { value: "A new, longer description" } });
    act(() => (document.getElementById("listing-form") as HTMLFormElement).requestSubmit());
    await waitFor(() => expect(screen.getByText("Saved. Taking you back to the listing…")).toBeTruthy());
    expect(push).not.toHaveBeenCalled();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/listings/L1"), { timeout: 3000 });
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

  it("renders the photo slot inside the form of a published listing, so photos save with the description", () => {
    render(<ListingForm categories={categories} listing={{ ...listing, status: "PUBLISHED" }} photos={<div data-testid="photos">photos</div>} />);
    expect(screen.getByTestId("photos").closest("form")).toBeTruthy();
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
