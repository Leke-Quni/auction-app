// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../support/actions", () => ({ sendSuspendedSupportAction: vi.fn() }));

import { SuspendedSupportForm } from "./suspended-support-form";

afterEach(cleanup);

describe("SuspendedSupportForm", () => {
  it("asks for the account's email and a message, since a suspended person cannot sign in", () => {
    render(<SuspendedSupportForm />);
    expect((screen.getByLabelText(/Email of your account/) as HTMLInputElement).type).toBe("email");
    expect(screen.getByLabelText(/Your message/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });
});
