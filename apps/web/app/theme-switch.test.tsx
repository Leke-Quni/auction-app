// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THEME_SCRIPT, ThemeSwitch } from "./theme-switch";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});
afterEach(cleanup);

const open = () => fireEvent.click(screen.getByRole("button", { name: /^Colour theme: / }));
const checked = (name: string) => screen.getByRole("menuitemradio", { name }).getAttribute("aria-checked");
const pick = (name: string) => {
  open();
  fireEvent.click(screen.getByRole("menuitemradio", { name }));
};

describe("ThemeSwitch", () => {
  it("is one icon button, closed until pressed, that names the current theme", () => {
    render(<ThemeSwitch />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Colour theme: System" }).getAttribute("aria-expanded")).toBe("false");
    open();
    expect(screen.getByRole("button", { name: "Colour theme: System" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("starts on System, with no theme set", () => {
    render(<ThemeSwitch />);
    open();
    expect([checked("System"), checked("Light"), checked("Dark")]).toEqual(["true", "false", "false"]);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("applies and remembers Light and Dark, closes after a pick, and System clears both", () => {
    render(<ThemeSwitch />);
    pick("Light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Colour theme: Light" })).toBeTruthy();
    pick("Dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    open();
    expect(checked("Dark")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "System" }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("theme")).toBeNull();
  });

  it("closes on Escape and on a click outside", () => {
    render(<ThemeSwitch />);
    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    open();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows the saved choice when the page loads", () => {
    localStorage.setItem("theme", "dark");
    render(<ThemeSwitch />);
    expect(screen.getByRole("button", { name: "Colour theme: Dark" })).toBeTruthy();
    open();
    expect(checked("Dark")).toBe("true");
  });

  it("the pre-paint script sets a saved theme and ignores anything else", () => {
    localStorage.setItem("theme", "light");
    new Function(THEME_SCRIPT)();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("theme", "<script>");
    new Function(THEME_SCRIPT)();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
