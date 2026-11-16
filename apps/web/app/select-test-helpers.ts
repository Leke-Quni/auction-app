import { fireEvent, screen, within } from "@testing-library/react";

// Opens a custom Select and picks one of its options by the text shown.
export function pick(box: HTMLElement, option: string | RegExp) {
  fireEvent.click(box);
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

// The value a Select would send with its form: the hidden native select inside it.
export const valueOf = (box: HTMLElement) => (box.parentElement!.querySelector("select") as HTMLSelectElement).value;
