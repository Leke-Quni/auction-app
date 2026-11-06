"use client";

import { useEffect, useState, useTransition } from "react";
import { resendCodeAction } from "./actions";

// "Send a new code" under the code box. The server also waits between codes, so the button waits the same time.
const WAIT_SECONDS = 30;

export function ResendCode({ email }: { email: string }) {
  const [wait, setWait] = useState(WAIT_SECONDS);
  const [message, setMessage] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={pending || wait > 0}
        onClick={() =>
          start(async () => {
            setMessage(await resendCodeAction(email));
            setWait(WAIT_SECONDS);
          })
        }
        className="cursor-pointer text-brand underline disabled:cursor-default disabled:text-muted disabled:no-underline"
      >
        {wait > 0 ? `Send a new code (${wait}s)` : "Send a new code"}
      </button>
      {message.ok && <p className="text-muted">{message.ok}</p>}
      {message.error && <p className="text-urgent">{message.error}</p>}
    </div>
  );
}
