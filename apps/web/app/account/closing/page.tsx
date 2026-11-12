import type { AccountDeletionStatus } from "@auction/shared";
import { redirect } from "next/navigation";
import { restoreAccountAction } from "@/app/actions";
import { LocalTime } from "@/app/local-time";
import { auth, signOut } from "@/auth";
import { authedApiFetch } from "@/lib/api";

export const metadata = { title: "Account scheduled for deletion - Auctionly" };

// Where an account that is waiting to be deleted lands, from any page: the only things it can do are restore itself or sign out.
export default async function ClosingPage() {
  if (!(await auth())) redirect("/sign-in");
  const res = await authedApiFetch("/me/deletion");
  if (res.status === 401) redirect("/sign-in");
  if (!res.ok) throw new Error(`API /me/deletion failed: ${res.status}`);
  const status: AccountDeletionStatus = await res.json();
  if (!status.closedAt || !status.deletesAt) redirect("/account/settings");

  return (
    <div className="mx-auto max-w-md space-y-3 border border-line bg-surface p-4">
      <h1 className="text-lg font-bold">Your account is scheduled for deletion</h1>
      <p>
        It will be deleted for good on <LocalTime iso={status.deletesAt} />. Until then you cannot bid, sell or use the site, and your profile is hidden.
      </p>
      <p className="text-muted">Changed your mind? Restore it and everything is as you left it, except the auctions that were ended when you asked to delete it.</p>
      <div className="flex gap-2">
        <form action={restoreAccountAction}>
          <button className="cursor-pointer bg-brand px-4 py-2 font-bold text-on-brand hover:bg-brand-dark">Restore my account</button>
        </form>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button className="cursor-pointer border border-field bg-surface px-4 py-2">Sign out</button>
        </form>
      </div>
    </div>
  );
}
