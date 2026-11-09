// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignedOutNotice } from "./signed-out-notice";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("SignedOutNotice", () => {
  it("says nothing on an ordinary page", () => {
    render(<SignedOutNotice />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a banner after signing out, removes the marker from the address and hides itself after a few seconds", () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/?signedOut=1&page=2");
    render(<SignedOutNotice />);
    expect(screen.getByRole("status").textContent).toBe("You have been signed out.");
    expect(window.location.search).toBe("?page=2");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
