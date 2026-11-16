import type { ReactNode } from "react";
import { SidebarPage } from "./search/search-sidebar";

// What a page shows while it waits for the API, which can take several seconds when its machine has to wake up. Each route has a
// loading.tsx built from these, shaped like the page it stands in for (same width, same blocks, same heights), so the page that is
// left is never mistaken for the one that is coming, and the real page lands exactly on top of it without anything jumping.
// A line of text is drawn 1lh tall (one line of the font around it), so the wrapper carries the same text classes as the real element.
export const Bone = ({ className = "" }: { className?: string }) => <div className={`animate-pulse rounded-control bg-line ${className}`} />;
const Line = ({ className = "" }: { className?: string }) => <Bone className={`h-[1lh] ${className}`} />;

function Frame({ label, className, children }: { label: string; className: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      {children}
    </div>
  );
}

const Box = ({ className = "", children }: { className?: string; children: ReactNode }) => <div className={`border border-line bg-surface ${className}`}>{children}</div>;

// The boxed page title most pages start with, and the plain heading the list pages use.
const TitleBar = () => (
  <Box className="p-2 text-lg font-bold">
    <Line className="w-40" />
  </Box>
);
const Heading = ({ className = "w-40" }: { className?: string }) => (
  <div className="text-lg font-bold">
    <Line className={className} />
  </div>
);

// A listing card: a full-width square photo, then the title (two lines), the price and the time at the bottom.
function CardBone({ bids = true }: { bids?: boolean }) {
  return (
    <div className="flex h-full flex-col overflow-hidden border border-line bg-surface">
      <Bone className="aspect-square w-full rounded-none" />
      <div className="flex flex-1 flex-col gap-0.5 p-3">
        <div className="font-bold">
          <Line className="w-full" />
          <Line className="w-2/3" />
        </div>
        <div className="text-base font-bold">
          <Line className="w-1/2" />
        </div>
        {bids && (
          <div className="text-sm font-bold">
            <Line className="w-1/4" />
          </div>
        )}
        <div className="mt-auto text-xs">
          <Line className="w-2/3" />
        </div>
      </div>
    </div>
  );
}

// `gap` and `stop` follow the page: home and search use a wider gap, the watchlist adds a "Stop watching" line under each card.
export function ListingCardsSkeleton({ count = 8, gap = "gap-3", stop = false, bids = true }: { count?: number; gap?: string; stop?: boolean; bids?: boolean }) {
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-4 ${gap}`}>
      {Array.from({ length: count }, (_, i) =>
        stop ? (
          <div key={i} className="flex flex-col gap-1">
            <div className="flex-1">
              <CardBone bids={bids} />
            </div>
            <div className="h-5 text-xs">
              <Line className="w-1/2" />
            </div>
          </div>
        ) : (
          <CardBone key={i} bids={bids} />
        ),
      )}
    </div>
  );
}

// The filter column: the categories, then the filters, as tall as the real ones at each width (stacked above the cards on a phone and a
// tablet, its own column from 900px) so the column does not grow when they arrive.
const SidebarBone = () => (
  <div className="space-y-2">
    <Box className="h-[131px] space-y-3 overflow-hidden p-3 sm:max-[899px]:h-[83px] min-[900px]:h-[299px]">
      <Line className="w-20" />
      {Array.from({ length: 8 }, (_, i) => (
        <Line key={i} className="w-3/4" />
      ))}
    </Box>
    <Box className="h-[334px] space-y-3 overflow-hidden p-3 sm:max-[899px]:h-[305px] min-[900px]:h-[357px]">
      <Line className="w-16" />
      {Array.from({ length: 6 }, (_, i) => (
        <Line key={i} className="w-full" />
      ))}
    </Box>
  </div>
);

// The home page (a "Auctions" heading above the cards) and the search page (a heading and the result count).
export function BrowseSkeleton({ page }: { page: "home" | "search" }) {
  return (
    <Frame label="Loading" className="contents">
      <SidebarPage sidebar={<SidebarBone />}>
        {page === "home" ? (
          <>
            <section className="space-y-2">
              <Heading className="w-32" />
              <ListingCardsSkeleton count={4} />
            </section>
            <section className="space-y-2">
              <Heading className="w-24" />
              <ListingCardsSkeleton count={4} bids={false} />
            </section>
            <Heading />
          </>
        ) : (
          <>
            <Heading className="w-56" />
            <Line className="w-24" />
          </>
        )}
        <ListingCardsSkeleton />
      </SidebarPage>
    </Frame>
  );
}

// The watchlist: a title bar, the filter pills, then cards with a "Stop watching" line under each.
export function WatchlistSkeleton() {
  return (
    <Frame label="Loading" className="space-y-3">
      <TitleBar />
      <div className="flex gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Bone key={i} className="h-[calc(1lh+0.5rem+2px)] w-20" />
        ))}
      </div>
      <ListingCardsSkeleton count={4} gap="gap-2" stop />
    </Frame>
  );
}

// A seller's profile: the summary card, a "For sale now" bar, then their listings.
export function ProfileSkeleton() {
  return (
    <Frame label="Loading" className="space-y-3">
      <Box className="space-y-1 p-3">
        <div className="text-lg font-bold">
          <Line className="w-40" />
        </div>
        <Line className="w-56" />
        <Line className="w-48" />
      </Box>
      <section className="space-y-2">
        <Box className="p-2 font-bold">
          <Line className="w-28" />
        </Box>
        <ListingCardsSkeleton count={4} gap="gap-2" />
      </section>
    </Frame>
  );
}

// A table like the real ones: the same cell padding and borders, so a row is as tall as a real row.
function TableBone({ heads, rows, photo = false }: { heads: number; rows: number; photo?: boolean }) {
  const cell = "border border-line p-1.5";
  return (
    <table className="w-full table-fixed border-collapse bg-surface">
      <thead>
        <tr className="bg-head text-left text-xs font-normal text-muted">
          {Array.from({ length: heads }, (_, i) => (
            <th key={i} className={`${cell} font-normal`}>
              <Line className="w-3/4" />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r}>
            {Array.from({ length: heads }, (_, i) => (
              <td key={i} className={cell}>
                {photo && i === 0 ? <Bone className="size-12" /> : <Line className="w-3/4" />}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// My orders: a heading, then Purchases and Sales, each a bar over a table.
export function OrdersSkeleton() {
  return (
    <Frame label="Loading" className="space-y-3">
      <Heading />
      {Array.from({ length: 2 }, (_, s) => (
        <section key={s} className="space-y-2">
          <Box className="p-2 font-bold">
            <Line className="w-24" />
          </Box>
          <TableBone heads={5} rows={3} />
        </section>
      ))}
    </Frame>
  );
}

// My listings: a heading with the "New listing" link, then a table with a photo in each row.
export function MyListingsSkeleton() {
  return (
    <Frame label="Loading" className="space-y-3">
      <div className="flex items-end justify-between">
        <Heading />
        <div className="mb-px w-24">
          <Line />
        </div>
      </div>
      <section className="space-y-1">
        <div className="text-sm font-bold">
          <Line className="w-28" />
        </div>
        <TableBone heads={6} rows={3} photo />
      </section>
    </Frame>
  );
}

// Your account: one card holding the title, the table of details and the settings link.
export function AccountSkeleton() {
  return (
    <Frame label="Loading" className="contents">
      <Box className="p-4">
        <div className="mb-2 text-lg font-bold">
          <Line className="w-40" />
        </div>
        <table className="w-full border-collapse">
          <tbody>
            {Array.from({ length: 5 }, (_, i) => (
              <tr key={i}>
                <th className="w-40 border border-line bg-head p-2 text-left font-normal">
                  <Line className="w-3/4" />
                </th>
                <td className="border border-line p-2">
                  <Line className="w-1/2" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3">
          <Line className="w-32" />
        </div>
      </Box>
    </Frame>
  );
}

interface FormCardProps {
  // The title: "lg" for the sign-in page, "base" for the others.
  title?: "lg" | "base";
  // One entry per field: how many lines of hint text it has under its label.
  fields: number[];
  // Sign-in has placeholders and no labels.
  labels?: boolean;
  // The "Forgot your password?" row between the fields and the button.
  forgot?: boolean;
  // A line of text under the button, such as "Already have an account?".
  footer?: boolean;
  fullButton?: boolean;
  // Sign-in and forgot-password put the card inside a wrapping div (and a line of text under it); sign-up and reset are the card alone.
  wrapped?: boolean;
  below?: boolean;
}

// A form in its own narrow card (sign-in, sign-up, forgot and reset password): the title sits inside the card.
export function FormCardSkeleton({ title = "base", fields, labels = true, forgot = false, footer = false, fullButton = false, wrapped = false, below = false }: FormCardProps) {
  return (
    <Frame label="Loading" className={wrapped ? "space-y-3" : "contents"}>
      <Box className="mx-auto max-w-sm space-y-3 p-4">
        <div className={title === "lg" ? "text-lg font-bold" : "text-base font-bold"}>
          <Line className="w-40" />
        </div>
        {fields.map((hintLines, i) => (
          <div key={i}>
            {labels && <Line className="w-24" />}
            {hintLines > 0 && (
              <div className="text-xs">
                {Array.from({ length: hintLines }, (_, l) => (
                  <Line key={l} className={l === hintLines - 1 && hintLines > 1 ? "w-2/3" : "w-full"} />
                ))}
              </div>
            )}
            <Bone className="mt-1 h-[42px] w-full" />
          </div>
        ))}
        {forgot && <Line className="w-40" />}
        <Bone className={`h-9 ${fullButton ? "w-full" : "w-32"}`} />
        {footer && <Line className="w-48" />}
      </Box>
      {below && (
        <div className="mx-auto max-w-sm text-muted">
          <Line className="w-32" />
        </div>
      )}
    </Frame>
  );
}

// A page of a title and a form or a record, in the narrow centred column. The title is a boxed bar, a plain heading with a link
// beside it (editing a listing), or a line of intro text (a new listing).
export function NarrowPageSkeleton({ fields = 4, head = "bar" }: { fields?: number; head?: "bar" | "heading" | "intro" }) {
  return (
    <Frame label="Loading" className="mx-auto max-w-xl space-y-3">
      {head === "bar" && <TitleBar />}
      {head === "heading" && (
        <div className="flex items-end justify-between">
          <Heading />
          <div className="mb-px w-24">
            <Line />
          </div>
        </div>
      )}
      {head === "intro" && (
        <div className="text-muted">
          <Line className="w-full" />
        </div>
      )}
      <Box className="space-y-4 p-3">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="space-y-1">
            <Line className="w-24" />
            <Bone className="h-8 w-full" />
          </div>
        ))}
        <Bone className="h-9 w-32" />
      </Box>
    </Frame>
  );
}

// The listing page: title bar, a square photo beside the details, then the description.
export function ListingSkeleton() {
  return (
    <Frame label="Loading the listing" className="space-y-3">
      <TitleBar />
      <div className="grid items-start gap-3 sm:grid-cols-[1fr_2fr]">
        <div className="min-w-0 space-y-2">
          <Bone className="aspect-square w-full" />
          <Bone className="h-[93px] w-full" />
        </div>
        <Box className="h-[376px] space-y-3 p-3">
          <Line className="w-1/3" />
          <Bone className="h-8 w-1/2" />
          <Line className="w-2/3" />
          <Line className="w-1/2" />
          <Bone className="h-9 w-full" />
        </Box>
      </div>
      <Box className="space-y-1 p-3">
        <Line className="w-24" />
        <Line className="w-full" />
      </Box>
    </Frame>
  );
}

// An order: the title bar, the table of its details, then the box with what to do next.
export function OrderSkeleton() {
  return (
    <Frame label="Loading" className="mx-auto max-w-xl space-y-3">
      <TitleBar />
      <table className="w-full border-collapse bg-surface">
        <tbody>
          {Array.from({ length: 5 }, (_, i) => (
            <tr key={i}>
              <th className="w-32 border border-line bg-head p-1.5 text-left font-normal">
                <Line className="w-3/4" />
              </th>
              <td className="border border-line p-1.5">
                <Line className="w-1/2" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Box className="space-y-2 p-3">
        <Line className="w-2/3" />
        <Bone className="h-[calc(1lh+1rem)] w-32" />
      </Box>
    </Frame>
  );
}

// Contact support: the title bar, then the form (what it is about, the message, the button).
export function SupportSkeleton() {
  return (
    <Frame label="Loading" className="mx-auto max-w-xl space-y-3">
      <TitleBar />
      <Box className="space-y-3 p-4">
        <Bone className="h-[63px] w-full" />
        <Bone className="h-[163px] w-full" />
        <div className="text-xs">
          <Line className="w-1/2" />
        </div>
        <Bone className="h-9 w-16" />
      </Box>
    </Frame>
  );
}

// The listing form: new and edit, each a stack of blocks at the heights the real form's blocks have (photos, details, price, pickup, button).
const FORM_BLOCKS = {
  intro: ["h-[360px]", "h-[146px]", "h-[144px]", "h-[454px]", "h-[54px]"],
  heading: ["h-[806px]"],
} as const;

export function ListingFormSkeleton({ head }: { head: "intro" | "heading" }) {
  return (
    <Frame label="Loading" className="mx-auto max-w-xl space-y-2">
      {head === "intro" ? (
        <div className="text-muted">
          <Line className="w-full" />
          <Line className="w-1/2 sm:hidden" />
        </div>
      ) : (
        <div className="flex items-end justify-between">
          <Heading />
          <div className="mb-px w-24">
            <Line />
          </div>
        </div>
      )}
      <div className="space-y-3">
        {FORM_BLOCKS[head].map((height, i) => (
          <Bone key={i} className={`${height} w-full`} />
        ))}
      </div>
    </Frame>
  );
}
