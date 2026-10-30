import { CONDITION_LABELS, formatDuration, formatEur } from "@auction/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Gallery } from "@/app/gallery";
import { LocalTime } from "@/app/local-time";
import { auth } from "@/auth";
import { apiFetch, authedApiFetch } from "@/lib/api";

const PHASE_LABELS = { draft: "Draft", upcoming: "Upcoming", live: "Live", ended: "Ended" } as const;

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const res = session ? await authedApiFetch(`/listings/${id}`) : await apiFetch(`/listings/${id}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API /listings/${id} failed: ${res.status}`);
  const listing = await res.json();
  const isOwner = session?.user.id === listing.seller.id;

  const rows: [string, React.ReactNode][] = [
    ["Starting price", formatEur(listing.startingPriceCents)],
    ["Reserve price", listing.reservePriceCents == null ? "None" : formatEur(listing.reservePriceCents)],
    ["Condition", CONDITION_LABELS[listing.condition as keyof typeof CONDITION_LABELS]],
    ["Category", listing.category.name],
    ["Seller", listing.seller.username],
    ["Duration", formatDuration(listing.durationDays)],
    ...(listing.startsAt ? ([["Starts", <LocalTime key="s" iso={listing.startsAt} />]] as [string, React.ReactNode][]) : []),
    ...(listing.endsAt ? ([["Ends", <LocalTime key="e" iso={listing.endsAt} />]] as [string, React.ReactNode][]) : []),
    ["Status", PHASE_LABELS[listing.phase as keyof typeof PHASE_LABELS]],
  ];

  return (
    <div className="space-y-3">
      {isOwner && (
        <p className="border border-brand bg-white p-2">
          {listing.status === "DRAFT" ? "This is a draft. Only you can see it. " : "This is your listing. "}
          <Link href={`/sell/${listing.id}/edit`} className="text-brand underline">
            {listing.status === "DRAFT" ? "Edit and publish" : "Edit description and photos"}
          </Link>
        </p>
      )}
      <h1 className="border border-line bg-white p-2 text-lg font-bold">{listing.title}</h1>
      <div className="grid gap-3 sm:grid-cols-[2fr_3fr]">
        <Gallery images={listing.images} alt={listing.title} />
        <div className="space-y-3">
          <table className="w-full border-collapse bg-white">
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label}>
                  <th className="w-36 border border-line bg-[#f0f0f0] p-1.5 text-left font-normal text-muted">{label}</th>
                  <td className="border border-line p-1.5">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border border-line bg-white p-2 text-muted">Bidding is not available yet.</p>
        </div>
      </div>
      <div className="border border-line bg-white p-3">
        <h2 className="mb-1 text-sm font-bold">Description</h2>
        <p className="whitespace-pre-wrap">{listing.description}</p>
      </div>
    </div>
  );
}
