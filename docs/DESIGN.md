# Auction App: Design & Decisions

Status: design agreed with the owner in a grilling session on 2026-10-30. This file and `docs/decisions/` (section 7) are the source of truth for decisions and their reasons. If you need to deviate from it, ask the owner first and update this file. Endpoint lists, field lists and step-by-step build logs live in the code and tests, not here.

## 1. Product

- Portfolio/learning project built to production-quality standards. It is not expected to launch, so there is no legal, tax, or compliance work.
- Multi-seller marketplace: one account type, every user can buy and sell.
- Reference countries: Kosovo, Albania, North Macedonia. Stripe availability there is unverified (Kosovo unclear). Payment and shipping providers therefore sit behind interfaces so they can be swapped.
- Currency: EUR only. Language: English only. Prices are integer cents. Timestamps are UTC, displayed in the user's timezone. `next-intl` and ALL/MKD can be added later.

## 2. Auction rules

- Timed English auctions with an optional reserve price. Durations: 1, 3, 5, 7, or 30 days.
- Bids are manual and binding. No proxy/max bidding in v1 (it complicates bid logic a lot).
- Minimum next bid = `current + max(€1, 5% of current)`, the 5% rounded up to a whole cent; the first bid only needs to meet the starting price. The user types any amount at or above it; the UI shows the minimum as a hint and the API enforces it. The 5% is config. The rule lives in `packages/shared` so web and API agree. Examples: €10 → €11; €100 → €105; €1,000 → €1,050. Why: the owner rejected fixed tiers and wanted free-entry bids, but not +1 cent nudges.
- Anti-sniping (decided 2026-11-02): a bid in the last 2 minutes sets the end to 2 minutes after that bid, every time, so a bidding war keeps going. The only limit is a ceiling: the end can never pass 24 hours after the original end (start plus duration). The ceiling is not stored (`extensionCeiling`); `Listing.extensionCount` only counts extensions; "final chance" is the state where the end has reached the ceiling. Parameters are `ANTI_SNIPING` in `packages/shared`.
- Sellers cannot bid on their own items (shill bidding is the main fraud risk). The current high bidder cannot raise their own bid (`ALREADY_HIGHEST`).
- Bids are rate-limited and audit-logged (see section 7). Bidding requires a verified email only, no saved payment method. Two strikes block bidding.

## 3. Close and payment

- QStash schedules an idempotent close job per auction (rescheduled on extension), with a periodic sweep as safety net. Idempotency stops a duplicate delivery closing or charging twice.
- The winner gets an email and a pay-now page with 48 hours to pay by card. Why: the owner wants payment after the auction, not a pre-authorization (card holds expire in about 7 days). Before paying, the buyer enters a delivery address and picks a delivery option; the charge is item price plus delivery. Our carrier collects from the seller's pickup address, so the seller posts nothing.
- If the window expires: the non-payer gets a strike and the item is offered to the next bidder (see section 7). The seller can relist with one click.
- Platform fee: 5% of the item price, capped at EUR 50 per sale, taken from the seller. No listing fees or buyer premium. Delivery money is not part of the fee.
- `PaymentProvider` interface (checkout, confirm, refund, payout): Stripe test mode as the main implementation, in-memory fake for tests.
- `ShippingProvider` interface: a fake provider moves orders `label created → in transit → delivered` on a timer. The seller marks the item shipped. Payout is released 3 days after delivery, by the timer only; there is no early buyer confirmation (decided 2026-11-05). Why: no real carrier integration, since the project won't go live.

## 4. Features

- Listings with up to 8 images (under 5 MB each), uploaded straight from the browser to Vercel Blob. Photos are part of the listing form and are attached only when the seller presses Save; edit forms warn before the visitor leaves with unsaved changes. Details: `docs/decisions/listings-and-qa.md`.
- Fixed list of 10 seeded categories.
- **Search:** Typesense with typo tolerance, filters (category, conditions, price range, ending within 24 hours) and seven sorts; only live and upcoming auctions appear. Best match is the default sort with or without words (without words: the most active auctions first, as on the home page). The filter sidebar is shared by the home and search pages; the header search has filter chips, recent searches and suggestions. Searches are rate-limited and capped at 2,000 results. Details: `docs/decisions/tooling-hosting.md`.
- **Bidding on the listing page:** current bid, bid count, high bidder, minimum next bid, reserve status and the latest 5 bids, updated live over WebSocket. Every bid needs a second click and carries an idempotency key. Signed-out visitors, the seller, the high bidder and non-live auctions see a note instead of the box. Details: `docs/decisions/bidding.md`.
- **Main page:** "Ending soon" (live, ending within 24 hours) and "Upcoming" sections of 4 cards above the full list on page 1; empty sections are hidden.
- **Accounts:** names, a unique public username (real names stay private), sign-in by email with a code, settings for names, username, email, password and pickup address, forgot-password by emailed link. Details: `docs/decisions/accounts.md`.
- **Notifications:** outbid email plus a live toast with a one-click bid; a late bid that extends an auction shows a countdown jump, a banner and toasts, and the extension that reaches the ceiling is "Final chance to bid". No email goes to all bidders, to keep email volume low. Details: `docs/decisions/bidding.md`.
- **Emails** (Resend): outbid, won/pay-now, auction ended, payment confirmation, expiry, Q&A, and later ending-soon and shipping updates. Moving sends onto QStash was dropped (see section 7).
- **Contacting the seller:** public Q&A on the listing only. Private messages and an inbox are out of scope.
- Watchlist with "ending soon" emails; seller profiles with post-sale buyer ratings (slice 6).
- Report button on listings; admin app for moderation and the reports queue (slice 7).

Out of scope for v1: proxy bidding, buy-it-now, offers, private messages, push/SMS, nested categories, automated content moderation, real shipping carriers, multiple currencies or languages.

## 5. Architecture

Turborepo monorepo:

- `apps/web`: Next.js storefront (Vercel).
- `apps/admin`: separate Next.js app with its own theme and Vercel project. Uses admin-only API routes guarded by an `ADMIN` role in the API (never trust the UI). No public sign-up.
- `apps/api`: NestJS modular monolith with in-process domain events. Modules talk through interfaces and events, not each other's tables. Runs on a long-running container host because Vercel functions cannot hold WebSockets.
- `packages/db`: Prisma schema and client; the only package that imports Prisma.
- `packages/shared`: types, Zod schemas, bid and shipping rules.
- `packages/ui`: unstyled primitives (Tailwind + shadcn/ui); each app has its own theme tokens.
- `packages/config`: shared tsconfig and eslint.

Rules:

- Next.js apps get all data through the API and never touch Postgres.
- **Postgres decides each bid** (decided 2026-11-02, replacing a Redis Lua script plus reconciliation). One transaction locks the listing row, checks the minimum, saves the bid, and updates high bid and end time together. Why: Postgres is the only source of truth, with no gap to repair when the API machine stops. One hot auction tops out at a few hundred bids a second, far above need. Redis is used for rate limits and WebSocket fan-out. Bid placement sits behind one service so it can move later.
- Auth.js issues a JWT that NestJS verifies with the shared secret, for HTTP and WebSocket. Admin and storefront share the user table.
- Postgres on Neon; Redis and QStash on Upstash (NestJS needs standard TCP Redis).
- Typesense indexes only live and upcoming auctions; ended ones drop out.
- Zustand holds only live client state (high bid, bid feed). Server data goes through server components and a query library, with no duplication.

## Visual style

- Decided 2026-10-30 after comparing eBay, Yahoo Auctions Japan and ZenMarket mockups: dense, information-first layout like Yahoo Auctions Japan, facts in tables, compact spacing, a prominent bid input.
- Restyle (decided 2026-11-11, owner picked direction "B, soft modern"): warm off-white page, rounded cards and controls, Plus Jakarta Sans (storefront) and Inter (admin), colours as tokens in each app's `globals.css`, a wider home and search page with a filter sidebar, and dark mode. The step-by-step history is in `docs/DESIGN-SYSTEM.md`. The dense, information-first layout stays.
- Brand accent teal `#0f766e` (header, links, buttons, tags). Urgency uses its own red/orange so it stays distinct.
- Countdown: on the listing page it follows the server's clock (the API sends its time), so everyone agrees; cards count from the viewer's clock. Colour: green above 50% of total time left, orange from 50% to 10%, red at 10% or less.
- Each app has its own theme tokens. The admin theme is chosen (2026-11-05): light, slate and indigo. A white/grey table area, a dark slate sidebar (`#1f2433`), indigo accent (`#4f46e5`), amber/blue/green status pills; clearly different from the teal storefront.

## 6. Quality and process

- Unit tests (Vitest); integration tests against real Postgres and Redis in Docker; a concurrency test (50 simultaneous bids, exactly one wins); a few Playwright end-to-end tests (sign up, list, bid, win, pay).
- Playwright lives in `apps/e2e` (started 2026-11-06), run on demand against the local stack with `yarn workspace @auction/e2e e2e`; the sign-in code is swapped for a known one in the database because codes are stored hashed. `yarn test:local` runs the API tests on their own empty database `auction_test` (Redis database 1) so they do not share rows, locks or background sweeps with the dev database and the dev API (2026-11-06: against the dev database, 34 tests timed out or miscounted; on the clean one all 557 pass in about 80 seconds). CI starts from a fresh database anyway.
- GitHub Actions runs lint, typecheck and tests through Turborepo's cache on every PR.
- Environments: local (Docker Compose), preview (Vercel previews with a staging backend), production. Stripe in test mode everywhere.
- Seed script (`yarn workspace @auction/db seed [count] [--users N] [--owner <email>] [--allow-remote --confirm-host <host>]`): sample accounts and listings in every state plus named scenarios; `seed 0` removes it all; it refuses a non-local database without both remote flags. Bot bidder: `yarn workspace @auction/api bot <listingId>` bids through the HTTP API of a local API. Details: `docs/decisions/tooling-hosting.md`.

## 7. Decisions

Data model: designed per slice; see `packages/db/prisma/schema.prisma`. Upcoming/live/ended are derived from `startsAt`/`endsAt` (`listingPhase`); closing adds `closedAt` and `outcome`.

Decisions with their reasons and dates live in `docs/decisions/`, one file per area. Read the file for the area you are about to change before changing its behaviour; add new decisions to it.

- `admin.md`: admin app, roles and super admin, bans, strikes, listing and post removal, reports, question log, audit, invoices, order view, support and strike appeals.
- `accounts.md`: account basics, sign-in codes, session length, username, account deletion.
- `bidding.md`: bid transaction, listing-page bidding, realtime, notifications, rate limits, outbid email timing, reserve.
- `listings-and-qa.md`: listing lifecycle, photos in the form, public Q&A, reports on posts, the notification bell.
- `close-payment-delivery.md`: close, orders, Stripe, delivery, expiry and runner-up, QStash, shipping, payout, watchlist, ratings.
- `tooling-hosting.md`: test runner, Fly.io, speed, database pool, email, images, search, Typesense, seed script.

## 8. Build order and done-criteria

Thin vertical slices. Each works end to end, with tests passing, before the next starts.

1. **Monorepo, DB, auth.** Turborepo builds everything; Docker Compose runs Postgres and Redis; migrations run; sign-up, verify and sign-in work; NestJS verifies the Auth.js JWT; CI runs lint, typecheck, tests.
2. **Listings and images.** Create, edit and publish a listing with Blob images; categories seeded; listing pages render.
3. **Search.** Live and upcoming listings sync to the index; typo tolerance, filters, sorting; ended auctions drop out.
4. **Bidding and realtime.** Bids obey the minimum rule; live WebSocket updates; anti-sniping; outbid toast and email; 50-concurrent-bids test has exactly one winner; rate limits and audit log.
4b. **Contacting the seller.** Public Q&A with live notification and email, no self-questions, rate limits and reports.
5. **Auction close and payment.** QStash closes idempotently; winner gets the pay-now email, chooses delivery, pays in Stripe test mode, and gets a confirmation with PDF invoice; 48-hour expiry triggers the runner-up offer and strikes; fee applied; every outbid bidder gets one "you did not win" email.
6. **Shipping, payout, watchlist, ratings.** Seller marks a paid order shipped; the fake carrier advances it on a timer with shipping emails; payout is released 3 days after delivery (timer only) through `PaymentProvider.payout`; watchlist and "ending soon" emails; seller profiles with buyer ratings.
7. **Admin.** `apps/admin` (own theme and Vercel project, no public sign-up, `ADMIN`-guarded routes) supports moderation, the reports queue, clearing strikes, reading `QuestionLog` and an order with both addresses; a demoted admin or banned user loses access at once; the admin theme is chosen. Build order (decided 2026-11-05): (1) role and ban freshness in the API, `AdminGuard` and `GET /admin/me`; (2) the admin app shell, admin-only sign-in and the slate/indigo theme; (3) the reports queue and `QuestionLog`; (4) moderation: remove listings, ban and unban users, clear strikes; (5) reading an order with both addresses. Split from slice 6 on 2026-11-04.
