"use client";

import { RATING_COMMENT_MAX } from "@auction/shared";
import { useState, useTransition } from "react";
import { rateSellerAction } from "./orders/actions";

// After delivery, the buyer rates the seller once: 1 to 5 stars and an optional comment. It cannot be changed afterwards.
export function RatingForm({ orderId, sellerName }: { orderId: string; sellerName: string }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const submit = () => {
    if (stars === 0) return setError("Choose 1 to 5 stars.");
    setError("");
    start(async () => {
      const result = await rateSellerAction(orderId, stars, comment);
      if (result?.error) setError(result.error);
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-2 border border-line bg-surface p-3"
    >
      <fieldset className="space-y-1">
        <legend className="font-bold">How was {sellerName}?</legend>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="flex cursor-pointer items-center gap-1">
              <input type="radio" name="stars" value={n} checked={stars === n} onChange={() => setStars(n)} aria-label={`${n} ${n === 1 ? "star" : "stars"}`} />
              <span aria-hidden="true">{n} ★</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="text-xs text-muted">Comment (optional, shown on their profile)</span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={RATING_COMMENT_MAX}
          rows={3}
          className="mt-1 w-full border border-line p-2"
        />
      </label>
      <p className="text-xs text-muted">Your username is shown with your rating. You cannot change it afterwards.</p>
      {error && (
        <p role="alert" className="text-urgent">
          {error}
        </p>
      )}
      <button disabled={pending} className="cursor-pointer bg-brand px-4 py-2 font-bold text-on-brand hover:bg-brand-dark disabled:opacity-60">
        {pending ? "Please wait..." : "Submit rating"}
      </button>
    </form>
  );
}
