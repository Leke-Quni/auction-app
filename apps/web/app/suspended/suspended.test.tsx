// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { endSessionAction } = vi.hoisted(() => ({ endSessionAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/app/actions", () => ({ endSessionAction }));

import Suspended from "./page";

afterEach(cleanup);

describe("the suspended-account page", () => {
  it("says the account is suspended and signs the browser out once", async () => {
    render(<Suspended />);
    expect(screen.getByRole("heading", { name: "This account has been suspended" })).toBeTruthy();
    await waitFor(() => expect(endSessionAction).toHaveBeenCalledTimes(1));
  });
});
