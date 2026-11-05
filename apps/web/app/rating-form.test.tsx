// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rateSellerAction } = vi.hoisted(() => ({ rateSellerAction: vi.fn() }));
vi.mock("./orders/actions", () => ({ rateSellerAction }));

import { RatingForm } from "./rating-form";

beforeEach(() => rateSellerAction.mockReset().mockResolvedValue({}));
afterEach(cleanup);

describe("RatingForm", () => {
  it("sends the chosen stars and the comment", async () => {
    render(<RatingForm orderId="o1" sellerName="sam" />);
    expect(screen.getByText("How was sam?")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("4 stars"));
    fireEvent.change(screen.getByLabelText(/comment/i), { target: { value: "Fast and well packed." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit rating" }));
    await waitFor(() => expect(rateSellerAction).toHaveBeenCalledWith("o1", 4, "Fast and well packed."));
  });

  it("does not send until stars are chosen", async () => {
    render(<RatingForm orderId="o1" sellerName="sam" />);
    fireEvent.click(screen.getByRole("button", { name: "Submit rating" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Choose 1 to 5 stars");
    expect(rateSellerAction).not.toHaveBeenCalled();
  });

  it("shows why the rating was refused", async () => {
    rateSellerAction.mockResolvedValue({ error: "You have already rated this seller for this order." });
    render(<RatingForm orderId="o1" sellerName="sam" />);
    fireEvent.click(screen.getByLabelText("5 stars"));
    fireEvent.click(screen.getByRole("button", { name: "Submit rating" }));
    expect(await screen.findByText(/already rated/)).toBeTruthy();
  });
});
