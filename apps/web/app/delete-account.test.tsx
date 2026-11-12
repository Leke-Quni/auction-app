// @vitest-environment jsdom
import type { DeletionBlocker } from "@auction/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { sendAccountDeletionCodeAction, deleteAccountAction } = vi.hoisted(() => ({
  sendAccountDeletionCodeAction: vi.fn(async () => ({ ok: "We emailed you a 6-digit code. Enter it below to delete your account." })),
  deleteAccountAction: vi.fn(async () => ({ error: "That code is invalid or has expired." })),
}));
vi.mock("./actions", () => ({ sendAccountDeletionCodeAction, deleteAccountAction }));

import { DeleteAccount } from "./delete-account";

afterEach(() => {
  cleanup();
  sendAccountDeletionCodeAction.mockClear();
  deleteAccountAction.mockClear();
});

const blocker = (over: Partial<DeletionBlocker> = {}): DeletionBlocker => ({ kind: "LIVE_AUCTION_WITH_BIDS", title: "Vintage lamp", listingId: "L1", text: "Your auction has bids. Wait for it to end.", ...over });

describe("DeleteAccount", () => {
  it("lists what still stops the deletion, with links, and offers no form", () => {
    render(<DeleteAccount blockers={[blocker(), blocker({ kind: "SALE_IN_PROGRESS", title: "Old radio", listingId: "L2", orderId: "O2", text: "You sold this and the buyer has not paid yet." })]} />);
    expect(screen.getByText(/once these are finished/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Vintage lamp" }).getAttribute("href")).toBe("/listings/L1");
    expect(screen.getByRole("link", { name: "Old radio" }).getAttribute("href")).toBe("/orders/O2");
    expect(screen.queryByRole("button", { name: "Delete my account" })).toBeNull();
  });

  it("starts as one row, and opens a form that says what happens", () => {
    render(<DeleteAccount blockers={[]} />);
    expect(screen.queryByLabelText("Your password")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByLabelText("Your password")).toBeTruthy();
    expect(screen.getByText(/30 days you can sign in and restore it/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Your password")).toBeNull();
  });

  it("asks for the code with the password, and shows what the server answers to the final step", async () => {
    render(<DeleteAccount blockers={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "secret-pass" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
    await waitFor(() => expect(screen.getByText(/We emailed you a 6-digit code/)).toBeTruthy());
    expect(sendAccountDeletionCodeAction).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    await waitFor(() => expect(screen.getByText("That code is invalid or has expired.")).toBeTruthy());
    expect(deleteAccountAction).toHaveBeenCalledTimes(1);
  });
});
