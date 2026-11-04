// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { upload, saveImagesAction } = vi.hoisted(() => ({ upload: vi.fn(), saveImagesAction: vi.fn(async () => ({})) }));
vi.mock("@vercel/blob/client", () => ({ uploadPresigned: upload }));
vi.mock("./actions", () => ({
  saveImagesAction,
  saveListingAction: vi.fn(async () => ({})),
  publishListingAction: vi.fn(async () => ({})),
  updatePickupAddressAction: vi.fn(async () => ({})),
  deleteListingAction: vi.fn(async () => ({})),
}));

import { deleteListingAction } from "./actions";
import { ListingEditor } from "./listing-editor";
import type { FormListing } from "./listing-form";

afterEach(cleanup);

const categories = [{ id: "c1", name: "Art" }];
const listing: FormListing = {
  id: "L1",
  title: "Vintage wristwatch",
  description: "Serviced, original strap.",
  categoryId: "c1",
  condition: "GOOD",
  startingPriceCents: 2500,
  reservePriceCents: null,
  durationDays: 3,
  status: "DRAFT",
};
const url = (n: string) => `https://abc.public.blob.vercel-storage.com/listings/u1/${n}.jpg`;
const publishButton = () => screen.getByRole("button", { name: "Publish" }) as HTMLButtonElement;

describe("ListingEditor", () => {
  it("draft: photos sit inside the form between the description and the price, with the Publish panel below", () => {
    render(<ListingEditor categories={categories} listing={listing} userId="u1" initialPhotos={[url("a")]} />);
    const form = screen.getByRole("button", { name: "Save" }).closest("form")!;
    const heading = screen.getByRole("heading", { name: /Photos/ });
    expect(form.contains(heading)).toBe(true);
    const publish = screen.getByRole("heading", { name: "Publish" });
    expect(form.contains(publish)).toBe(false);
    expect(publishButton().disabled).toBe(false);
  });

  it("draft with no photos cannot be published until one is added", async () => {
    upload.mockResolvedValue({ url: url("new") });
    render(<ListingEditor categories={categories} listing={listing} userId="u1" initialPhotos={[]} />);
    expect(publishButton().disabled).toBe(true);
    expect(screen.getByText("Add at least one photo to publish.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Photo files"), { target: { files: [new File([new Uint8Array(10)], "a.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(saveImagesAction).toHaveBeenCalledWith("L1", [url("new")]));
    await waitFor(() => expect(publishButton().disabled).toBe(false));
  });

  it("removing the last photo disables Publish again", async () => {
    render(<ListingEditor categories={categories} listing={listing} userId="u1" initialPhotos={[url("a")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
    await waitFor(() => expect(publishButton().disabled).toBe(true));
  });

  it("published: photos sit below the form, and there is no Publish panel", () => {
    render(<ListingEditor categories={categories} listing={{ ...listing, status: "PUBLISHED" }} userId="u1" initialPhotos={[url("a")]} />);
    const form = screen.getByRole("button", { name: "Save" }).closest("form")!;
    expect(form.contains(screen.getByRole("heading", { name: /Photos/ }))).toBe(false);
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });

  it("published: can be removed after a confirmation, and a draft has no Remove listing button", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    render(<ListingEditor categories={categories} listing={{ ...listing, status: "PUBLISHED" }} userId="u1" initialPhotos={[url("a")]} />);

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Remove listing" }));
    expect(deleteListingAction).not.toHaveBeenCalled();

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove listing" }));
    await waitFor(() => expect(deleteListingAction).toHaveBeenCalledWith("L1"));

    cleanup();
    render(<ListingEditor categories={categories} listing={listing} userId="u1" initialPhotos={[url("a")]} />);
    expect(screen.queryByRole("button", { name: "Remove listing" })).toBeNull();
    confirmSpy.mockRestore();
  });
});
