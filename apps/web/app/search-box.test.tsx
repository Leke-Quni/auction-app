// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/search", search: "", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push }),
}));
vi.mock("next/form", () => ({ default: (props: React.ComponentProps<"form">) => <form {...props} /> }));

import { SearchBox } from "./search-box";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  nav.push.mockReset();
});

const hiddenFields = (container: HTMLElement) =>
  Object.fromEntries([...container.querySelectorAll<HTMLInputElement>('input[type="hidden"]')].map((i) => [i.name, i.value]));

describe("SearchBox", () => {
  it("shows the current text and keeps the filters for a new search, without listing them as chips", () => {
    nav.pathname = "/search";
    nav.search = "q=rolex&category=art&condition=GOOD&page=2";
    const { container } = render(<SearchBox />);

    expect((screen.getByLabelText("Search auctions") as HTMLInputElement).value).toBe("rolex");
    expect(screen.queryByRole("list", { name: "Active filters" })).toBeNull();
    expect(hiddenFields(container)).toEqual({ category: "art", condition: "GOOD" });
  });

  it("is a plain search box away from the search page, whatever is in the address", () => {
    nav.pathname = "/";
    nav.search = "category=art";
    const { container } = render(<SearchBox />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(hiddenFields(container)).toEqual({});
    expect((screen.getByLabelText("Search auctions") as HTMLInputElement).value).toBe("");
  });

  it("stays where it is when searched with nothing typed and no filter, and searches otherwise", () => {
    nav.pathname = "/listings/abc";
    nav.search = "";
    render(<SearchBox />);
    const box = screen.getByLabelText("Search auctions") as HTMLInputElement;
    const submit = () => fireEvent.submit(box.closest("form")!); // false when the submit was cancelled

    expect(submit()).toBe(false);
    fireEvent.change(box, { target: { value: "   " } });
    expect(submit()).toBe(false); // spaces are nothing too
    fireEvent.change(box, { target: { value: "rolex" } });
    expect(submit()).toBe(true); // left to the form, which goes to /search
  });

  it("keeps searching when the text is empty but a filter is chosen", () => {
    nav.pathname = "/search";
    nav.search = "category=art";
    render(<SearchBox />);
    expect(fireEvent.submit((screen.getByLabelText("Search auctions") as HTMLInputElement).closest("form")!)).toBe(true);
  });

  it("offers the earlier searches when the empty box is focused, and not once something is typed", () => {
    window.localStorage.setItem("recent-searches", JSON.stringify(["old watch", "blue vase"]));
    nav.pathname = "/listings/abc";
    nav.search = "";
    render(<SearchBox />);
    const box = screen.getByLabelText("Search auctions") as HTMLInputElement;
    expect(screen.queryByText("Recent searches")).toBeNull();

    fireEvent.focus(box);
    expect(screen.getByText("Recent searches")).toBeTruthy();
    expect(screen.getByRole("link", { name: "old watch" }).getAttribute("href")).toBe("/search?q=old%20watch");
    expect(screen.getByRole("link", { name: "blue vase" })).toBeTruthy();

    fireEvent.change(box, { target: { value: "ro" } });
    expect(screen.queryByText("Recent searches")).toBeNull();
    fireEvent.change(box, { target: { value: "" } });
    expect(screen.getByText("Recent searches")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Recent searches")).toBeNull();
  });

  it("shows nothing when there are no earlier searches", () => {
    nav.pathname = "/";
    nav.search = "";
    render(<SearchBox />);
    fireEvent.focus(screen.getByLabelText("Search auctions"));
    expect(screen.queryByText("Recent searches")).toBeNull();
  });

  it("forgets one search with its ×, and all of them with Clear", () => {
    window.localStorage.setItem("recent-searches", JSON.stringify(["old watch", "blue vase"]));
    nav.pathname = "/";
    nav.search = "";
    render(<SearchBox />);
    fireEvent.focus(screen.getByLabelText("Search auctions"));
    fireEvent.click(screen.getByRole("button", { name: "Forget old watch" }));
    expect(screen.queryByRole("link", { name: "old watch" })).toBeNull();
    expect(JSON.parse(window.localStorage.getItem("recent-searches")!)).toEqual(["blue vase"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText("Recent searches")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem("recent-searches")!)).toEqual([]);
  });

  it("remembers a search when it is made, but not an empty one", () => {
    nav.pathname = "/";
    nav.search = "";
    render(<SearchBox />);
    const box = screen.getByLabelText("Search auctions") as HTMLInputElement;
    fireEvent.submit(box.closest("form")!);
    expect(window.localStorage.getItem("recent-searches")).toBeNull();
    fireEvent.change(box, { target: { value: " rolex " } });
    fireEvent.submit(box.closest("form")!);
    expect(JSON.parse(window.localStorage.getItem("recent-searches")!)).toEqual(["rolex"]);
  });

  describe("suggestions", () => {
    const answer = (suggestions: string[]) => vi.fn().mockImplementation(async () => new Response(JSON.stringify({ suggestions })));
    const typeText = async (value: string) => {
      const box = screen.getByLabelText("Search auctions") as HTMLInputElement;
      fireEvent.focus(box);
      fireEvent.change(box, { target: { value } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      return box;
    };

    beforeEach(() => {
      vi.useFakeTimers();
      nav.pathname = "/";
      nav.search = "";
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("asks a moment after typing stops and lists the titles as links to that search", async () => {
      const fetchMock = answer(["Old watch", "Watch strap"]);
      vi.stubGlobal("fetch", fetchMock);
      render(<SearchBox />);
      const box = screen.getByLabelText("Search auctions") as HTMLInputElement;
      fireEvent.focus(box);
      fireEvent.change(box, { target: { value: "w" } });
      fireEvent.change(box, { target: { value: "wa" } });
      fireEvent.change(box, { target: { value: "wat" } });
      expect(fetchMock).not.toHaveBeenCalled(); // still typing
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe("/api/suggest?q=wat");
      expect(screen.getByText("Suggestions")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Old watch" }).getAttribute("href")).toBe("/search?q=Old%20watch");
    });

    it("shows each suggestion's cover photo (or a placeholder) and its price under the title", async () => {
      const items = [
        { id: "l1", title: "Old watch", coverUrl: "https://img/w.jpg", priceCents: 2500, hasBids: true },
        { id: "l2", title: "Watch strap", coverUrl: null, priceCents: 900, hasBids: false },
      ];
      vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ suggestions: ["Old watch", "Watch strap"], items }))));
      render(<SearchBox />);
      await typeText("wat");
      const first = screen.getByRole("link", { name: /Old watch/ });
      expect(first.querySelector("img")?.getAttribute("src")).toBe("https://img/w.jpg");
      expect(first.textContent).toContain("€25.00");
      expect(first.textContent).toContain("current bid");
      const second = screen.getByRole("link", { name: /Watch strap/ });
      expect(second.querySelector("img")).toBeNull();
      expect(second.textContent).toContain("No photo");
      expect(second.textContent).toContain("€9.00");
      expect(second.textContent).toContain("starting");
    });

    it("does not ask for one letter, and shows nothing when there are no suggestions or the request fails", async () => {
      const fetchMock = answer([]);
      vi.stubGlobal("fetch", fetchMock);
      render(<SearchBox />);
      await typeText("w");
      expect(fetchMock).not.toHaveBeenCalled();
      await typeText("wat");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Suggestions")).toBeNull();
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      await typeText("watc");
      expect(screen.queryByText("Suggestions")).toBeNull();
    });

    it("closes on Escape, remembers a chosen suggestion, and gives way to the recent searches when emptied", async () => {
      window.localStorage.setItem("recent-searches", JSON.stringify(["blue vase"]));
      vi.stubGlobal("fetch", answer(["Old watch"]));
      render(<SearchBox />);
      const box = await typeText("wat");
      expect(screen.getByText("Suggestions")).toBeTruthy();
      fireEvent.change(box, { target: { value: "" } });
      expect(screen.queryByText("Suggestions")).toBeNull();
      expect(screen.getByText("Recent searches")).toBeTruthy();

      await typeText("wat");
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByText("Suggestions")).toBeNull();

      await typeText("wat");
      fireEvent.click(screen.getByRole("link", { name: "Old watch" }));
      expect(screen.queryByText("Suggestions")).toBeNull();
      expect(JSON.parse(window.localStorage.getItem("recent-searches")!)[0]).toBe("Old watch");
    });
  });

  describe("keyboard", () => {
    const key = (box: HTMLElement, name: string) => fireEvent.keyDown(box, { key: name });
    const activeId = (box: HTMLElement) => box.getAttribute("aria-activedescendant");

    beforeEach(() => {
      nav.pathname = "/";
      nav.search = "";
    });

    it("moves through the recent searches with the arrow keys, wraps round, and searches the highlighted one on Enter", () => {
      window.localStorage.setItem("recent-searches", JSON.stringify(["old watch", "blue vase", "rolex"]));
      render(<SearchBox />);
      const box = screen.getByLabelText("Search auctions") as HTMLInputElement;
      fireEvent.focus(box);
      expect(activeId(box)).toBeNull();
      key(box, "ArrowDown");
      expect(box.getAttribute("aria-activedescendant")).toBe("search-choice-0");
      key(box, "ArrowDown");
      key(box, "ArrowDown");
      expect(activeId(box)).toBe("search-choice-2");
      key(box, "ArrowDown");
      expect(activeId(box)).toBe("search-choice-0"); // wraps
      key(box, "ArrowUp");
      expect(activeId(box)).toBe("search-choice-2");
      key(box, "ArrowUp");
      expect(document.getElementById("search-choice-1")!.textContent).toContain("blue vase");

      expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(false); // the form is not submitted as well
      expect(nav.push).toHaveBeenCalledWith("/search?q=blue%20vase");
      expect(screen.queryByText("Recent searches")).toBeNull();
      expect(JSON.parse(window.localStorage.getItem("recent-searches")!)[0]).toBe("blue vase");
    });

    it("starts from the last item on ArrowUp, and Enter with nothing highlighted just searches the typed text", () => {
      window.localStorage.setItem("recent-searches", JSON.stringify(["old watch", "blue vase"]));
      render(<SearchBox />);
      const box = screen.getByLabelText("Search auctions") as HTMLInputElement;
      fireEvent.focus(box);
      key(box, "ArrowUp");
      expect(activeId(box)).toBe("search-choice-1");
      fireEvent.change(box, { target: { value: "rolex" } });
      expect(activeId(box)).toBeNull(); // the list changed, so the highlight starts over
      expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(true); // left to the form
      expect(nav.push).not.toHaveBeenCalled();
    });

    it("moves through suggestions the same way, and opens the recent searches on ArrowDown when closed", async () => {
      vi.useFakeTimers();
      try {
        window.localStorage.setItem("recent-searches", JSON.stringify(["blue vase"]));
        vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ suggestions: ["Old watch", "Watch strap"] }))));
        render(<SearchBox />);
        const box = screen.getByLabelText("Search auctions") as HTMLInputElement;
        key(box, "ArrowDown"); // closed: opens the list first
        expect(screen.getByText("Recent searches")).toBeTruthy();
        fireEvent.focus(box);
        fireEvent.change(box, { target: { value: "wat" } });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(250);
        });
        key(box, "ArrowDown");
        key(box, "ArrowDown");
        fireEvent.keyDown(box, { key: "Enter" });
        expect(nav.push).toHaveBeenCalledWith("/search?q=Watch%20strap");
      } finally {
        vi.useRealTimers();
        vi.unstubAllGlobals();
      }
    });
  });

  it("is left out of the sign-in, sign-up and password pages, and nowhere else", () => {
    nav.search = "";
    for (const path of ["/sign-in", "/sign-in/code", "/sign-up", "/forgot-password", "/reset-password"]) {
      nav.pathname = path;
      render(<SearchBox />);
      expect(screen.queryByLabelText("Search auctions"), path).toBeNull();
      cleanup();
    }
    for (const path of ["/", "/search", "/listings/abc", "/account/settings", "/sign-insecure"]) {
      nav.pathname = path;
      render(<SearchBox />);
      expect(screen.queryByLabelText("Search auctions"), path).not.toBeNull();
      cleanup();
    }
  });
});
