// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Select } from "./select";
import { pick, valueOf } from "./select-test-helpers";

const options = [
  { value: "a", label: "Apple" },
  { value: "b", label: "Banana", disabled: true },
  { value: "c", label: "Cherry" },
  { value: "d", label: "Citrus" },
];

afterEach(cleanup);

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
});
