// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { activeFilterChips, addCategoryChips } from "./active-filters";
import { FilterChips } from "./filter-chips";

afterEach(cleanup);

const categories = [
  { slug: "art", name: "Art" },
  { slug: "toys", name: "Toys" },
];

describe("FilterChips", () => {
  it("shows each active filter as a chip that removes only that filter", () => {
    render(<FilterChips chips={activeFilterChips({ q: "rolex", category: "art", condition: "GOOD" }, categories)} />);
    expect(screen.getByRole("link", { name: "Remove filter: Art" }).getAttribute("href")).toBe("/search?q=rolex&condition=GOOD");
    expect(screen.getByRole("link", { name: "Remove filter: Good" }).getAttribute("href")).toBe("/search?q=rolex&category=art");
  });

  it("shows the categories that can be added as links that add them, under a hint", () => {
    const params = { q: "rolex", category: "art" };
    render(<FilterChips chips={activeFilterChips(params, categories)} addable={addCategoryChips(params, categories)} />);
    expect(screen.getByText("Add a category:")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add category: Toys" }).getAttribute("href")).toBe("/search?q=rolex&category=art%2Ctoys");
    expect(screen.queryByRole("link", { name: "Add category: Art" })).toBeNull();
  });

  it("renders nothing when no filter is active", () => {
    const { container } = render(<FilterChips chips={activeFilterChips({ q: "rolex" }, categories)} />);
    expect(container.innerHTML).toBe("");
  });
});
