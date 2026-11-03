import { formatEur } from "@auction/shared";
import { LocalTime } from "@/app/local-time";

export interface BidRow {
  id: string;
  amountCents: number;
  createdAt: string;
  bidder: { id: string; username: string };
}

export function BidHistory({ bids, total, viewerId }: { bids: BidRow[]; total: number; viewerId?: string }) {
  return (
    <div className="border border-line bg-white">
      <h2 className="border-b border-line bg-[#f0f0f0] px-3 py-1.5 text-sm font-bold">
        Bid history <span className="font-normal text-muted">({total})</span>
      </h2>
      {bids.length === 0 ? (
        <p className="p-3 text-muted">No bids yet.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="px-3 py-1 font-normal">Bidder</th>
              <th className="px-3 py-1 font-normal">Bid</th>
              <th className="px-3 py-1 font-normal">When</th>
            </tr>
          </thead>
          <tbody>
            {bids.map((bid, i) => (
              <tr key={bid.id} className={i === 0 ? "bg-[#f0fdfa] font-bold" : ""}>
                <td className="border-t border-line px-3 py-1">
                  {bid.bidder.username}
                  {bid.bidder.id === viewerId && <span className="font-normal text-muted"> (you)</span>}
                </td>
                <td className="border-t border-line px-3 py-1">{formatEur(bid.amountCents)}</td>
                <td className="border-t border-line px-3 py-1 font-normal">
                  <LocalTime iso={bid.createdAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {total > bids.length && <p className="border-t border-line px-3 py-1.5 text-xs text-muted">Showing the highest {bids.length} of {total} bids.</p>}
    </div>
  );
}
