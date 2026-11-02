// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Pagination, pageNumbers } from "./pagination";

afterEach(cleanup);

describe("pageNumbers", () => {
  it("shows every page when there are ten or fewer", () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(3, 4)).toEqual([1, 2, 3, 4]);
    expect(pageNumbers(10, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("starts at 1 for the first pages, then slides along with five pages before the current one", () => {
    expect(pageNumbers(1, 735)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(pageNumbers(6, 735)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(pageNumbers(7, 735)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(pageNumbers(300, 735)).toEqual([295, 296, 297, 298, 299, 300, 301, 302, 303, 304]);
  });

  it("stops at the last page and keeps ten numbers", () => {
    expect(pageNumbers(735, 735)).toEqual([726, 727, 728, 729, 730, 731, 732, 733, 734, 735]);
    expect(pageNumbers(731, 735)).toEqual([726, 727, 728, 729, 730, 731, 732, 733, 734, 735]);
  });
});

describe("Pagination", () => {
  const hrefFor = (n: number) => `/?page=${n}`;

  it("renders nothing for a single page", () => {
    const { container } = render(<Pagination page={1} pages={1} hrefFor={hrefFor} />);
    expect(container.innerHTML).toBe("");
  });

  it("links every page number except the current one, which is marked", () => {
    render(<Pagination page={3} pages={20} hrefFor={hrefFor} />);
    expect(screen.getByLabelText("Page 5").getAttribute("href")).toBe("/?page=5");
    expect(screen.getByLabelText("Page 1").getAttribute("href")).toBe("/?page=1");
    const current = screen.getByText("3");
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.tagName).toBe("SPAN");
    expect(screen.queryByLabelText("Page 3")).toBeNull();
  });

  it("has Previous and Next, except where there is nothing to go to", () => {
    const { rerender } = render(<Pagination page={1} pages={5} hrefFor={hrefFor} />);
    expect(screen.queryByText("Previous")).toBeNull();
    expect(screen.getByText("Next").getAttribute("href")).toBe("/?page=2");
    rerender(<Pagination page={5} pages={5} hrefFor={hrefFor} />);
    expect(screen.getByText("Previous").getAttribute("href")).toBe("/?page=4");
    expect(screen.queryByText("Next")).toBeNull();
  });
});
