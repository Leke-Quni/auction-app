// @vitest-environment jsdom
import type { QuestionItem } from "@auction/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  askQuestionAction: vi.fn(),
  answerQuestionAction: vi.fn(),
  deleteQuestionAction: vi.fn(),
  editQuestionAction: vi.fn(),
  editAnswerAction: vi.fn(),
  deleteAnswerAction: vi.fn(),
  voteAction: vi.fn(),
  reportAction: vi.fn(),
}));
vi.mock("./question-actions", () => actions);

import { Questions } from "./questions";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const question = (over: Partial<QuestionItem> = {}): QuestionItem => ({
  id: "q1",
  createdAt: minutesAgo(1),
  asker: { id: "anna", username: "anna" },
  body: "Is it genuine?",
  editedAt: null,
  answer: null,
  votes: { question: { likes: 0, dislikes: 0, mine: null }, answer: { likes: 0, dislikes: 0, mine: null } },
  ...over,
});

const show = (props: Partial<Parameters<typeof Questions>[0]> = {}) =>
  render(<Questions listingId="L1" items={[]} total={0} viewerId="anna" isSeller={false} open {...props} />);

beforeEach(() => Object.values(actions).forEach((fn) => fn.mockReset().mockResolvedValue({ ok: true })));
afterEach(cleanup);

describe("votes", () => {
  const answered = (votes: Partial<QuestionItem["votes"]> = {}) =>
    question({
      answer: { body: "Yes it is.", answeredAt: minutesAgo(1), editedAt: null },
      votes: { question: { likes: 3, dislikes: 1, mine: null }, answer: { likes: 2, dislikes: 0, mine: "LIKE" }, ...votes },
    });

  it("shows the like and dislike counts on the question and on the answer, and marks your own vote", () => {
    show({ items: [answered()], total: 1, viewerId: "ben" });
    expect(screen.getByRole("button", { name: "Like (3)" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Dislike (1)" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Like (2)" })[0].getAttribute("aria-pressed")).toBe("true");
  });

  it("sends a like for the question, a dislike for the answer, and takes back the vote that is pressed again", async () => {
    show({ items: [answered()], total: 1, viewerId: "ben" });
    fireEvent.click(screen.getByRole("button", { name: "Like (3)" }));
    await waitFor(() => expect(actions.voteAction).toHaveBeenCalledWith("L1", "q1", "QUESTION", "LIKE"));
    fireEvent.click(screen.getByRole("button", { name: "Dislike (0)" }));
    await waitFor(() => expect(actions.voteAction).toHaveBeenCalledWith("L1", "q1", "ANSWER", "DISLIKE"));
    fireEvent.click(screen.getByRole("button", { name: "Like (2)" }));
    await waitFor(() => expect(actions.voteAction).toHaveBeenCalledWith("L1", "q1", "ANSWER", null));
  });

  it("does not let the asker vote on their question, the seller vote at all, nor a signed-out visitor vote", () => {
    show({ items: [answered()], total: 1, viewerId: "anna" });
    expect((screen.getByRole("button", { name: "Like (3)" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Like (2)" }) as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    show({ items: [answered()], total: 1, viewerId: "sam", isSeller: true });
    expect((screen.getByRole("button", { name: "Like (3)" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Like (2)" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    show({ items: [answered()], total: 1, viewerId: undefined });
    expect((screen.getByRole("button", { name: "Like (3)" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the reason when a vote is refused", async () => {
    actions.voteAction.mockResolvedValue({ error: "You cannot vote on your own post." });
    show({ items: [answered()], total: 1, viewerId: "ben" });
    fireEvent.click(screen.getByRole("button", { name: "Like (3)" }));
    expect((await screen.findByRole("alert")).textContent).toContain("own post");
  });
});

describe("Questions", () => {
  it("asks signed-out visitors to sign in, and the seller to just answer", () => {
    show({ viewerId: undefined });
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/sign-in");
    cleanup();
    show({ isSeller: true, viewerId: "sam" });
    expect(screen.queryByLabelText("Ask the seller a question")).toBeNull();
    expect(screen.getByText(/Your answers are public/)).toBeTruthy();
  });

  it("closes questions once the auction has ended", () => {
    show({ open: false });
    expect(screen.getByText(/Questions are closed/)).toBeTruthy();
    expect(screen.queryByLabelText("Ask the seller a question")).toBeNull();
  });

  it("sends a question, trimming nothing itself, and closes the box", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Ask a question" }));
    const box = screen.getByLabelText("Ask the seller a question") as HTMLTextAreaElement;
    expect((screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: "Does it work?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(actions.askQuestionAction).toHaveBeenCalledWith("L1", "Does it work?"));
    await waitFor(() => expect(screen.queryByLabelText("Ask the seller a question")).toBeNull());
  });

  it("closes the question box on Cancel without sending, and the Ask a question button comes back", () => {
    show();
    expect(screen.queryByLabelText("Ask the seller a question")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ask a question" }));
    fireEvent.change(screen.getByLabelText("Ask the seller a question"), { target: { value: "Never mind" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Ask the seller a question")).toBeNull();
    expect(actions.askQuestionAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Ask a question" })).toBeTruthy();
  });

  it("shows the refusal and keeps what was typed", async () => {
    actions.askQuestionAction.mockResolvedValue({ error: "Questions are closed once the auction has ended." });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Ask a question" }));
    const box = screen.getByLabelText("Ask the seller a question") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect((await screen.findByRole("alert")).textContent).toContain("closed");
    expect(box.value).toBe("Hello");
  });

  it("lists questions with their answers, a deleted one as a gap, and a count that leaves deleted ones out", () => {
    show({
      total: 2,
      items: [
        question({ id: "q2", body: "Second?", answer: { body: "Yes.", answeredAt: minutesAgo(0), editedAt: null } }),
        question({ id: "q3", asker: null, body: null, answer: { body: "Still here.", answeredAt: minutesAgo(2), editedAt: null } }),
        question({ id: "q1" }),
      ],
    });
    expect(screen.getByText("Second?")).toBeTruthy();
    expect(screen.getByText("Yes.")).toBeTruthy();
    expect(screen.getByText("<deleted user>")).toBeTruthy();
    expect(screen.getByText("This message can't be displayed because the user was deleted.")).toBeTruthy();
    expect(screen.getByText("Still here.")).toBeTruthy();
    expect(screen.queryByText("This question was deleted.")).toBeNull();
    expect(screen.getByText("(2)")).toBeTruthy();
  });

  it("lets the asker change and delete their own questions while the auction is open, not other people's", async () => {
    show({ items: [question({ id: "mine" }), question({ id: "old", createdAt: minutesAgo(600), body: "Old one" }), question({ id: "other", asker: { id: "ben", username: "ben" }, body: "Ben's" })] });
    const menus = screen.getAllByRole("button", { name: "Question actions" });
    expect(menus).toHaveLength(3); // their own two, however old, and a Report menu on Ben's
    fireEvent.click(menus[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete question" }));
    expect(actions.deleteQuestionAction).not.toHaveBeenCalled(); // asks first
    expect(screen.getByText(/Delete this question\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(actions.deleteQuestionAction).toHaveBeenCalledWith("L1", "mine"));
  });

  it("puts the cursor in the box as soon as it opens, for answering, asking and editing", () => {
    show({ isSeller: true, viewerId: "sam", items: [question({ id: "open" })] });
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(document.activeElement).toBe(screen.getByLabelText(/Your answer/));
    cleanup();
    show();
    fireEvent.click(screen.getByRole("button", { name: "Ask a question" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Ask the seller a question"));
    cleanup();
    show({ items: [question({ id: "mine", body: "Original?" })] });
    fireEvent.click(screen.getByRole("button", { name: "Question actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit question" }));
    const box = screen.getByLabelText("Edit your question") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(box);
    expect(box.selectionStart).toBe("Original?".length);
  });

  it("closes the answer box on Cancel without sending, and the Answer button comes back", () => {
    show({ isSeller: true, viewerId: "sam", items: [question({ id: "open" })] });
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    fireEvent.change(screen.getByLabelText(/Your answer/), { target: { value: "Half an answ" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText(/Your answer/)).toBeNull();
    expect(actions.answerQuestionAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Answer" })).toBeTruthy();
  });

  it("shows no change or delete menus once the auction has ended", () => {
    show({ open: false, items: [question({ id: "mine", answer: { body: "A.", answeredAt: minutesAgo(1), editedAt: null } })] });
    expect(screen.queryByRole("button", { name: "Question actions" })).toBeNull();
    cleanup();
    show({ open: false, isSeller: true, viewerId: "sam", items: [question({ answer: { body: "A.", answeredAt: minutesAgo(1), editedAt: null } })] });
    expect(screen.queryByRole("button", { name: "Answer actions" })).toBeNull();
  });

  it("edits a question in place, starting from its text, and Cancel leaves it alone", async () => {
    show({ items: [question({ id: "mine", body: "Original?" })] });
    fireEvent.click(screen.getByRole("button", { name: "Question actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit question" }));
    const box = screen.getByLabelText("Edit your question") as HTMLTextAreaElement;
    expect(box.value).toBe("Original?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(actions.editQuestionAction).not.toHaveBeenCalled();
    expect(screen.getByText("Original?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Question actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit question" }));
    fireEvent.change(screen.getByLabelText("Edit your question"), { target: { value: "Changed?" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.editQuestionAction).toHaveBeenCalledWith("L1", "mine", "Changed?"));
    await waitFor(() => expect(screen.queryByLabelText("Edit your question")).toBeNull());
  });

  it("edits the seller's answer, and writes (edited) next to a changed question or answer", async () => {
    show({
      isSeller: true,
      viewerId: "sam",
      items: [question({ id: "q", editedAt: minutesAgo(1), answer: { body: "Old answer", answeredAt: minutesAgo(5), editedAt: minutesAgo(1) } }), question({ id: "plain", body: "Untouched" })],
    });
    expect(screen.getAllByText(/\(edited\)/)).toHaveLength(2); // the question and the answer of the first, not the second
    fireEvent.click(screen.getByRole("button", { name: "Answer actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit answer" }));
    expect((screen.getByLabelText("Edit your answer") as HTMLTextAreaElement).value).toBe("Old answer");
    fireEvent.change(screen.getByLabelText("Edit your answer"), { target: { value: "New answer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.editAnswerAction).toHaveBeenCalledWith("L1", "q", "New answer"));
  });

  it("cancels deleting an answer, and leaves no answer box open after an answer is posted and later taken back", async () => {
    const posted = question({ id: "open", body: "Unanswered?" });
    const { rerender } = show({ isSeller: true, viewerId: "sam", items: [posted] });
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    fireEvent.change(screen.getByLabelText(/Your answer/), { target: { value: "Yes." } });
    fireEvent.click(screen.getByRole("button", { name: "Post answer" }));
    await waitFor(() => expect(actions.answerQuestionAction).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByLabelText(/Your answer/)).toBeNull());

    const answered = question({ id: "open", body: "Unanswered?", answer: { body: "Yes.", answeredAt: minutesAgo(0), editedAt: null } });
    const props = { listingId: "L1", total: 1, viewerId: "sam", isSeller: true, open: true };
    rerender(<Questions {...props} items={[answered]} />);
    fireEvent.click(screen.getByRole("button", { name: "Answer actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(actions.deleteAnswerAction).not.toHaveBeenCalled();

    rerender(<Questions {...props} items={[posted]} />); // the answer is gone
    expect(screen.queryByLabelText(/Your answer/)).toBeNull();
    expect(screen.getByRole("button", { name: "Answer" })).toBeTruthy();
  });

  describe("reporting", () => {
    const answered = (over: Partial<QuestionItem> = {}) => question({ id: "q", asker: { id: "ben", username: "ben" }, answer: { body: "An answer.", answeredAt: minutesAgo(1), editedAt: null }, ...over });
    const pickReport = (menuName: string) => {
      fireEvent.click(screen.getByRole("button", { name: menuName }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Report" }));
    };

    it("lets a signed-in reader report someone else's question or answer, after choosing a reason, and thanks them", async () => {
      show({ viewerId: "anna", items: [answered()] });
      pickReport("Question actions");
      expect(actions.reportAction).not.toHaveBeenCalled(); // asks why first
      fireEvent.change(screen.getByLabelText("Why are you reporting this?"), { target: { value: "ABUSE" } });
      fireEvent.click(screen.getByRole("button", { name: "Send report" }));
      await waitFor(() => expect(actions.reportAction).toHaveBeenCalledWith("L1", "q", "QUESTION", "ABUSE"), { timeout: 3000 });
      expect((await screen.findByRole("status", {}, { timeout: 3000 })).textContent).toContain("Thanks");

      pickReport("Answer actions");
      fireEvent.click(screen.getByRole("button", { name: "Send report" }));
      await waitFor(() => expect(actions.reportAction).toHaveBeenCalledWith("L1", "q", "ANSWER", "SPAM"), { timeout: 3000 }); // the first reason is the default
    });

    it("offers nothing to report on your own question, on the seller's own answer, or when signed out, and Cancel sends nothing", () => {
      show({ viewerId: "ben", open: false, items: [answered()] });
      expect(screen.queryByRole("button", { name: "Question actions" })).toBeNull(); // own question
      expect(screen.getByRole("button", { name: "Answer actions" })).toBeTruthy(); // the asker may report the answer
      cleanup();
      show({ viewerId: "sam", isSeller: true, open: false, items: [answered()] });
      expect(screen.getByRole("button", { name: "Question actions" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Answer actions" })).toBeNull(); // own answer
      cleanup();
      show({ viewerId: undefined, items: [answered()] });
      expect(screen.queryByRole("button", { name: "Question actions" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Answer actions" })).toBeNull();
      cleanup();
      show({ viewerId: "anna", items: [answered()] });
      pickReport("Question actions");
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(actions.reportAction).not.toHaveBeenCalled();
    });

    it("shows why a report was refused, and no report option on a question whose asker is gone", async () => {
      actions.reportAction.mockResolvedValue({ error: "You already reported this." });
      show({ viewerId: "anna", items: [answered()] });
      pickReport("Question actions");
      fireEvent.click(screen.getByRole("button", { name: "Send report" }));
      expect((await screen.findByRole("alert")).textContent).toContain("already reported");
      cleanup();
      show({ viewerId: "anna", items: [answered({ asker: null, body: null })] });
      expect(screen.queryByRole("button", { name: "Question actions" })).toBeNull();
    });
  });

  it("closes the menu on Escape", () => {
    show({ items: [question({ id: "mine" })] });
    fireEvent.click(screen.getByRole("button", { name: "Question actions" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does nothing when the delete is cancelled", () => {
    show({ items: [question({ id: "mine" })] });
    fireEvent.click(screen.getByRole("button", { name: "Question actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete question" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(actions.deleteQuestionAction).not.toHaveBeenCalled();
    expect(screen.queryByText(/Delete this question\?/)).toBeNull();
    expect(screen.getByRole("button", { name: "Question actions" })).toBeTruthy();
  });

  it("lets the seller answer and take back an answer, but not delete a question", async () => {
    show({
      isSeller: true,
      viewerId: "sam",
      items: [
        question({ id: "open", body: "Unanswered?" }),
        question({ id: "done", body: "Answered?", createdAt: minutesAgo(30), answer: { body: "Fresh answer", answeredAt: minutesAgo(1), editedAt: null } }),
        question({ id: "stale", body: "Stale?", createdAt: minutesAgo(60), answer: { body: "Old answer", answeredAt: minutesAgo(20), editedAt: null } }),
      ],
    });
    // The seller can only report the questions, not change or delete them.
    fireEvent.click(screen.getAllByRole("button", { name: "Question actions" })[0]);
    expect(screen.queryByRole("menuitem", { name: "Delete question" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Report" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    const menus = screen.getAllByRole("button", { name: "Answer actions" });
    expect(menus).toHaveLength(2); // one on each answer, however old
    fireEvent.click(menus[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete answer" }));
    expect(actions.deleteAnswerAction).not.toHaveBeenCalled(); // asks first
    expect(screen.getByText(/Delete this answer\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(actions.deleteAnswerAction).toHaveBeenCalledWith("L1", "done"));

    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    fireEvent.change(screen.getByLabelText(/Your answer/), { target: { value: "Yes it is." } });
    fireEvent.click(screen.getByRole("button", { name: "Post answer" }));
    await waitFor(() => expect(actions.answerQuestionAction).toHaveBeenCalledWith("L1", "open", "Yes it is."));
  });
});
