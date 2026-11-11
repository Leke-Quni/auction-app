"use client";

import { Check, Mail } from "lucide-react";
import { useTransition } from "react";
import { markRepliedAction } from "./actions";

const stamp = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";

// Opens a reply in the admin's mail program and remembers that it was opened, so the button says "Replied" for every admin afterwards.
// It records the click, not that the email was sent; the request is closed separately. A click on "Replied" opens the draft again.
export function ReplyButton({ id, href, email, repliedAt }: { id: string; href: string; email: string; repliedAt?: string | null }) {
  const [, startTransition] = useTransition();
  // An API from before this field existed sends nothing, which counts as not replied.
  const replied = Boolean(repliedAt);
  return (
    <a
      href={href}
      onClick={() => {
        if (!replied) startTransition(() => markRepliedAction(id));
      }}
      title={replied ? `Reply opened ${stamp(repliedAt!)}. Click to open the draft again.` : `Write to ${email} in your mail program`}
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-semibold ${replied ? "border-ok/40 bg-ok-soft text-ok hover:border-ok" : "border-line bg-panel hover:bg-page"}`}
    >
      {replied ? <Check size={14} /> : <Mail size={14} />}
      {replied ? "Replied" : "Reply"}
    </a>
  );
}
