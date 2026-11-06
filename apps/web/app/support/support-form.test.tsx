// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ sendSupportAction: vi.fn() }));

import type { SupportStrike } from "@auction/shared";
import { SupportForm } from "./support-form";

afterEach(cleanup);

const strike = (over: Partial<SupportStrike> = {}): SupportStrike => ({ id: "S1", createdAt: "2026-11-01T10:00:00Z", reason: null, givenByAdmin: false, listingTitle: "Brass lamp", appealed: false, ...over });

describe("SupportForm", () => {
  it("starts with a plain question and offers no appeal to someone without strikes", () => {
    render(<SupportForm strikes={[]} startWithAppeal={false} email="a@b.co" />);
    expect((screen.getByLabelText(/A question or problem/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Appeal a strike/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText("Which strike?")).toBeNull();
    expect(screen.getByText(/We answer by email, to a@b.co/)).toBeTruthy();
  });

  it("opens on the appeal from the bid note's link and lists the strike with what it was for", () => {
    render(<SupportForm strikes={[strike(), strike({ id: "S2", givenByAdmin: true, reason: "Abusive messages" })]} startWithAppeal email="a@b.co" />);
    expect((screen.getByLabelText(/Appeal a strike/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Which strike?")).toBeTruthy();
    expect(screen.getByText(/did not pay for Brass lamp/)).toBeTruthy();
    expect(screen.getByText(/given by an admin \(Abusive messages\)/)).toBeTruthy();
  });

  it("does not offer a strike whose appeal is already waiting", () => {
    render(<SupportForm strikes={[strike({ appealed: true })]} startWithAppeal email="a@b.co" />);
    // Nothing left to appeal, so the form stays on a question even though the link asked for an appeal.
    expect((screen.getByLabelText(/A question or problem/) as HTMLInputElement).checked).toBe(true);
  });
});
