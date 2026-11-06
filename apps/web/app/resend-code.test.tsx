// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resendCodeAction } = vi.hoisted(() => ({ resendCodeAction: vi.fn() }));
vi.mock("./actions", () => ({ resendCodeAction }));

import { ResendCode } from "./resend-code";

beforeEach(() => {
  vi.useFakeTimers();
  resendCodeAction.mockReset();
  resendCodeAction.mockResolvedValue({ ok: "If you signed in a moment ago, a new code is on its way." });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ResendCode", () => {
  it("waits 30 seconds before the first new code, as the server does", () => {
    render(<ResendCode email="a@b.co" />);
    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Send a new code (30s)");
  });

  it("asks for a new code once the wait is over, says so, and waits again", async () => {
    render(<ResendCode email="a@b.co" />);
    // One second at a time: each tick re-renders and sets the next timer.
    for (let i = 0; i < 30; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(button);
    });
    expect(resendCodeAction).toHaveBeenCalledWith("a@b.co");
    expect(screen.getByText(/new code is on its way/)).toBeTruthy();
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
