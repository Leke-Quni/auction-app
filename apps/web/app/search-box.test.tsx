// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/search", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("next/form", () => ({ default: (props: React.ComponentProps<"form">) => <form {...props} /> }));

import { SearchBox } from "./search-box";

afterEach(cleanup);

const categories = [{ slug: "art", name: "Art" }];
const hiddenFields = (container: HTMLElement) =>
  Object.fromEntries([...container.querySelectorAll<HTMLInputElement>('input[type="hidden"]')].map((i) => [i.name, i.value]));

describe("SearchBox", () => {
  it("shows the current text and each active filter as a chip that removes it, and keeps the filters for a new search", () => {
    nav.pathname = "/search";
    nav.search = "q=rolex&category=art&condition=GOOD&page=2";
    const { container } = render(<SearchBox categories={categories} />);

    expect((screen.getByLabelText("Search auctions") as HTMLInputElement).value).toBe("rolex");
    expect(screen.getByRole("link", { name: "Remove filter: Art" }).getAttribute("href")).toBe("/search?q=rolex&condition=GOOD");
    expect(screen.getByRole("link", { name: "Remove filter: Good" }).getAttribute("href")).toBe("/search?q=rolex&category=art");
    expect(hiddenFields(container)).toEqual({ category: "art", condition: "GOOD" });
  });

  it("is a plain search box away from the search page, whatever is in the address", () => {
    nav.pathname = "/";
    nav.search = "category=art";
    const { container } = render(<SearchBox categories={categories} />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(hiddenFields(container)).toEqual({});
    expect((screen.getByLabelText("Search auctions") as HTMLInputElement).value).toBe("");
  });

  it("is left out of the sign-in, sign-up and password pages, and nowhere else", () => {
    nav.search = "";
    for (const path of ["/sign-in", "/sign-in/code", "/sign-up", "/forgot-password", "/reset-password"]) {
      nav.pathname = path;
      render(<SearchBox categories={categories} />);
      expect(screen.queryByLabelText("Search auctions"), path).toBeNull();
      cleanup();
    }
    for (const path of ["/", "/search", "/listings/abc", "/account/settings", "/sign-insecure"]) {
      nav.pathname = path;
      render(<SearchBox categories={categories} />);
      expect(screen.queryByLabelText("Search auctions"), path).not.toBeNull();
      cleanup();
    }
  });
});
