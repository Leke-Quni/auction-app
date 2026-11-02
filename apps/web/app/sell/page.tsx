import { formatEur } from "@auction/shared";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LocalTime } from "@/app/local-time";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";

const PHASE_LABELS = { draft: "Draft", upcoming: "Upcoming", live: "Live", ended: "Ended" } as const;

interface MyListing {
  id: string;
  title: string;
  startingPriceCents: number;
  phase: keyof typeof PHASE_LABELS;
  endsAt: string | null;
}

export default async function MyListingsPage() {
  if (!(await auth())) redirect("/sign-in");
  const res = await authedApiFetch("/me/listings");
  if (res.status === 401) redirect("/sign-in");
  if (!res.ok) throw new Error(`API /me/listings failed: ${res.status}`);
  const listings: MyListing[] = await res.json();

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-bold">My listings</h1>
        <Link href="/sell/new" className="text-brand underline">
          New listing
        </Link>
      </div>
      {listings.length === 0 ? (
        <p className="border border-line bg-white p-4 text-muted">You have not listed anything yet.</p>
      ) : (
        <table className="w-full border-collapse bg-white">
          <thead>
            <tr className="bg-[#f0f0f0] text-left text-xs font-normal text-muted">
              <th className="border border-line p-1.5 font-normal">Title</th>
              <th className="border border-line p-1.5 font-normal">Status</th>
              <th className="border border-line p-1.5 font-normal">Starting price</th>
              <th className="border border-line p-1.5 font-normal">Ends</th>
              <th className="border border-line p-1.5 font-normal" />
            </tr>
          </thead>
          <tbody>
            {listings.map((l) => (
              <tr key={l.id}>
                <td className="border border-line p-1.5">
                  <Link href={`/listings/${l.id}`} className="text-brand underline">
                    {l.title}
                  </Link>
                </td>
                <td className="border border-line p-1.5">{PHASE_LABELS[l.phase]}</td>
                <td className="border border-line p-1.5">{formatEur(l.startingPriceCents)}</td>
                <td className="border border-line p-1.5">{l.endsAt ? <LocalTime iso={l.endsAt} /> : "—"}</td>
                <td className="border border-line p-1.5">
                  <Link href={`/sell/${l.id}/edit`} className="text-brand underline">
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
