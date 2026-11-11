// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDismiss } from "./use-dismiss";

afterEach(cleanup);

function Menu({ open, onDismiss }: { open: boolean; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, onDismiss);
  return (
    <div>
      <div ref={ref}>
        <button>inside</button>
      </div>
      <button>outside</button>
    </div>
  );
}

describe("useDismiss", () => {
  it("dismisses on a pointer press outside, not inside", () => {
    const onDismiss = vi.fn();
    render(<Menu open onDismiss={onDismiss} />);
    fireEvent.mouseDown(screen.getByText("inside"));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses on Escape, and ignores other keys", () => {
    const onDismiss = vi.fn();
    render(<Menu open onDismiss={onDismiss} />);
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does nothing while closed", () => {
    const onDismiss = vi.fn();
    render(<Menu open={false} onDismiss={onDismiss} />);
    fireEvent.mouseDown(screen.getByText("outside"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("stops listening once closed or unmounted, and calls the newest callback", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = render(<Menu open onDismiss={first} />);
    rerender(<Menu open onDismiss={second} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    rerender(<Menu open={false} onDismiss={second} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(second).toHaveBeenCalledTimes(1);
    rerender(<Menu open onDismiss={second} />);
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(second).toHaveBeenCalledTimes(1);
  });
});
