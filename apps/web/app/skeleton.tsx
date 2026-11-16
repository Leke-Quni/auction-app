import type { ReactNode } from "react";
import { SidebarPage } from "./search/search-sidebar";

// What a page shows while it waits for the API, which can take several seconds when its machine has to wake up. Each route has a
// loading.tsx built from these, shaped like the page it stands in for (same width, same blocks), so the page that is left is never
// mistaken for the one that is coming, and nothing jumps when the real page arrives. The header and footer stay; only <main> changes.
export const Bone = ({ className = "" }: { className?: string }) => <div className={`animate-pulse rounded-control bg-line ${className}`} />;

function Frame({ label, className, children }: { label: string; className: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      {children}
    </div>
  );
}

const Card = ({ className = "", children }: { className?: string; children: ReactNode }) => <div className={`space-y-2 border border-line bg-surface p-3 ${className}`}>{children}</div>;

export function ListingCardsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-2 border border-line bg-surface p-2">
          <Bone className="aspect-square w-full" />
          <Bone className="h-4 w-3/4" />
          <Bone className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

// The home and search pages: the filter column and a grid of cards.
export function BrowseSkeleton({ title = true }: { title?: boolean }) {
  return (
    <Frame label="Loading" className="contents">
      <SidebarPage
        sidebar={
          <Card className="space-y-3">
            <Bone className="h-4 w-16" />
            {Array.from({ length: 5 }, (_, i) => (
              <Bone key={i} className="h-4 w-full" />
            ))}
            <Bone className="h-8 w-full" />
          </Card>
        }
      >
        {title && <Bone className="h-6 w-40" />}
        <ListingCardsSkeleton />
      </SidebarPage>
    </Frame>
  );
}

// A page of cards under a heading bar: the watchlist, a seller's listings.
export function CardsPageSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <Frame label={label} className="space-y-3">
      <Bone className="h-10 w-full" />
      <ListingCardsSkeleton count={4} />
    </Frame>
  );
}

// A list of rows under a heading: my listings, my orders.
export function ListPageSkeleton({ sections = 2 }: { sections?: number }) {
  return (
    <Frame label="Loading" className="space-y-3">
      <Bone className="h-6 w-40" />
      {Array.from({ length: sections }, (_, s) => (
        <div key={s} className="space-y-2">
          <Bone className="h-4 w-28" />
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 border border-line bg-surface p-2">
              <Bone className="size-14 shrink-0" />
              <div className="flex-1 space-y-2">
                <Bone className="h-4 w-2/3" />
                <Bone className="h-4 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </Frame>
  );
}

// A form or a single record in the narrow centred column most pages use.
export function NarrowPageSkeleton({ width = "max-w-xl", fields = 4 }: { width?: string; fields?: number }) {
  return (
    <Frame label="Loading" className={`mx-auto space-y-3 ${width}`}>
      <Bone className="h-10 w-full" />
      <Card className="space-y-4">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="space-y-1">
            <Bone className="h-3 w-24" />
            <Bone className="h-8 w-full" />
          </div>
        ))}
        <Bone className="h-9 w-32" />
      </Card>
    </Frame>
  );
}

// The listing page: title, a square photo beside the details, then the description.
export function ListingSkeleton() {
  return (
    <Frame label="Loading the listing" className="space-y-3">
      <Bone className="h-10 w-full" />
      <div className="grid items-start gap-3 sm:grid-cols-[1fr_2fr]">
        <div className="space-y-2">
          <Bone className="aspect-square w-full" />
          <Bone className="h-4 w-1/2" />
        </div>
        <Card className="space-y-3">
          <Bone className="h-4 w-1/3" />
          <Bone className="h-8 w-1/2" />
          <Bone className="h-4 w-2/3" />
          <Bone className="h-4 w-1/2" />
          <Bone className="h-9 w-full" />
        </Card>
      </div>
      <Card>
        <Bone className="h-4 w-24" />
        <Bone className="h-4 w-full" />
        <Bone className="h-4 w-5/6" />
      </Card>
    </Frame>
  );
}

// A seller's profile: the summary card, then their listings.
export function ProfileSkeleton() {
  return (
    <Frame label="Loading" className="space-y-3">
      <Card className="space-y-2">
        <Bone className="h-6 w-40" />
        <Bone className="h-4 w-56" />
      </Card>
      <Bone className="h-4 w-32" />
      <ListingCardsSkeleton count={4} />
    </Frame>
  );
}
