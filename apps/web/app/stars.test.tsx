// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Stars } from "./stars";

afterEach(cleanup);

describe("Stars", () => {
  it("says the rating in words and fills the nearest whole number of stars, leaving the rest empty", () => {
    render(<Stars value={4.3} />);
    expect(screen.getByRole("img", { name: "4.3 out of 5 stars" }).textContent).toBe("★★★★☆");
  });

  it("shows all empty, all filled, and never more than five", () => {
    render(<Stars value={0} />);
    expect(screen.getByRole("img", { name: "0 out of 5 stars" }).textContent).toBe("☆☆☆☆☆");
    cleanup();
    render(<Stars value={5} />);
    expect(screen.getByRole("img", { name: "5 out of 5 stars" }).textContent).toBe("★★★★★");
  });
});
