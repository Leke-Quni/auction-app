// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserMenu } from "./user-menu";

afterEach(cleanup);

const setup = () => {
  const signOutAction = vi.fn(async () => {});
  render(<UserMenu username="ana_k" signOutAction={signOutAction} />);
  return { signOutAction, button: screen.getByRole("button", { name: "Account menu" }) };
};

describe("UserMenu", () => {
  it("is closed until the icon is clicked", () => {
    const { button } = setup();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByText("Sign out")).toBeNull();
  });

  it("opens with my listings, my orders, settings, support, sign out, and the username", () => {
    const { button } = setup();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByText("ana_k")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "My listings" }).getAttribute("href")).toBe("/sell");
    expect(screen.getByRole("menuitem", { name: "My orders" }).getAttribute("href")).toBe("/orders");
    expect(screen.getByRole("menuitem", { name: "Settings" }).getAttribute("href")).toBe("/account/settings");
    expect(screen.getByRole("menuitem", { name: "Support" }).getAttribute("href")).toBe("/support");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
  });

  it("leaves selling, the watchlist and account info to the header and the settings page", () => {
    const { button } = setup();
    fireEvent.click(button);
    for (const name of ["Sell an item", "Watchlist", "Account info"]) expect(screen.queryByRole("menuitem", { name })).toBeNull();
  });

  it("sets the two groups of links and sign out apart with lines", () => {
    const { button } = setup();
    fireEvent.click(button);
    const groups = [...screen.getByRole("menu").children].filter((el) => el.querySelector('[role="menuitem"]'));
    expect(groups).toHaveLength(3);
    expect(groups.slice(1).every((el) => el.className.includes("border-t"))).toBe(true);
  });

  it("says what the icon button is when hovered", () => {
    const { button } = setup();
    expect(screen.getByRole("tooltip").textContent).toBe("Your account");
    expect(button.getAttribute("aria-label")).toBe("Account menu");
  });

  it("puts an icon beside every item, hidden from screen readers", () => {
    const { button } = setup();
    fireEvent.click(button);
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(5);
    for (const item of items) expect(item.querySelector('svg[aria-hidden="true"]'), item.textContent ?? "").not.toBeNull();
  });

  it("closes on a second click, Escape, a click outside, or choosing a link", () => {
    const { button } = setup();
    const isOpen = () => screen.queryByRole("menu") !== null;

    fireEvent.click(button);
    fireEvent.click(button);
    expect(isOpen()).toBe(false);

    fireEvent.click(button);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(isOpen()).toBe(false);

    fireEvent.click(button);
    fireEvent.mouseDown(document.body);
    expect(isOpen()).toBe(false);

    fireEvent.click(button);
    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(isOpen()).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    expect(isOpen()).toBe(false);
  });

  it("puts Sign out in a form so it runs as a server action", () => {
    const { button } = setup();
    fireEvent.click(button);
    const signOut = screen.getByRole("menuitem", { name: "Sign out" });
    expect(signOut.closest("form")).not.toBeNull();
  });

  it("ends the session, then loads the whole page again", async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, assign } });
    try {
      const { signOutAction, button } = setup();
      fireEvent.click(button);
      await act(async () => {
        fireEvent.submit(screen.getByRole("menuitem", { name: "Sign out" }).closest("form")!);
      });
      expect(signOutAction).toHaveBeenCalledTimes(1);
      expect(assign).toHaveBeenCalledWith("/");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });
});
