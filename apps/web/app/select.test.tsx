// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Select } from "./select";
import { pick, valueOf } from "./select-test-helpers";

const options = [
  { value: "a", label: "Apple" },
  { value: "b", label: "Banana", disabled: true },
  { value: "c", label: "Cherry" },
  { value: "d", label: "Citrus" },
];

// jsdom has no scrolling; moving through an open list scrolls the active option into view.
const scroll = vi.fn();
beforeEach(() => {
  scroll.mockClear();
  Element.prototype.scrollIntoView = scroll;
});
afterEach(cleanup);

const activeLabel = (box: HTMLElement) => document.getElementById(box.getAttribute("aria-activedescendant") ?? "")?.textContent;

describe("Select", () => {
  it("shows the placeholder until something is chosen, then the choice, and sends it with the form", () => {
    render(
      <form>
        <Select name="fruit" aria-label="Fruit" options={options} required />
      </form>,
    );
    const box = screen.getByRole("combobox", { name: "Fruit" });
    expect(box.textContent).toBe("Choose…");
    expect((box.closest("form") as HTMLFormElement).checkValidity()).toBe(false); // required still holds
    pick(box, "Cherry");
    expect(box.textContent).toBe("Cherry");
    expect(new FormData(box.closest("form") as HTMLFormElement).get("fruit")).toBe("c");
    expect((box.closest("form") as HTMLFormElement).checkValidity()).toBe(true);
    expect(screen.queryByRole("listbox")).toBeNull(); // closed after the pick
  });

  it("works inside a label: choosing an option does not reopen the list", () => {
    render(
      <label>
        Fruit
        <Select aria-label="Fruit" options={options} />
      </label>,
    );
    pick(screen.getByRole("combobox"), "Apple");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("cannot pick a disabled option", () => {
    const onChange = vi.fn();
    render(<Select aria-label="Fruit" options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Banana" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("follows the keyboard: arrows skip disabled options, Enter picks, Escape closes, a letter jumps", () => {
    const onChange = vi.fn();
    render(<Select aria-label="Fruit" options={options} onChange={onChange} />);
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(box, { key: "ArrowDown" }); // from Apple past the disabled Banana
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("c");
    expect(valueOf(box)).toBe("c");

    fireEvent.keyDown(box, { key: "ArrowUp" });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(box, { key: "a" }); // typing opens and jumps to the first match
    expect(screen.getByRole("option", { name: "Apple" }).id).toBe(box.getAttribute("aria-activedescendant"));
  });

  it("follows a value given by the parent", () => {
    const { rerender } = render(<Select aria-label="Fruit" options={options} value="a" onChange={() => {}} />);
    expect(screen.getByRole("combobox").textContent).toBe("Apple");
    rerender(<Select aria-label="Fruit" options={options} value="d" onChange={() => {}} />);
    expect(screen.getByRole("combobox").textContent).toBe("Citrus");
  });

  it("Home and End jump to the first and last option that can be picked while the list is open", () => {
    render(<Select aria-label="Fruit" options={[{ value: "x", label: "Grape", disabled: true }, ...options, { value: "y", label: "Lime", disabled: true }]} />);
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "Home" }); // closed: nothing happens
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(box);
    fireEvent.keyDown(box, { key: "End" });
    expect(activeLabel(box)).toBe("Citrus");
    fireEvent.keyDown(box, { key: "Home" });
    expect(activeLabel(box)).toBe("Apple");
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("typing while the list is open jumps to the match, a second letter narrows it, and after a pause a letter moves on", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    render(<Select aria-label="Fruit" options={options} />);
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(activeLabel(box)).toBe("Apple");
    fireEvent.keyDown(box, { key: "c" });
    expect(activeLabel(box)).toBe("Cherry");
    fireEvent.keyDown(box, { key: "i" });
    expect(activeLabel(box)).toBe("Citrus");
    now.mockReturnValue(12_000);
    fireEvent.keyDown(box, { key: "c" }); // a new word: the next "c" after Citrus, around to Cherry
    expect(activeLabel(box)).toBe("Cherry");
    expect(screen.getByRole("listbox")).toBeTruthy();
    now.mockRestore();
  });
});
