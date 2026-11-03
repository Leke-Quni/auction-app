import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, authedApiFetch, revalidatePath } = vi.hoisted(() => ({ auth: vi.fn(), authedApiFetch: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/api", () => ({ authedApiFetch }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { answerQuestionAction, askQuestionAction, deleteAnswerAction, deleteQuestionAction, editAnswerAction, editQuestionAction, reportAction, voteAction } from "./question-actions";

const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ user: { id: "u1" } });
  authedApiFetch.mockReset();
  revalidatePath.mockReset();
});

describe("question actions", () => {
  it("do nothing without a signed-in user", async () => {
    auth.mockResolvedValue(null);
    expect(await askQuestionAction("L1", "Hi")).toEqual({ error: "Sign in first." });
    expect(authedApiFetch).not.toHaveBeenCalled();
  });

  it("send the right request for each action and refresh the listing page", async () => {
    authedApiFetch.mockResolvedValue(reply(201));
    expect(await askQuestionAction("L1", "Is it new?")).toEqual({ ok: true });
    expect(authedApiFetch).toHaveBeenLastCalledWith("/listings/L1/questions", { method: "POST", body: JSON.stringify({ body: "Is it new?" }) });
    await answerQuestionAction("L1", "q1", "Yes");
    expect(authedApiFetch).toHaveBeenLastCalledWith("/questions/q1/answer", { method: "POST", body: JSON.stringify({ body: "Yes" }) });
    await deleteQuestionAction("L1", "q1");
    expect(authedApiFetch).toHaveBeenLastCalledWith("/questions/q1", { method: "DELETE" });
    await deleteAnswerAction("L1", "q1");
    expect(authedApiFetch).toHaveBeenLastCalledWith("/questions/q1/answer", { method: "DELETE" });
    await editQuestionAction("L1", "q1", "Better?");
    expect(authedApiFetch).toHaveBeenLastCalledWith("/questions/q1", { method: "PATCH", body: JSON.stringify({ body: "Better?" }) });
    await editAnswerAction("L1", "q1", "Better.");
    expect(authedApiFetch).toHaveBeenLastCalledWith("/questions/q1/answer", { method: "PATCH", body: JSON.stringify({ body: "Better." }) });
    await reportAction("L1", "q1", "ANSWER", "SPAM");
    expect(authedApiFetch).toHaveBeenLastCalledWith("/questions/q1/report", { method: "POST", body: JSON.stringify({ target: "ANSWER", reason: "SPAM" }) });
    await voteAction("L1", "q1", "ANSWER", "DISLIKE");
    expect(authedApiFetch).toHaveBeenLastCalledWith("/questions/q1/vote", { method: "PUT", body: JSON.stringify({ target: "ANSWER", value: "DISLIKE" }) });
    await voteAction("L1", "q1", "QUESTION", null);
    expect(authedApiFetch).toHaveBeenLastCalledWith("/questions/q1/vote", { method: "PUT", body: JSON.stringify({ target: "QUESTION", value: null }) });
    expect(revalidatePath).toHaveBeenCalledWith("/listings/L1");
  });

  it("explains a refused report and a rate limit", async () => {
    authedApiFetch.mockResolvedValue(reply(409, { code: "ALREADY_REPORTED" }));
    expect(await reportAction("L1", "q1", "QUESTION", "SPAM")).toEqual({ error: "You already reported this." });
    authedApiFetch.mockResolvedValue(reply(429, { code: "RATE_LIMITED" }));
    expect(await askQuestionAction("L1", "Hi")).toEqual({ error: "You are doing that too fast. Wait a moment and try again." });
  });

  it("explains a refused vote", async () => {
    authedApiFetch.mockResolvedValue(reply(403, { code: "OWN_POST" }));
    expect(await voteAction("L1", "q1", "QUESTION", "LIKE")).toEqual({ error: "You cannot vote on your own post." });
  });

  it("say why in words when the API refuses, and refresh so the page shows the truth", async () => {
    authedApiFetch.mockResolvedValue(reply(409, { code: "NOT_OPEN" }));
    expect(await deleteQuestionAction("L1", "q1")).toEqual({ error: "Questions are closed once the auction has ended." });
    expect(revalidatePath).toHaveBeenCalledWith("/listings/L1");
    authedApiFetch.mockResolvedValue(reply(403, { code: "OWN_LISTING" }));
    expect((await askQuestionAction("L1", "Hi")).error).toBe("You cannot ask a question on your own listing.");
    authedApiFetch.mockResolvedValue(reply(409, { code: "SOMETHING_NEW" }));
    expect((await askQuestionAction("L1", "Hi")).error).toBe("That could not be done.");
  });

  it("handle an expired session, bad text, server errors and no connection", async () => {
    authedApiFetch.mockResolvedValueOnce(reply(401));
    expect((await askQuestionAction("L1", "Hi")).error).toContain("expired");
    authedApiFetch.mockResolvedValueOnce(reply(400));
    expect((await askQuestionAction("L1", "Hi")).error).toContain("Check what you wrote");
    authedApiFetch.mockResolvedValueOnce(reply(503));
    expect((await askQuestionAction("L1", "Hi")).error).toContain("Something went wrong");
    authedApiFetch.mockRejectedValueOnce(new Error("down"));
    expect((await askQuestionAction("L1", "Hi")).error).toContain("Could not reach");
  });
});
