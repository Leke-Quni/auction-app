// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SellerInfo } from "./seller-info";

afterEach(cleanup);

describe("SellerInfo", () => {
  it("shows the seller as a link to their profile, with the rating out of 5 and filled and empty stars", () => {
    render(<SellerInfo username="sam" average={4} count={12} />);
    expect(screen.getByRole("link", { name: "sam" }).getAttribute("href")).toBe("/sellers/sam");
    expect(screen.getByRole("img", { name: "4 out of 5 stars" }).textContent).toBe("★★★★☆");
    expect(screen.getByText("4.0")).toBeTruthy();
    expect(screen.getByText(/out of 5 \(12 ratings\)/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when nobody has rated the seller yet, with no warning", () => {
    render(<SellerInfo username="sam" average={null} count={0} />);
    expect(screen.getByText("No ratings yet")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("warns about a low rating", () => {
    render(<SellerInfo username="sam" average={2.5} count={4} />);
    expect(screen.getByRole("alert").textContent).toBe("This seller's ratings aren't very good. Be careful before placing any bids.");
  });

  it("does not warn on a low average from fewer than 3 ratings, or on exactly 3.5", () => {
    render(<SellerInfo username="sam" average={1} count={2} />);
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    render(<SellerInfo username="sam" average={3.5} count={10} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not show the warning to the seller themselves", () => {
    render(<SellerInfo username="sam" average={2} count={5} isOwner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
