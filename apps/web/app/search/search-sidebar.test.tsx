// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/form", () => ({ default: ({ children, ...rest }: { children: ReactNode }) => <form {...rest}>{children}</form> }));

import { SearchSidebar } from "./search-sidebar";

afterEach(cleanup);

const categories = [{ id: "c1", slug: "art", name: "Art" }];
const sidebar = (params: Record<string, string>, sort = "newest") => (
  <SearchSidebar params={params as never} categories={categories} sort={sort as never} maxEuros={1000} />
);
const box = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

describe("SearchSidebar", () => {
  it("renders with no filters set without a duplicate-key warning", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(sidebar({}));
    expect(errors.mock.calls.filter((call) => String(call[0]).includes("same key"))).toEqual([]);
    errors.mockRestore();
  });

  it("ticks the conditions that are in the search", () => {
    render(sidebar({ condition: "NEW,GOOD" }));
    expect([box("New").checked, box("Good").checked, box("Fair").checked]).toEqual([true, true, false]);
  });

  it("unticks a condition when it is removed from the search, as with the chips under the search box", () => {
    const { rerender } = render(sidebar({ condition: "NEW,GOOD" }));
    rerender(sidebar({ condition: "GOOD" }));
    expect([box("New").checked, box("Good").checked]).toEqual([false, true]);
    rerender(sidebar({}));
    expect(box("Good").checked).toBe(false);
  });

  it("also unticks 'ending within 24 hours' when its chip is removed", () => {
    const { rerender } = render(sidebar({ endingSoon: "true" }));
    expect(box("Ending within 24 hours").checked).toBe(true);
    rerender(sidebar({}));
    expect(box("Ending within 24 hours").checked).toBe(false);
  });

  it("keeps a tick the visitor made but has not applied while the search stays the same", () => {
    const { rerender } = render(sidebar({ condition: "NEW" }));
    fireEvent.click(box("Fair"));
    rerender(sidebar({ condition: "NEW" }));
    expect(box("Fair").checked).toBe(true);
  });
});
