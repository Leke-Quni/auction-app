"use server";

import { QUESTION_REFUSAL_MESSAGES, QUESTION_REFUSALS, type QuestionRefusal, type VoteTarget, type VoteValue } from "@auction/shared";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";

export interface QuestionActionResult {
  ok?: boolean;
  error?: string;
}

const isRefusal = (code: unknown): code is QuestionRefusal => (QUESTION_REFUSALS as readonly string[]).includes(code as string);

async function send(listingId: string, path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<QuestionActionResult> {
  if (!(await auth())) return { error: "Sign in first." };
  let res: Response;
  try {
    res = await authedApiFetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch {
    return { error: "Could not reach the server. Try again." };
  }
  if (res.ok) {
    revalidatePath(`/listings/${listingId}`);
    return { ok: true };
  }
  const reply = await res.json().catch(() => null);
  const code: unknown = reply?.code;
  if (res.status === 401) return { error: "Your session has expired. Sign in again." };
  if (res.status >= 500) return { error: "Something went wrong. Try again." };
  if (res.status === 400) return { error: "Check what you wrote and try again." };
  revalidatePath(`/listings/${listingId}`);
  return { error: isRefusal(code) ? QUESTION_REFUSAL_MESSAGES[code] : "That could not be done." };
}

export async function askQuestionAction(listingId: string, body: string) {
  return send(listingId, `/listings/${listingId}/questions`, "POST", { body });
}

export async function answerQuestionAction(listingId: string, questionId: string, body: string) {
  return send(listingId, `/questions/${encodeURIComponent(questionId)}/answer`, "POST", { body });
}

export async function editQuestionAction(listingId: string, questionId: string, body: string) {
  return send(listingId, `/questions/${encodeURIComponent(questionId)}`, "PATCH", { body });
}

export async function editAnswerAction(listingId: string, questionId: string, body: string) {
  return send(listingId, `/questions/${encodeURIComponent(questionId)}/answer`, "PATCH", { body });
}

export async function deleteQuestionAction(listingId: string, questionId: string) {
  return send(listingId, `/questions/${encodeURIComponent(questionId)}`, "DELETE");
}

export async function deleteAnswerAction(listingId: string, questionId: string) {
  return send(listingId, `/questions/${encodeURIComponent(questionId)}/answer`, "DELETE");
}

export async function voteAction(listingId: string, questionId: string, target: VoteTarget, value: VoteValue | null) {
  return send(listingId, `/questions/${encodeURIComponent(questionId)}/vote`, "PUT", { target, value });
}
