import type { SupportStrike } from "@auction/shared";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";
import { SupportForm } from "./support-form";

export const metadata = { title: "Contact support - Auctionly" };

// A question for the people who run the site, or an appeal against a strike. They read it in the admin app and answer by email.
export default async function SupportPage({ searchParams }: { searchParams: Promise<{ appeal?: string }> }) {
  const session = await auth();
  if (!session) redirect("/sign-in");
  const { appeal } = await searchParams;
  const [res, waitingRes] = await Promise.all([authedApiFetch("/support/strikes"), authedApiFetch("/support/waiting").catch(() => null)]);
  if (res.status === 401) redirect("/sign-in");
  if (!res.ok) throw new Error(`API /support/strikes failed: ${res.status}`);
  const strikes: SupportStrike[] = await res.json();
  // Without an answer to this (an older API) the form simply lets the person try; the API still refuses a second message.
  const waiting = waitingRes?.ok ? ((await waitingRes.json()) as { waiting: boolean }).waiting : false;
  return (
    <div className="mx-auto max-w-xl space-y-3">
      <h1 className="border border-line bg-surface p-2 text-lg font-bold">Contact support</h1>
      <SupportForm strikes={strikes} startWithAppeal={appeal !== undefined} waiting={waiting} email={session.user.email ?? "your account email"} />
    </div>
  );
}
