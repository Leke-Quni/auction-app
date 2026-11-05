// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setWatchingAction } = vi.hoisted(() => ({ setWatchingAction: vi.fn() }));
vi.mock("./watchlist-actions", () => ({ setWatchingAction }));

import { WatchButton } from "./watch-button";

beforeEach(() => setWatchingAction.mockReset());
afterEach(cleanup);

describe("WatchButton", () => {
  it("starts watching with one click and shows the new count", async () => {
    setWatchingAction.mockResolvedValue({ watching: true, watcherCount: 4 });
    render(<WatchButton listingId="L1" watching={false} watcherCount={3} />);
    expect(screen.getByText("3 watchers")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Watch" }));
    await waitFor(() => expect(setWatchingAction).toHaveBeenCalledWith("L1", true));
    expect(await screen.findByRole("button", { name: "Watching" })).toBeTruthy();
    expect(screen.getByText("4 watchers")).toBeTruthy();
  });

  it("stops watching when already watching", async () => {
    setWatchingAction.mockResolvedValue({ watching: false, watcherCount: 0 });
    render(<WatchButton listingId="L1" watching watcherCount={1} />);
    expect(screen.getByText("1 watcher")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Watching" }));
    await waitFor(() => expect(setWatchingAction).toHaveBeenCalledWith("L1", false));
    expect(await screen.findByRole("button", { name: "Watch" })).toBeTruthy();
  });

  it("shows why it could not and keeps the old state", async () => {
    setWatchingAction.mockResolvedValue({ error: "This auction has ended." });
    render(<WatchButton listingId="L1" watching={false} watcherCount={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Watch" }));
    expect(await screen.findByText("This auction has ended.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Watch" })).toBeTruthy();
  });
});
