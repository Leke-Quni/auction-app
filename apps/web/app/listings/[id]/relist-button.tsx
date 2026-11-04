"use client";

import { useState, useTransition } from "react";
import { relistListingAction } from "@/app/sell/actions";

export function RelistButton({ listingId }: { listingId: string }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const relist = () => {
    setError("");
    startTransition(async () => {
      const result = await relistListingAction(listingId);
      if (result?.error) setError(result.error);
    });
  };

  return (
    <span>
      <button onClick={relist} disabled={pending} className="cursor-pointer bg-brand px-3 py-1 font-bold text-white hover:bg-brand-dark disabled:opacity-60">
        {pending ? "..." : "List it again"}
      </button>
      {error && <span className="ml-2 text-urgent">{error}</span>}
    </span>
  );
}
