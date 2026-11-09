// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUnsavedChanges } from "./use-unsaved-changes";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Page({ active = true }: { active?: boolean }) {
  const ref = useRef<HTMLFormElement>(null);
  useUnsavedChanges(ref, active);
  return (
    <>
      <a href="/elsewhere">Away</a>
      <form ref={ref}>
        <input aria-label="Title" name="title" defaultValue="Old" />
      </form>
    </>
  );
}

describe("useUnsavedChanges", () => {
  it("lets a link through when nothing was edited", () => {
    const ask = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Page />);
    const notPrevented = fireEvent.click(screen.getByText("Away"));
    expect(ask).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });

  it("asks before following a link after an edit, and stays when the visitor says no", () => {
    const ask = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Page />);
    fireEvent.input(screen.getByLabelText("Title"), { target: { value: "New" } });
    expect(fireEvent.click(screen.getByText("Away"))).toBe(false);
    expect(ask).toHaveBeenCalledOnce();
  });

  it("follows the link when the visitor agrees, and does not ask when the edit was undone", () => {
    const ask = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Page />);
    const title = screen.getByLabelText("Title");
    fireEvent.input(title, { target: { value: "New" } });
    expect(fireEvent.click(screen.getByText("Away"))).toBe(true);
    fireEvent.input(title, { target: { value: "Old" } });
    ask.mockClear();
    fireEvent.click(screen.getByText("Away"));
    expect(ask).not.toHaveBeenCalled();
  });

  it("warns on closing the tab only while there are unsaved edits", () => {
    render(<Page />);
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    fireEvent.input(screen.getByLabelText("Title"), { target: { value: "New" } });
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it("does nothing while inactive", () => {
    const ask = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Page active={false} />);
    fireEvent.input(screen.getByLabelText("Title"), { target: { value: "New" } });
    expect(fireEvent.click(screen.getByText("Away"))).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });
});
