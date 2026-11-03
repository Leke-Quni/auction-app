"use client";

import { useState, useTransition } from "react";
import type { OrderActionState } from "./actions";

// One button that runs a payment action and shows why it failed, if it did. A successful action leaves by redirecting.
export function PayButton({ action, label, orderId }: { action: (orderId: string) => Promise<OrderActionState>; label: string; orderId: string }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-urgent">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError("");
            const result = await action(orderId);
            if (result?.error) setError(result.error);
          })
        }
        className="cursor-pointer bg-brand px-4 py-2 font-bold text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? "Please wait..." : label}
      </button>
    </div>
  );
}
