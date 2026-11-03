import { z } from "zod";

// Public questions on a listing: any signed-in user asks, the seller answers, everyone reads both.
export const QUESTION_MAX_LENGTH = 1000;
export const ANSWER_MAX_LENGTH = 2000;

const text = (max: number, empty: string) =>
  z
    .string({ required_error: empty, invalid_type_error: empty })
    .trim()
    .min(1, empty)
    .max(max, `Keep it under ${max} characters`);

export const questionSchema = z.object({ body: text(QUESTION_MAX_LENGTH, "Write your question") });
export const answerSchema = z.object({ body: text(ANSWER_MAX_LENGTH, "Write your answer") });

export type QuestionInput = z.infer<typeof questionSchema>;
export type AnswerInput = z.infer<typeof answerSchema>;

// Likes and dislikes on a question or on its answer. One vote per person and target, and nobody votes on their own words.
export const VOTE_TARGETS = ["QUESTION", "ANSWER"] as const;
export type VoteTarget = (typeof VOTE_TARGETS)[number];
export const VOTE_VALUES = ["LIKE", "DISLIKE"] as const;
export type VoteValue = (typeof VOTE_VALUES)[number];

// `value: null` takes the vote back.
export const voteSchema = z.object({ target: z.enum(VOTE_TARGETS), value: z.enum(VOTE_VALUES).nullable() });
export type VoteInput = z.infer<typeof voteSchema>;

export interface VoteSummary {
  likes: number;
  dislikes: number;
  // The viewer's own vote; null when signed out or not voted.
  mine: VoteValue | null;
}

// A question as the listing page shows it. A deleted one keeps its place but not its words.
export interface QuestionItem {
  id: string;
  createdAt: string;
  // Null when the asker's account was deleted; the body is then null too and the answer stays.
  asker: { id: string; username: string } | null;
  body: string | null;
  // Set when the asker changed the question; the page shows "(edited)".
  editedAt: string | null;
  answer: { body: string; answeredAt: string; editedAt: string | null } | null;
  votes: { question: VoteSummary; answer: VoteSummary };
}

export const QUESTION_REFUSALS = ["NOT_FOUND", "OWN_LISTING", "NOT_OPEN", "NOT_SELLER", "NOT_ALLOWED", "ALREADY_ANSWERED", "OWN_POST", "SELLER_VOTE"] as const;
export type QuestionRefusal = (typeof QUESTION_REFUSALS)[number];

export const QUESTION_REFUSAL_MESSAGES: Record<QuestionRefusal, string> = {
  NOT_FOUND: "That question no longer exists.",
  OWN_LISTING: "You cannot ask a question on your own listing.",
  NOT_OPEN: "Questions are closed once the auction has ended.",
  NOT_SELLER: "Only the seller can answer.",
  NOT_ALLOWED: "You cannot do that.",
  ALREADY_ANSWERED: "This question already has an answer.",
  OWN_POST: "You cannot vote on your own post.",
  SELLER_VOTE: "The seller cannot vote on questions or answers.",
};
