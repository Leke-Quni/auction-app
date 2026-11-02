// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ListingCard, type ListingSummary } from "./listing-card";

afterEach(cleanup);

const hour = 3_600_000;
const listing = (over: Partial<ListingSummary> = {}): ListingSummary => ({
  id: "L1",
  title: "Vintage wristwatch",
  startingPriceCents: 2_500,
  phase: "live",
  startsAt: new Date(Date.now() - hour).toISOString(),
  endsAt: new Date(Date.now() + hour).toISOString(),
  images: [{ id: "i1", url: "https://example.test/a.jpg" }],
  ...over,
});

describe("ListingCard final-chance tag", () => {
  it("shows on a live auction that has used both extensions", () => {
    render(<ListingCard listing={listing({ extensionCount: 2 })} />);
    expect(screen.getByText("Final chance to bid")).toBeTruthy();
  });

  it("does not show before the second extension, or when the count is missing", () => {
    for (const extensionCount of [0, 1, undefined]) {
      render(<ListingCard listing={listing({ extensionCount })} />);
      expect(screen.queryByText("Final chance to bid"), String(extensionCount)).toBeNull();
      cleanup();
    }
  });

  it("does not show on an auction that is not live", () => {
    for (const phase of ["upcoming", "ended"] as const) {
      render(<ListingCard listing={listing({ phase, extensionCount: 2 })} />);
      expect(screen.queryByText("Final chance to bid"), phase).toBeNull();
      cleanup();
    }
  });

  it("also shows on a listing with no photo", () => {
    render(<ListingCard listing={listing({ images: [], extensionCount: 2 })} />);
    expect(screen.getByText("No photo")).toBeTruthy();
    expect(screen.getByText("Final chance to bid")).toBeTruthy();
  });
});
