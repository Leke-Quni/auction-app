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
  images: { url: string }[];
}

// Both tables use the same column widths, so the columns line up from one table to the other.
function Columns() {
  return (
    <colgroup>
      <col className="w-20" />
      <col />
      <col className="w-24" />
      <col className="w-32 max-sm:hidden" />
      <col className="w-44 max-sm:hidden" />
      <col className="w-16" />
    </colgroup>
  );
}

const cell = "border border-line p-1.5";
const head = "border border-line p-1.5 font-normal";

// The cover is the first photo; a draft or listing without one shows an empty square.
function Cover({ listing }: { listing: MyListing }) {
  const cover = listing.images[0]?.url;
  return cover ? (
    <img src={cover} alt="" className="size-12 bg-sunken object-cover" />
  ) : (
    <div className="size-12 bg-sunken" />
  );
}

export default async function MyListingsPage() {
  if (!(await auth())) redirect("/sign-in");
  const res = await authedApiFetch("/me/listings");
  if (res.status === 401) redirect("/sign-in");
  if (!res.ok) throw new Error(`API /me/listings failed: ${res.status}`);
  const listings: MyListing[] = await res.json();
  const drafts = listings.filter((l) => l.phase === "draft");
  const published = listings.filter((l) => l.phase !== "draft");

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-bold">My listings</h1>
        <Link href="/sell/new" className="text-brand underline">
          New listing
        </Link>
      </div>
      {listings.length === 0 ? (
        <p className="border border-line bg-surface p-4 text-muted">You have not listed anything yet.</p>
      ) : (
        <>
          {published.length > 0 && (
            <section className="space-y-1">
              <h2 className="text-sm font-bold">Published ({published.length})</h2>
              <div className="overflow-x-auto">
                <table className="w-full table-fixed sm:min-w-[40rem] border-collapse bg-surface">
                  <Columns />
                  <thead>
                    <tr className="bg-head text-left text-xs font-normal text-muted">
                      <th className={head}>Photo</th>
                      <th className={head}>Title</th>
                      <th className={head}>Status</th>
                      <th className={`${head} max-sm:hidden`}>Starting price</th>
                      <th className={`${head} max-sm:hidden`}>Ends</th>
                      <th className={head} />
                    </tr>
                  </thead>
                  <tbody>
                    {published.map((l) => (
                      <tr key={l.id}>
                        <td className={cell}>
                          <Cover listing={l} />
                        </td>
                        <td className={cell}>
                          <Link href={`/listings/${l.id}`} className="text-brand underline">
                            {l.title}
                          </Link>
                        </td>
                        <td className={cell}>{PHASE_LABELS[l.phase]}</td>
                        <td className={`${cell} max-sm:hidden`}>{formatEur(l.startingPriceCents)}</td>
                        <td className={`${cell} max-sm:hidden`}>{l.endsAt ? <LocalTime iso={l.endsAt} /> : "—"}</td>
                        <td className={cell}>
                          {l.phase !== "ended" && (
                            <Link href={`/sell/${l.id}/edit`} className="text-brand underline">
                              Edit
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {drafts.length > 0 && (
            <section className="space-y-1">
              <h2 className="text-sm font-bold">Drafts ({drafts.length})</h2>
              <div className="overflow-x-auto">
                <table className="w-full table-fixed sm:min-w-[40rem] border-collapse bg-surface">
                  <Columns />
                  <thead>
                    <tr className="bg-head text-left text-xs font-normal text-muted">
                      <th className={head}>Photo</th>
                      <th className={head}>Title</th>
                      <th className={head}>Status</th>
                      <th className={`${head} max-sm:hidden`}>Starting price</th>
                      <th className={`${head} max-sm:hidden`}>Ends</th>
                      <th className={head} />
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.map((l) => (
                      <tr key={l.id}>
                        <td className={cell}>
                          <Cover listing={l} />
                        </td>
                        <td className={cell}>
                          <Link href={`/listings/${l.id}`} className="text-brand underline">
                            {l.title}
                          </Link>
                        </td>
                        <td className={cell}>{PHASE_LABELS[l.phase]}</td>
                        <td className={`${cell} max-sm:hidden`}>{formatEur(l.startingPriceCents)}</td>
                        <td className={`${cell} max-sm:hidden`}>—</td>
                        <td className={cell}>
                          <Link href={`/sell/${l.id}/edit`} className="text-brand underline">
                            Edit
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
