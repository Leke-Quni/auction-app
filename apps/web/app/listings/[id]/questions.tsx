"use client";

import { ANSWER_MAX_LENGTH, POLICY_LINKS, QUESTION_MAX_LENGTH, REPORT_REASON_LABELS, REPORT_REASONS, type QuestionItem, type ReportReason, type VoteSummary, type VoteTarget, type VoteValue } from "@auction/shared";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { LocalTime } from "@/app/local-time";
import { useDismiss } from "@/app/use-dismiss";
import { answerQuestionAction, askQuestionAction, deleteAnswerAction, deleteQuestionAction, editAnswerAction, editQuestionAction, reportAction, voteAction, type QuestionActionResult } from "./question-actions";

function Thumb({ down }: { down?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={down ? "M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" : "M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"} />
    </svg>
  );
}

const note = "border border-line bg-surface p-2 text-muted";
const buttonBase = "cursor-pointer rounded px-2 py-0.5 text-xs font-bold disabled:cursor-default disabled:opacity-60";
const primaryButton = `${buttonBase} bg-brand text-on-brand hover:bg-brand-dark`;
const plainButton = `${buttonBase} border border-line bg-surface hover:bg-head`;
const dangerButton = `${buttonBase} border border-danger-line bg-danger-soft text-danger hover:bg-danger-hover`;

function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const run = (action: () => Promise<QuestionActionResult>, onDone?: () => void) => {
    setError("");
    start(async () => {
      const result = await action();
      if (result.ok) onDone?.();
      else setError(result.error ?? "That could not be done.");
    });
  };
  return { pending, error, run };
}

function TextForm({ label, max, submit, onSubmit, onCancel, initial = "" }: { label: string; max: number; submit: string; onSubmit: (body: string) => Promise<QuestionActionResult>; onCancel?: () => void; initial?: string }) {
  const [text, setText] = useState(initial);
  // The form only appears when someone asked for it, so they can type at once, after any text already there.
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const { pending, error, run } = useAction();
  const send = (event: React.FormEvent) => {
    event.preventDefault();
    if (text.trim() === "") return;
    run(() => onSubmit(text), () => setText(""));
  };
  return (
    <form onSubmit={send} className="space-y-1.5">
      <label className="block">
        <span className="text-xs text-muted">{label}</span>
        <textarea
          ref={box}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={max}
          rows={3}
          className="mt-1 w-full border border-field bg-surface p-2 text-base"
        />
      </label>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">
          {text.length}/{max}
        </span>
        <span className="flex items-center gap-2">
          {onCancel && (
            <button type="button" disabled={pending} onClick={onCancel} className="cursor-pointer border border-line bg-surface px-3 py-1.5 hover:bg-head disabled:opacity-60">
              Cancel
            </button>
          )}
          <button type="submit" disabled={pending || text.trim() === ""} className="cursor-pointer bg-brand px-3 py-1.5 font-bold text-on-brand hover:bg-brand-dark disabled:opacity-60">
            {pending ? "Sending..." : submit}
          </button>
        </span>
      </div>
      {error && (
        <p role="alert" className="text-urgent">
          {error}
        </p>
      )}
    </form>
  );
}

// Like and dislike with a count each. Your own vote is highlighted; pressing it again takes it back. Not shown as
// pressable on your own question, for the seller, or when signed out.
function Votes({ listingId, questionId, target, votes, canVote, signedIn }: { listingId: string; questionId: string; target: VoteTarget; votes: VoteSummary; canVote: boolean; signedIn: boolean }) {
  const { pending, error, run } = useAction();
  const press = (value: VoteValue) => run(() => voteAction(listingId, questionId, target, votes.mine === value ? null : value));
  const button = (value: VoteValue, count: number, label: string, down = false) => {
    const active = votes.mine === value;
    return (
      <button
        type="button"
        aria-label={`${label} (${count})`}
        aria-pressed={active}
        disabled={!canVote || pending}
        title={!signedIn ? "Sign in to vote" : !canVote ? "You cannot vote on this" : undefined}
        onClick={() => press(value)}
        className={`flex items-center gap-1 rounded-full px-2 py-0.5 disabled:cursor-default ${canVote ? "cursor-pointer hover:bg-head-hover" : ""} ${active ? "bg-brand-chip font-bold text-brand" : "text-muted"}`}
      >
        <Thumb down={down} />
        <span>{count}</span>
      </button>
    );
  };
  return (
    <span className="flex shrink-0 items-center gap-0.5 text-xs">
      {button("LIKE", votes.likes, "Like")}
      {button("DISLIKE", votes.dislikes, "Dislike", true)}
      {error && (
        <span role="alert" className="text-urgent">
          {error}
        </span>
      )}
    </span>
  );
}

// Three dots that open a small menu of what you can do with a post.
// An item with `confirm` does not act at once: the menu turns into a light red question with "Yes, delete" and "Cancel".
// An item with `report` asks why first, with a list of reasons.
interface MenuItem {
  label: string;
  onSelect?: () => void;
  confirm?: { text: string; onConfirm: () => void };
  report?: { onReport: (reason: ReportReason) => void };
}

function MoreMenu({ label, items, disabled }: { label: string; items: MenuItem[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<MenuItem | null>(null);
  const [reason, setReason] = useState<ReportReason>("SPAM");
  const close = () => {
    setOpen(false);
    setAsking(null);
  };
  const ref = useRef<HTMLSpanElement>(null);
  useDismiss(ref, open, () => close());
  if (items.length === 0) return null;
  return (
    <span ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-head-hover disabled:cursor-default disabled:opacity-60"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {open && asking?.confirm && (
        <div role="alertdialog" aria-label={asking.label} className="absolute right-0 z-10 mt-1 w-56 space-y-2 border border-line bg-surface p-2 text-xs shadow-md">
          <p>{asking.confirm.text}</p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => {
                const { onConfirm } = asking.confirm!;
                close();
                onConfirm();
              }}
              className={dangerButton}
            >
              Yes, delete
            </button>
            <button type="button" onClick={close} className={plainButton}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {open && asking?.report && (
        <div role="dialog" aria-label={asking.label} className="absolute right-0 z-10 mt-1 w-56 space-y-2 border border-line bg-surface p-2 text-xs shadow-md">
          <label className="block space-y-1">
            <span>Why are you reporting this?</span>
            <select value={reason} onChange={(e) => setReason(e.target.value as ReportReason)} className="block w-full border border-field bg-surface p-1">
              {REPORT_REASONS.map((value) => (
                <option key={value} value={value}>
                  {REPORT_REASON_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => {
                const { onReport } = asking.report!;
                const chosen = reason;
                close();
                onReport(chosen);
              }}
              className={primaryButton}
            >
              Send report
            </button>
            <button type="button" onClick={close} className={plainButton}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {open && !asking && (
        <div role="menu" className="absolute right-0 z-10 mt-1 min-w-36 border border-line bg-surface py-1 text-xs shadow-md">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                if (item.confirm || item.report) setAsking(item);
                else {
                  close();
                  item.onSelect?.();
                }
              }}
              className="block w-full cursor-pointer px-3 py-1.5 text-left hover:bg-head"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

// Shown in place of the words of a post a moderator removed.
function Removed({ what }: { what: "question" | "answer" }) {
  return (
    <p className="italic text-muted">
      This {what} was removed by moderation.{" "}
      <Link href={POLICY_LINKS.comments} className="text-brand underline">
        See what you can and cannot post
      </Link>
      .
    </p>
  );
}

function Row({ question, listingId, viewerId, isSeller, open }: { question: QuestionItem; listingId: string; viewerId?: string; isSeller: boolean; open: boolean }) {
  const { pending, error, run } = useAction();
  const [answering, setAnswering] = useState(false);
  const [editing, setEditing] = useState<"question" | "answer" | null>(null);
  const [notice, setNotice] = useState("");

  const mine = question.asker !== null && question.asker.id === viewerId;
  // Changing or deleting a post is open only while the auction has not ended.
  const canChangeQuestion = mine && open && !question.moderated;
  const canChangeAnswer = isSeller && question.answer !== null && !question.answer.moderated && open;
  // Anyone signed in may report what someone else wrote.
  const reportItem = (target: "QUESTION" | "ANSWER"): MenuItem => ({
    label: "Report",
    report: {
      onReport: (reason) => {
        setNotice("");
        run(() => reportAction(listingId, question.id, target, reason), () => setNotice("Thanks, we'll take a look."));
      },
    },
  });
  const questionItems: MenuItem[] = canChangeQuestion
    ? [
        { label: "Edit question", onSelect: () => setEditing("question") },
        { label: "Delete question", confirm: { text: "Delete this question? This cannot be undone.", onConfirm: () => run(() => deleteQuestionAction(listingId, question.id)) } },
      ]
    : viewerId !== undefined && !mine && question.body !== null && !question.moderated
      ? [reportItem("QUESTION")]
      : [];
  const answerItems: MenuItem[] = canChangeAnswer
    ? [
        { label: "Edit answer", onSelect: () => setEditing("answer") },
        { label: "Delete answer", confirm: { text: "Delete this answer? This cannot be undone.", onConfirm: () => run(() => deleteAnswerAction(listingId, question.id)) } },
      ]
    : viewerId !== undefined && !isSeller && question.answer !== null && !question.answer.moderated
      ? [reportItem("ANSWER")]
      : [];

  return (
    <li className="space-y-1.5 border-t border-line p-3">
      <div className="flex items-center justify-between gap-3 pr-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-xs text-muted">
            {question.asker ? <b className="text-ink">{question.asker.username}</b> : <i>&lt;deleted user&gt;</i>}
            {mine && " (you)"} · <LocalTime iso={question.createdAt} />
            {question.editedAt && " (edited)"}
          </p>
          {editing === "question" && question.body !== null ? (
            <TextForm
              label="Edit your question"
              max={QUESTION_MAX_LENGTH}
              submit="Save"
              initial={question.body}
              onSubmit={async (body) => {
                const result = await editQuestionAction(listingId, question.id, body);
                if (result.ok) setEditing(null);
                return result;
              }}
              onCancel={() => setEditing(null)}
            />
          ) : question.moderated ? (
            <Removed what="question" />
          ) : question.body !== null ? (
            <p className="whitespace-pre-wrap">{question.body}</p>
          ) : (
            <p className="italic text-muted">This message can&apos;t be displayed because the user was deleted.</p>
          )}
        </div>
        {!question.moderated && (
          <div className="flex shrink-0 items-center gap-1">
            <Votes listingId={listingId} questionId={question.id} target="QUESTION" votes={question.votes.question} canVote={viewerId !== undefined && !mine && !isSeller} signedIn={viewerId !== undefined} />
            <MoreMenu label="Question actions" disabled={pending} items={questionItems} />
          </div>
        )}
      </div>
      {question.answer && (
        <div className="space-y-0.5 border-l-4 border-brand bg-brand-soft p-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-xs text-muted">
                <b className="text-ink">Seller&apos;s answer</b> · <LocalTime iso={question.answer.answeredAt} />
                {question.answer.editedAt && " (edited)"}
              </p>
              {question.answer.moderated || question.answer.body === null ? (
                <Removed what="answer" />
              ) : editing === "answer" ? (
                <TextForm
                  label="Edit your answer"
                  max={ANSWER_MAX_LENGTH}
                  submit="Save"
                  initial={question.answer.body ?? ""}
                  onSubmit={async (body) => {
                    const result = await editAnswerAction(listingId, question.id, body);
                    if (result.ok) setEditing(null);
                    return result;
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <p className="whitespace-pre-wrap">{question.answer.body}</p>
              )}
            </div>
            {!question.answer.moderated && (
            <div className="flex shrink-0 items-center gap-1">
              <Votes listingId={listingId} questionId={question.id} target="ANSWER" votes={question.votes.answer} canVote={viewerId !== undefined && !isSeller} signedIn={viewerId !== undefined} />
              <MoreMenu label="Answer actions" disabled={pending} items={answerItems} />
            </div>
            )}
          </div>
        </div>
      )}
      {isSeller && !question.answer && !question.moderated && !answering && (
        <div>
          <button
            type="button"
            onClick={() => setAnswering(true)}
            className="flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-xs font-bold text-brand hover:bg-head-hover"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Answer
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-urgent">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-muted">
          {notice}
        </p>
      )}
      {isSeller && !question.answer && answering && (
        <TextForm label="Your answer (everyone can read it)" max={ANSWER_MAX_LENGTH} submit="Post answer"
          onSubmit={async (body) => {
            const result = await answerQuestionAction(listingId, question.id, body);
            if (result.ok) setAnswering(false);
            return result;
          }} onCancel={() => setAnswering(false)} />
      )}
    </li>
  );
}

// Closed until "Ask a question" is pressed, so there is always a way back out of it.
function AskBox({ listingId }: { listingId: string }) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted">Questions and answers are public. Keep conversations on the site, and never share payment details.</p>
      {asking ? (
        <TextForm
          label="Ask the seller a question"
          max={QUESTION_MAX_LENGTH}
          submit="Ask"
          onSubmit={async (body) => {
            const result = await askQuestionAction(listingId, body);
            if (result.ok) setAsking(false);
            return result;
          }}
          onCancel={() => setAsking(false)}
        />
      ) : (
        <button type="button" onClick={() => setAsking(true)} className={primaryButton}>
          Ask a question
        </button>
      )}
    </div>
  );
}

export function Questions({
  listingId,
  items,
  total,
  viewerId,
  isSeller,
  open,
}: {
  listingId: string;
  items: QuestionItem[];
  total: number;
  viewerId?: string;
  isSeller: boolean;
  // False once the auction has ended: nobody can ask, but the seller can still answer.
  open: boolean;
}) {
  return (
    <section aria-label="Questions" className="border border-line bg-surface">
      <h2 className="border-b border-line bg-head px-3 py-1.5 text-sm font-bold">
        Questions <span className="font-normal text-muted">({total})</span>
      </h2>
      <div className="p-3">
        {!viewerId ? (
          <p className={note}>
            <Link href="/sign-in" className="text-brand underline">
              Sign in
            </Link>{" "}
            to ask the seller a question.
          </p>
        ) : isSeller ? (
          <p className={note}>Questions from buyers appear below. Your answers are public.</p>
        ) : !open ? (
          <p className={note}>Questions are closed because the auction has ended.</p>
        ) : (
          <AskBox listingId={listingId} />
        )}
      </div>
      {items.length === 0 ? (
        <p className="border-t border-line p-3 text-muted">No questions yet.</p>
      ) : (
        <ul>
          {items.map((question) => (
            <Row key={question.id} question={question} listingId={listingId} viewerId={viewerId} isSeller={isSeller} open={open} />
          ))}
        </ul>
      )}
    </section>
  );
}
