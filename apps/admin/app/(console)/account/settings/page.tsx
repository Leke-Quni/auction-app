import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";
import { NameForm, PasswordForm } from "./forms";

export const metadata = { title: "Settings - Auctionly Admin" };

// The admin's own name and password. The email and username are not changed here.
export default async function AccountSettings() {
  await requireAdmin();
  const res = await adminApiFetch("/me").catch(() => null);
  if (!res?.ok) throw new Error(`API /me failed: ${res?.status ?? "not reachable"}`);
  const me = await res.json();
  return (
    <div className="max-w-3xl space-y-3">
      <h1 className="text-lg font-bold">Settings</h1>
      <section className="overflow-hidden rounded border border-line bg-panel">
        <h2 className="border-b border-line px-3 py-1.5 font-bold">Name</h2>
        <NameForm firstName={me.firstName} lastName={me.lastName} />
      </section>
      <section className="overflow-hidden rounded border border-line bg-panel">
        <h2 className="border-b border-line px-3 py-1.5 font-bold">Password</h2>
        <PasswordForm />
      </section>
    </div>
  );
}
