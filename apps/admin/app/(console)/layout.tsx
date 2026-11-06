import { signOutAction } from "@/app/actions";
import { getOverview } from "@/lib/overview";
import { requireAdmin } from "@/lib/require-admin";
import { Nav } from "./nav";

// Everything behind sign-in: a slate sidebar and a content area. The API is asked who this is on every request.
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const { openReports } = await getOverview();
  return (
    <div className="grid min-h-screen grid-cols-[13rem_1fr]">
      <aside className="flex flex-col bg-side py-4 text-side-ink">
        <p className="px-4 pb-4 text-sm font-bold tracking-wide text-white">Auctionly Admin</p>
        <Nav openReports={openReports} />
        <div className="mt-auto space-y-1 border-t border-white/10 px-4 pt-3">
          <p className="truncate text-xs" title={admin.email}>
            {admin.email}
          </p>
          <form action={signOutAction}>
            <button className="cursor-pointer text-xs underline hover:text-white">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 p-5">{children}</main>
    </div>
  );
}
