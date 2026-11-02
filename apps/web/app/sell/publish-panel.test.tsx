// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { publishListingAction, deleteListingAction } = vi.hoisted(() => ({
  publishListingAction: vi.fn(),
  deleteListingAction: vi.fn(),
}));
vi.mock("./actions", () => ({ publishListingAction, deleteListingAction }));

import { PublishPanel } from "./publish-panel";

beforeEach(() => {
  publishListingAction.mockReset();
  publishListingAction.mockResolvedValue({});
  deleteListingAction.mockReset();
  deleteListingAction.mockResolvedValue({});
});
afterEach(cleanup);

const setup = (photoCount = 1) => render(<PublishPanel listingId="L1" photoCount={photoCount} durationDays={5} />);
const publishButton = () => screen.getByRole("button", { name: "Publish" }) as HTMLButtonElement;

describe("PublishPanel", () => {
  it("cannot publish without a photo, and says why", () => {
    setup(0);
    expect(publishButton().disabled).toBe(true);
    expect(screen.getByText("Add at least one photo to publish.")).toBeTruthy();
  });

  it("states what publishing does", () => {
    setup();
    expect(screen.getByText(/starts a 5-day auction/)).toBeTruthy();
  });

  it("publishes immediately by default", async () => {
    setup();
    fireEvent.click(publishButton());
    await waitFor(() => expect(publishListingAction).toHaveBeenCalledWith("L1", undefined));
  });

  it("needs a start time when scheduling, then sends it as an ISO time", async () => {
    setup();
    fireEvent.click(screen.getByLabelText("Schedule a start"));
    fireEvent.click(publishButton());
    expect(screen.getByText("Choose a start time")).toBeTruthy();
    expect(publishListingAction).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "2030-01-15T10:30" } });
    fireEvent.click(publishButton());
    await waitFor(() => expect(publishListingAction).toHaveBeenCalledWith("L1", new Date("2030-01-15T10:30").toISOString()));
  });

  it("shows the error when publishing fails", async () => {
    publishListingAction.mockResolvedValue({ error: "Start time cannot be in the past" });
    setup();
    fireEvent.click(publishButton());
    await waitFor(() => expect(screen.getByText("Start time cannot be in the past")).toBeTruthy());
  });

  it("deletes the draft only after confirming", async () => {
    const confirm = vi.spyOn(window, "confirm");
    setup();
    confirm.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete draft" }));
    expect(deleteListingAction).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete draft" }));
    await waitFor(() => expect(deleteListingAction).toHaveBeenCalledWith("L1"));
    confirm.mockRestore();
  });
});
