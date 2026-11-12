// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { SortSelect } from "./sort-select";

afterEach(() => {
  cleanup();
  nav.push.mockClear();
});

describe("SortSelect", () => {
  it("applies the sort at once to the search in the address bar, and goes back to page 1", () => {
    nav.search = "q=watch&category=art&page=3";
    render(
      <label>
        Sort by
        <SortSelect defaultValue="newest" />
      </label>,
    );
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "priceAsc" } });
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith("/search?q=watch&category=art&sort=priceAsc");
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
        <label>
          Sort by
          <SortSelect defaultValue="newest" />
        </label>
      </form>,
    );
    fireEvent.change(screen.getByLabelText("Condition"), { target: { value: "GOOD" } });
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "priceAsc" } });
    expect(submitted).toEqual([{ q: "watch", condition: "GOOD", sort: "priceAsc" }]);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("starts on the sort it is given", () => {
    nav.search = "";
    render(<SortSelect defaultValue="endingSoon" />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("endingSoon");
  });
});
