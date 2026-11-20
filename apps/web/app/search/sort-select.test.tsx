// @vitest-environment jsdom
import { SEARCH_SORT_LABELS } from "@auction/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { pick, valueOf } from "../select-test-helpers";
import { PriceSortSelect, SortProvider, SortSelect } from "./sort-select";

afterEach(() => {
  cleanup();
  nav.push.mockClear();
});

const sortBy = () => screen.getByRole("combobox", { name: "Sort by" });
const sortByPrice = () => screen.getByRole("combobox", { name: "Sort by price" });
const both = (defaultValue: "newest" | "endingSoon" | "priceAsc" = "newest") => (
  <SortProvider defaultValue={defaultValue}>
    <SortSelect />
    <PriceSortSelect />
  </SortProvider>
);
const optionsOf = (box: HTMLElement) => {
  fireEvent.click(box);
  const listed = screen.getAllByRole("option").map((o) => o.textContent);
  fireEvent.keyDown(document, { key: "Escape" });
  return listed;
};

describe("sort drop-downs", () => {
  it("applies the sort at once to the search in the address bar, and goes back to page 1", () => {
    nav.search = "q=watch&category=art&page=3";
    render(both());
    pick(sortBy(), SEARCH_SORT_LABELS.mostBids);
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith("/search?q=watch&category=art&sort=mostBids");
  });

  it("inside a form, submits the whole form, so ticked but not yet applied filters are applied with the sort", () => {
    nav.search = "q=watch";
    const submitted: Record<string, string>[] = [];
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitted.push(Object.fromEntries(new FormData(e.currentTarget) as unknown as Iterable<[string, string]>));
        }}
      >
        <input type="hidden" name="q" value="watch" />
        <select name="condition" aria-label="Condition" defaultValue="">
          <option value="">Any</option>
          <option value="GOOD">Good</option>
        </select>
        {both()}
      </form>,
    );
    fireEvent.change(screen.getByLabelText("Condition"), { target: { value: "GOOD" } });
    pick(sortBy(), SEARCH_SORT_LABELS.mostBids);
    expect(submitted).toEqual([{ q: "watch", condition: "GOOD", sort: "mostBids" }]);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("keeps the price sorts out of Sort by and gives them a drop-down of their own", () => {
    nav.search = "";
    render(both());
    const others = optionsOf(sortBy());
    expect(others).toHaveLength(6);
    expect(others).not.toContain(SEARCH_SORT_LABELS.priceAsc);
    expect(others).not.toContain(SEARCH_SORT_LABELS.priceDesc);
    expect(optionsOf(sortByPrice())).toEqual([SEARCH_SORT_LABELS.priceAsc, SEARCH_SORT_LABELS.priceDesc]);
  });

  it("the price drop-down sends a price sort with the form, and the two drop-downs share the one sort", () => {
    nav.search = "";
    const submitted: Record<string, string>[] = [];
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitted.push(Object.fromEntries(new FormData(e.currentTarget) as unknown as Iterable<[string, string]>));
        }}
      >
        {both()}
      </form>,
    );
    expect(sortBy().textContent).toBe(SEARCH_SORT_LABELS.newest);
    expect(sortByPrice().textContent).toBe("Not sorted by price");
    pick(sortByPrice(), SEARCH_SORT_LABELS.priceDesc);
    expect(submitted).toEqual([{ sort: "priceDesc" }]);
    expect(sortByPrice().textContent).toBe(SEARCH_SORT_LABELS.priceDesc);
    expect(sortBy().textContent).toBe("Sorted by price");
    pick(sortBy(), SEARCH_SORT_LABELS.endingSoon);
    expect(submitted[1]).toEqual({ sort: "endingSoon" });
    expect(sortByPrice().textContent).toBe("Not sorted by price");
  });

  it("outside a form, the price drop-down sorts the search in the address bar", () => {
    nav.search = "q=watch&page=2";
    render(both());
    pick(sortByPrice(), SEARCH_SORT_LABELS.priceAsc);
    expect(nav.push).toHaveBeenCalledWith("/search?q=watch&sort=priceAsc");
  });

  it("starts on the sort it is given", () => {
    nav.search = "";
    render(both("endingSoon"));
    expect(valueOf(sortBy())).toBe("endingSoon");
    cleanup();
    render(both("priceAsc"));
    expect(sortByPrice().textContent).toBe(SEARCH_SORT_LABELS.priceAsc);
  });
});
