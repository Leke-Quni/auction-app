// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Tip } from "./tip";

afterEach(cleanup);

describe("Tip", () => {
  it("puts its message in a bubble next to the control, shown by hover or focus after a short wait, in the page's own colours (no title)", () => {
    render(
      <Tip label="Sell an item" align="right">
        <a href="/sell/new">Sell</a>
      </Tip>,
    );
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toBe("Sell an item");
    expect(tip.className).toContain("group-hover/tip:opacity-100");
    expect(tip.className).toContain("group-focus-within/tip:opacity-100");
    expect(tip.className).toContain("group-hover/tip:delay-[400ms]");
    expect(tip.className).toContain("bg-surface");
    expect(tip.className).not.toContain("bg-ink");
    expect(tip.className).toContain("rounded-lg");
    expect(tip.className).toContain("right-0");
    expect(screen.getByRole("link", { name: "Sell" }).getAttribute("title")).toBeNull();
  });

  it("has an arrow, hidden from screen readers, pointing up at the middle of the control and shown with the bubble", () => {
    const { container } = render(
      <Tip label="Sell an item" align="right">
        <a href="/sell/new">Sell</a>
      </Tip>,
    );
    const arrow = container.querySelector('span[aria-hidden="true"]')!;
    expect(arrow.className).toContain("left-1/2");
    expect(arrow.className).toContain("rotate-45");
    expect(arrow.className).toContain("group-hover/tip:opacity-100");
    expect(arrow.className).toContain("group-hover/tip:delay-[400ms]");
  });

  it("leaves the bubble and its arrow out while suppressed, such as when the control's own menu is open", () => {
    const { container } = render(
      <Tip label="Account menu" suppress>
        <button>Account</button>
      </Tip>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(container.querySelector('span[aria-hidden="true"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Account" })).toBeTruthy();
  });
});
