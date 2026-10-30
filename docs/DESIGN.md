# Auction App: Design & Decisions

Status: design agreed with the owner in a grilling session on 2026-10-30. No code written yet. This file is the source of truth. If you need to deviate from it, ask the owner first and update this file.

## 1. Product

- Portfolio/learning project built to production-quality standards. It is not expected to launch, so there is no legal, tax, or compliance work. Why: the owner doesn't expect it to go live.
- Multi-seller marketplace: one account type, every user can buy and sell.
- Reference countries: Kosovo, Albania, North Macedonia. Stripe availability there is unverified (third-party lists show Albania and North Macedonia for Connect payouts, Kosovo unclear; official list not checked). Why this matters: payment and shipping providers sit behind interfaces so they can be swapped.
- Currency: EUR only. Language: English only. Prices are stored as integer cents. All timestamps are UTC, displayed in the user's timezone. `next-intl` and ALL/MKD can be added later.

## 2. Auction rules

- Timed English auctions with an optional reserve price.
- Durations: 1, 3, 5, 7, or 30 days (1 month; added 2026-10-30).
- Bids are manual and binding. No proxy/max bidding in v1 (it complicates bid logic a lot).
- Minimum next bid = `current + max(€1, 5% of current)`, no rounding (cent precision). The user types any amount at or above it. The UI shows the minimum as a hint and the API enforces it. The first bid only needs to meet the starting price. The 5% is a config value. The rule lives in `packages/shared` so web and API apply the same logic. Why: the owner rejected fixed tiers and wanted free-entry bids, but not +1 cent nudges.
  - Examples: current €10 → min €11; €100 → €105; €1,000 → €1,050.
- Anti-sniping: a bid in the last few minutes extends the end time.
- Sellers cannot bid on their own items (shill-bidding is the main fraud risk).
- Bids are rate-limited (per user and per IP, in Redis) and audit-logged with user ID and IP.
- Bidding requires a verified email only (no saved payment method).

## 3. Close and payment

- QStash schedules an idempotent close job per auction (rescheduled on extension), plus a periodic sweep as a safety net. Idempotency prevents a duplicate delivery from closing or charging twice.
- The winner gets an email and a pay-now page with 48 hours to pay by card. Why: the owner wants payment sorted after the auction ends, not a pre-authorization (card holds expire in about 7 days).
- If the window expires: the item is offered to the second-highest bidder, and the non-payer gets a strike. Two strikes blocks bidding. The seller can relist with one click.
- The platform takes a configurable percentage from the seller (no listing fees or buyer premium).
- `PaymentProvider` interface (checkout session create/confirm, refund, payout): Stripe test mode as the main implementation, in-memory fake for tests.
- `ShippingProvider` interface: fake provider that moves orders `label created → in transit → delivered` on a timer. The seller marks the item shipped. Payout is released after delivery or buyer confirmation. Why: no real carrier integration, since the project won't go live.

## 4. Features

- Listings with up to 8 images (under 5 MB each), uploaded straight from the browser to Vercel Blob via signed tokens, so large files never pass through our server.
- Search: Typesense Cloud with typo tolerance, filters (category, condition, price range, ending soon), and sorting (ending soonest, newest, most bids, price). Possible later: geo search, autocomplete, synonyms, semantic search.
- Fixed list of about 10 seeded categories.
- Watchlist with "ending soon" emails.
- Seller profiles with post-sale ratings from the buyer.
- Users have a first name, last name, and username. The username is the public handle (header, later listings and bids); real names stay private. Usernames are 3-20 characters that may contain lowercase letters, numbers, and underscores (none required), unique, with a few reserved names (such as `admin`) blocked, and can be changed any time. Sign-in is by email, not username.
- Account settings (`/account/settings`): change first/last name, username, email, and password. Changing the email or password needs the current password, and an email change is confirmed with a 6-digit code sent to the new address. Every place a new password is entered (sign-up, change, reset) asks for it twice. Forgot password emails a link that expires after 1 hour and works once; using it also verifies the email and does not sign the user in.
- Outbid notifications: email, plus an in-app realtime toast ("You've been outbid") with a one-click bid action.
- Emails (Resend, sent via QStash so a slow provider never blocks a bid): outbid, won, pay-now, ending soon (watchlist), shipping updates.
- Report button on listings.
- Admin app: moderation (remove listings, ban users) and reports queue.

Out of scope for v1: proxy bidding, buy-it-now, offers, messaging, push/SMS, nested categories, automated content moderation, real shipping carriers, multiple currencies or languages.

## 5. Architecture

Turborepo monorepo:

- `apps/web`: Next.js storefront (Vercel).
- `apps/admin`: separate Next.js app with its own theme (own Vercel project). Calls the same API through admin-only routes guarded by an `ADMIN` role in the API (never trust the UI). No public sign-up.
- `apps/api`: NestJS modular monolith (auctions, bidding, payments, users, notifications) with in-process domain events (`BidPlaced`, `AuctionClosed`, `AuctionExtended`) and a transactional outbox delivered through QStash. Modules talk through interfaces and events, not by reaching into each other's tables. Hosted on a long-running container host for native WebSockets with the Redis adapter. Why: Vercel functions cannot hold persistent WebSockets.
- `packages/db`: Prisma schema and client. Only this package imports Prisma.
- `packages/shared`: types, Zod schemas, bid rules.
- `packages/ui`: shared unstyled primitives (Tailwind + shadcn/ui). Each app has its own theme tokens (storefront consumer-friendly, admin dense and table-heavy).
- `packages/config`: shared tsconfig and eslint.

Data flow and rules:

- Next.js apps get all data through the API and never touch Postgres directly.
- Bid path: Redis decides the bid atomically (Lua script), Postgres persists every accepted bid, and a reconciliation job repairs gaps. Why: without an atomic check, two simultaneous bids could both win.
- Auth.js (free) issues a JWT that NestJS verifies with the shared secret, for HTTP and WebSocket connections. Admin and storefront share the user table; admins have `role = ADMIN`.
- Postgres on Neon. Redis and QStash on Upstash (NestJS needs a standard TCP Redis connection for the websocket adapter). Why: the owner doesn't care which, and this fits Vercel and QStash.
- Typesense Cloud indexes only live and upcoming auctions, synced from Postgres via the outbox. Ended auctions drop out. Price refresh is throttled to every few seconds per auction.
- Zustand holds only live client state (current high bid, bid feed over the WebSocket). Server data goes through server components and a query library, with no duplication in Zustand.

## Visual style

- Decided with the owner on 2026-10-30, after comparing mockups inspired by eBay, Yahoo Auctions Japan, and ZenMarket.
- Dense, information-first layout in the style of Yahoo Auctions Japan: facts in tables (price, bids, watchers, time left, auto-extension, minimum next bid), compact spacing, and a prominent bid input with a place-bid button.
- Brand accent: teal `#0f766e`, used for the header, links, buttons, and tags.
- Urgency (ending soon, final minutes) uses its own red/orange colour, separate from the brand accent, so it stays distinct whatever the brand colour is.
- The countdown is one shared timer synced to the server, so the listing page and bid history never disagree.
- Each app still has its own theme tokens (section 5). The admin theme is not chosen yet.

## 6. Quality and process

- Unit tests; integration tests against real Postgres and Redis in Docker; a concurrency test (50 simultaneous bids, exactly one wins); a few Playwright end-to-end tests (sign up, list, bid, win, pay).
- GitHub Actions runs lint, typecheck, and tests through Turborepo's cache on every PR.
- Environments: local (Docker Compose for Postgres and Redis), preview (Vercel previews with a staging backend), production. Stripe in test mode everywhere.
- Seed script: users, listings with images, auctions in every state (upcoming, live, ending in 1 minute, ended), simulated bidders. Plus a bot-bidder dev script that bids on a chosen auction so realtime can be watched solo.

## 7. Open decisions (decide in the relevant slice, then record here)

- Data model: tables, fields, and indexes. Designed per slice. Slice 1 added `User` (id, unique email, first name, last name, unique lowercase username, password hash, `emailVerified`, `role` of `USER` or `ADMIN`, timestamps) and `LoginCode` (user, HMAC of the 6-digit code, expiry, failed-attempt count). Auth.js uses JWT sessions with email and password, so it has no `Account` or `Session` tables. Slice 2 added `Category` (10 rows inserted by the migration: Collectibles, Watches & Jewelry, Electronics, Fashion, Home & Garden, Art, Books & Media, Toys & Games, Sports & Outdoors, Other), `Listing` (seller, title, description, category, condition of `NEW`/`LIKE_NEW`/`GOOD`/`FAIR`/`POOR`, starting price and optional reserve in cents, duration of 1/3/5/7/30 days, `status` of `DRAFT` or `PUBLISHED`, `startsAt`/`endsAt`/`publishedAt`) and `ListingImage` (listing, URL, position; position 0 is the cover). Upcoming, live, and ended are derived from `startsAt` and `endsAt` (`listingPhase` in `packages/shared`); slice 5 adds the closed state. Extend per slice.
- Role freshness: the role is copied into a 30-day session JWT at sign-in, and the API trusts it. Before slice 6 (admin) or any ban feature, decide how the API gets a current role (for example, reading it from the database for admin routes) so a demoted admin or banned user doesn't keep access.
- Sign-in: **an emailed 6-digit code on every sign-in** (decided 2026-10-30, replacing the sign-up verification link). Sign-up sends a code straight away and goes to the code page, so a new user does not re-enter credentials. Later sign-ins are two steps: password, then the code. A correct code verifies the email, so every signed-in user has a verified email. Codes expire after 10 minutes, are single-use, lock after 5 wrong attempts, and a new code voids the old one. Signing up again with an unverified email replaces that account's name and password and voids its code, so nobody can block an address they don't own; a verified email returns 409. Not built yet: a cooldown on requesting codes (email flooding); add it with the slice 4 rate limits.
- Username squatting: an unverified sign-up holds its username until it is replaced or deleted, so someone could hold handles without verifying. Decide on a cleanup rule for stale unverified accounts (for example, delete after a few days) before launch.
- Email sending: the API sends through Resend directly for now (`RESEND_API_KEY`, `MAIL_FROM`); moving sends behind QStash, as planned in section 4, comes with the notification work in slices 4 and 5. Without a verified domain Resend's sandbox sender `onboarding@resend.dev` delivers only to the Resend account's own email address, so other users can't receive codes until a domain is verified. In production the API refuses to start without a key rather than print codes to the log. A failed send returns 503.
- Query library for server data: React Query or SWR.
- Test runner: **Vitest** (decided 2026-10-30, slice 1).
- Package manager: **Yarn 4** with the `node-modules` linker (decided 2026-10-30, slice 1). Docker Desktop provides local Postgres and Redis.
- API host: **Fly.io on the free trial, no payment card** (decided 2026-10-30). App `auction-api-leke`, region `fra` (Frankfurt, next to the Neon database), deployed from `apps/api/Dockerfile` with `fly deploy -c apps/api/fly.toml --ha=false`. The trial stops the machine 5 minutes after each start, and Fly's proxy starts it again on the next request, which adds about 3 to 4 seconds for that request. This is accepted for testing and the owner will not add a card. Consequence for slice 4: the API can disappear mid-request at any time, so bidding must tolerate it the same way it tolerates a dropped connection (idempotency key on every bid, re-check state after a failure, auto-reconnect with resync of the live feed, no state held only in API memory). Other hosting: web on Vercel (`auction-web`), database on Neon (Frankfurt), email through Resend.
- Anti-sniping parameters (window length and extension length).
- Reserve price: **the amount is visible to everyone** on the listing (decided 2026-10-30, slice 2). If it is not met when the auction closes there is no sale and the seller can relist (applied in slice 5).
- Listing lifecycle: a seller saves a draft, adds photos, then publishes either now or at a start time up to 30 days ahead; the end time is fixed at publish (`startsAt` plus the duration). Drafts are private to the seller and fully editable. After publishing, only the description and photos can change (at least one photo must stay). Only drafts can be deleted. (Decided 2026-10-30, slice 2.)
- Images: a **public** Vercel Blob store. The browser uploads straight to Blob using a token from `apps/web/app/api/uploads` (sign-in required, own folder `listings/<userId>/`, JPG/PNG/WebP, 5 MB). The API accepts only photo URLs on a `*.public.blob.vercel-storage.com` host inside the seller's own folder, and deletes removed photos from Blob. Needs `BLOB_READ_WRITE_TOKEN`.
- Platform fee percentage and the delay before seller payout.
- Exact definition of the "strike" lifecycle (expiry, appeals).

## 8. Build order and done-criteria

Work in thin vertical slices. Each slice works end to end, with tests passing, before the next starts.

1. **Monorepo, DB, auth.** Done when: Turborepo builds all apps and packages; Docker Compose brings up Postgres and Redis; Prisma migrations run; a user can sign up, verify email, and sign in on `apps/web`; NestJS verifies the Auth.js JWT on a protected route; CI runs lint, typecheck, and tests.
2. **Listings and images.** Done when: a seller can create, edit, and publish a listing with images uploaded to Vercel Blob; categories are seeded; listing pages render.
3. **Search.** Done when: live and upcoming listings sync to Typesense; search has typo tolerance, filters, and sorting; ended auctions drop out of the index.
4. **Bidding and realtime.** Done when: users can place bids that obey the minimum rule; the page updates live over WebSocket; anti-sniping works; the outbid toast and email fire; the 50-concurrent-bids test passes with exactly one winner; rate limits and audit logging are in place.
5. **Auction close and payment.** Done when: QStash closes auctions idempotently; the winner receives the pay-now email and can pay in Stripe test mode; the 48-hour expiry triggers the second-bidder offer and strikes; the platform fee is applied.
6. **Shipping, notifications, admin.** Done when: the fake shipping flow completes an order and releases payout; the watchlist, "ending soon" emails, and seller ratings work; `apps/admin` supports moderation and the reports queue behind the `ADMIN` role.
