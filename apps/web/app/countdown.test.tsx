// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Countdown, formatRemaining, timeColor } from "./countdown";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("formatRemaining", () => {
  it("shows days, hours, minutes and seconds, dropping leading zero units", () => {
    expect(formatRemaining(((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000)).toBe("2d 3h 4m 5s");
    expect(formatRemaining((3 * 3600 + 4 * 60 + 5) * 1000)).toBe("3h 4m 5s");
    expect(formatRemaining((4 * 60 + 5) * 1000)).toBe("4m 5s");
    expect(formatRemaining(5000)).toBe("0m 5s");
  });

  it("says Ended at or after the end time", () => {
    expect(formatRemaining(0)).toBe("Ended");
    expect(formatRemaining(-1000)).toBe("Ended");
  });
});

describe("Countdown", () => {
  it("counts down every second and stops at Ended", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    render(<Countdown iso="2026-01-01T00:01:02Z" startIso="2026-01-01T00:00:00Z" />);
    expect(screen.getByText("1m 2s")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText("1m 0s")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(screen.getByText("Ended")).toBeTruthy();
  });
});

describe("timeColor", () => {
  it("is green above half the time, orange down to a tenth, then red", () => {
    expect(timeColor(51, 100)).toBe("text-time-ok");
    expect(timeColor(50, 100)).toBe("text-time-warn");
    expect(timeColor(11, 100)).toBe("text-time-warn");
    expect(timeColor(10, 100)).toBe("text-urgent");
    expect(timeColor(0, 100)).toBe("text-urgent");
  });
});

describe("Countdown on the server's clock", () => {
  it("follows the server's time when the viewer's clock is wrong", () => {
    vi.useFakeTimers();
    // The viewer's computer is an hour fast; the server says it is 12:00:00 and the auction ends at 12:05:00.
    vi.setSystemTime(new Date("2026-01-01T13:00:00Z"));
    render(<Countdown iso="2026-01-01T12:05:00Z" startIso="2026-01-01T11:00:00Z" serverNowIso="2026-01-01T12:00:00Z" />);
    expect(screen.getByText("5m 0s")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText("4m 57s")).toBeTruthy();
  });

  it("uses the viewer's clock when it is given no server time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    render(<Countdown iso="2026-01-01T12:05:00Z" startIso="2026-01-01T11:00:00Z" />);
    expect(screen.getByText("5m 0s")).toBeTruthy();
  });
});
