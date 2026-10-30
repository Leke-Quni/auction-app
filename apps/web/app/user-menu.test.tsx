// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("opens with account info, settings, sign out, and the username", () => {
    const { button } = setup();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByText("ana_k")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Account info" }).getAttribute("href")).toBe("/account");
    expect(screen.getByRole("menuitem", { name: "Settings" }).getAttribute("href")).toBe("/account/settings");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
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
});
