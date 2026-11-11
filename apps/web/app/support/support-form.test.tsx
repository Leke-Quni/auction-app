// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("./actions", () => ({ sendSupportAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import type { SupportStrike } from "@auction/shared";
import { sendSupportAction } from "./actions";
import { SupportForm } from "./support-form";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const strike = (over: Partial<SupportStrike> = {}): SupportStrike => ({ id: "S1", createdAt: "2026-11-01T10:00:00Z", reason: null, givenByAdmin: false, listingTitle: "Brass lamp", appealed: false, ...over });

describe("SupportForm", () => {
  it("starts with a plain question and offers no appeal to someone without strikes", () => {
    render(<SupportForm strikes={[]} startWithAppeal={false} waiting={false} email="a@b.co" />);
    expect((screen.getByLabelText(/A question or problem/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Appeal a strike/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText("Which strike?")).toBeNull();
    expect(screen.getByText(/We answer by email, to a@b.co/)).toBeTruthy();
  });

  it("opens on the appeal from the bid note's link and lists the strike with what it was for", () => {
    render(<SupportForm strikes={[strike(), strike({ id: "S2", givenByAdmin: true, reason: "Abusive messages" })]} startWithAppeal waiting={false} email="a@b.co" />);
    expect((screen.getByLabelText(/Appeal a strike/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Which strike?")).toBeTruthy();
    expect(screen.getByRole("option", { name: /did not pay for Brass lamp/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /given by an admin \(Abusive messages\)/ })).toBeTruthy();
  });

  it("shows the whole selected strike under the list, including a long admin reason that the list cuts off", () => {
    const reason = "Reported question (abusive): " + "a long insult ".repeat(15) + "THE END";
    render(<SupportForm strikes={[strike(), strike({ id: "S2", givenByAdmin: true, reason, listingTitle: "Old clock" })]} startWithAppeal waiting={false} email="a@b.co" />);
    const details = () => screen.getByTestId("strike-details");
    expect(details().textContent).toContain('You did not pay for "Brass lamp" within 48 hours of winning it.');
    expect(details().textContent).toContain("Given on 2026-11-01");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "S2" } });
    expect(details().textContent).toContain('Given by an admin about "Old clock".');
    expect(details().textContent).toContain(reason);
    expect(details().textContent).toContain("THE END");
  });

  it("does not offer a strike whose appeal is already waiting", () => {
    render(<SupportForm strikes={[strike({ appealed: true })]} startWithAppeal waiting={false} email="a@b.co" />);
    // Nothing left to appeal, so the form stays on a question even though the link asked for an appeal.
    expect((screen.getByLabelText(/A question or problem/) as HTMLInputElement).checked).toBe(true);
  });

  it("turns the appeal off, and says why, when every strike already has an appeal waiting", () => {
    render(<SupportForm strikes={[strike({ appealed: true })]} startWithAppeal waiting={false} email="a@b.co" />);
    const appeal = screen.getByLabelText(/Appeal a strike/) as HTMLInputElement;
    expect(appeal.disabled).toBe(true);
    expect(appeal.checked).toBe(false);
    expect(screen.getByText(/your appeal was sent/)).toBeTruthy();
    expect(screen.queryByText("Which strike?")).toBeNull();
    expect(screen.getByText("Your message")).toBeTruthy();
  });

  it("stays on the appeal, with the strike and the typed words, when the answer is an error", async () => {
    vi.mocked(sendSupportAction).mockResolvedValue({ error: "You already appealed this strike. We will answer by email." });
    render(<SupportForm strikes={[strike()]} startWithAppeal waiting={false} email="a@b.co" />);
    fireEvent.change(screen.getByLabelText(/Why should it be cleared/), { target: { value: "I was away" } });
    fireEvent.submit(screen.getByRole("button", { name: "Send" }).closest("form")!);
    expect(await screen.findByText(/You already appealed this strike/)).toBeTruthy();
    expect((screen.getByLabelText(/Appeal a strike/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/A question or problem/) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("Which strike?")).toBeTruthy();
    expect((screen.getByLabelText(/Why should it be cleared/) as HTMLTextAreaElement).value).toBe("I was away");
    expect(vi.mocked(sendSupportAction).mock.calls[0][1].get("kind")).toBe("STRIKE_APPEAL");
    expect(vi.mocked(sendSupportAction).mock.calls[0][1].get("strikeId")).toBe("S1");
  });

  it("clears the message after it was sent, and asks the page for the strikes again", async () => {
    vi.mocked(sendSupportAction).mockResolvedValue({ ok: "Your message was sent. We will answer by email." });
    render(<SupportForm strikes={[]} startWithAppeal={false} waiting={false} email="a@b.co" />);
    fireEvent.change(screen.getByLabelText(/Your message/), { target: { value: "Hello" } });
    fireEvent.submit(screen.getByRole("button", { name: "Send" }).closest("form")!);
    expect(await screen.findByText(/Your message was sent/)).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText(/Your message/) as HTMLTextAreaElement).value).toBe(""));
    expect(refresh).toHaveBeenCalled();
  });

  it("says a message is waiting for an answer and turns Send off, until it is answered", () => {
    const { rerender } = render(<SupportForm strikes={[]} startWithAppeal={false} waiting email="a@b.co" />);
    expect(screen.getByText(/You have a message waiting for an answer/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<SupportForm strikes={[]} startWithAppeal={false} waiting={false} email="a@b.co" />);
    expect(screen.queryByText(/You have a message waiting for an answer/)).toBeNull();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("turns Send off after a message was sent, so it is not sent twice", async () => {
    vi.mocked(sendSupportAction).mockResolvedValue({ ok: "Your message was sent. We will answer by email." });
    render(<SupportForm strikes={[]} startWithAppeal={false} waiting={false} email="a@b.co" />);
    fireEvent.change(screen.getByLabelText(/Your message/), { target: { value: "Hello" } });
    fireEvent.submit(screen.getByRole("button", { name: "Send" }).closest("form")!);
    expect(await screen.findByText(/Your message was sent/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
