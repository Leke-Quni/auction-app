// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THEME_SCRIPT, ThemeSwitch } from "./theme-switch";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});
afterEach(cleanup);

const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed");

describe("ThemeSwitch", () => {
  it("starts on System, with no theme set", () => {
    render(<ThemeSwitch />);
    expect([pressed("System"), pressed("Light"), pressed("Dark")]).toEqual(["true", "false", "false"]);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("applies and remembers Light and Dark, and System clears both", () => {
    render(<ThemeSwitch />);
    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(pressed("Dark")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "System" }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("theme")).toBeNull();
  });

  it("has a single button for narrow screens that steps System, Light, Dark and back", () => {
    render(<ThemeSwitch />);
    const stepper = () => screen.getByRole("button", { name: /^Colour theme: / });
    expect(stepper().getAttribute("aria-label")).toBe("Colour theme: System. Switch to Light");
    fireEvent.click(stepper());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    fireEvent.click(stepper());
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    fireEvent.click(stepper());
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(stepper().getAttribute("aria-label")).toBe("Colour theme: System. Switch to Light");
  });

  it("shows the saved choice when the page loads", () => {
    localStorage.setItem("theme", "dark");
    render(<ThemeSwitch />);
    expect(pressed("Dark")).toBe("true");
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
