// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { relistListingAction } = vi.hoisted(() => ({ relistListingAction: vi.fn() }));
vi.mock("@/app/sell/actions", () => ({ relistListingAction }));

import { RelistButton } from "./relist-button";

beforeEach(() => {
  relistListingAction.mockReset();
  relistListingAction.mockResolvedValue({});
});
afterEach(cleanup);

describe("RelistButton", () => {
  it("lists the item again with one click", async () => {
    render(<RelistButton listingId="L1" />);
    fireEvent.click(screen.getByRole("button", { name: "List it again" }));
    await waitFor(() => expect(relistListingAction).toHaveBeenCalledWith("L1"));
  });

  it("shows why it could not", async () => {
    relistListingAction.mockResolvedValue({ error: "Only an auction that ended without a sale can be listed again" });
    render(<RelistButton listingId="L1" />);
    fireEvent.click(screen.getByRole("button", { name: "List it again" }));
    expect(await screen.findByText(/ended without a sale/)).toBeTruthy();
  });
});
