import { requireAdmin } from "@/lib/require-admin";

export default async function Overview() {
  const admin = await requireAdmin();
  return (
    <div className="max-w-2xl space-y-3">
      <h1 className="text-lg font-bold">Overview</h1>
      <div className="rounded border border-line bg-panel p-4">
        <p className="text-muted">Signed in as</p>
        <p className="font-semibold">{admin.email}</p>
        <p className="mt-2 text-muted">Listing and user moderation and the order view arrive in the next steps of slice 7.</p>
      </div>
    </div>
  );
}
