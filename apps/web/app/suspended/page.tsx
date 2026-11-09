import { EndSession } from "./end-session";
import { SuspendedSupportForm } from "./suspended-support-form";

export const metadata = { title: "Account suspended - Auctionly" };

// Where a banned account lands, from any page, and from an open page the moment the ban is made. It does not call the API
// (the API refuses a banned account), and it ends the session so the person is signed out everywhere on this browser.
export default function Suspended() {
  return (
    <div className="mx-auto max-w-md space-y-2 border border-line bg-white p-4">
      <EndSession />
      <h1 className="text-lg font-bold">This account has been suspended</h1>
      <p>You can no longer bid, sell or use this account. If you think this is a mistake, write to support below.</p>
      <SuspendedSupportForm />
    </div>
  );
}
