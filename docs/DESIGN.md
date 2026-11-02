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
- Anti-sniping, in two steps and no more (decided 2026-11-02, slice 4): the first bid in the last 5 minutes sets the end time to 15 minutes after that bid; then, once that has happened, a bid in the last 60 seconds sets it to 5 minutes after that bid. After those two extensions the end time never moves again, so an auction cannot be extended for ever. A bid earlier than the window leaves the end time alone.
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
- Search: Typesense (self-hosted, see section 7) with typo tolerance, filters (category, condition, price range, ending soon), and sorting (ending soonest, newest, most bids, price). Possible later: geo search, autocomplete, semantic search.
- Fixed list of about 10 seeded categories.
- Search page (added 2026-11-02, slice 3): `GET /search` (API) and `/search` (web). Filters: category, condition, a price range (in euros on the page, cents in the API), and "ending within 24 hours". Sorts: best match, ending soonest, newest, most bids, price both ways; with text the default is best match, without it newest first. Typo tolerance and partial words come from Typesense: 1 typo from 4 letters, 2 from 6 (its maximum), and three or more of the same letter in a row are cut to two before searching. Synonyms (added 2026-11-02) are listed in `apps/api/src/search/synonyms.ts` and pushed to Typesense when the API starts: a general word such as "shoes" also finds sneakers, boots and similar, one way only, and spellings such as "watercolor" match "watercolour". This needs Typesense 30 or newer (its synonym sets API). Only live and upcoming auctions appear. The search page and the home page share a sidebar of categories and filters (price slider plus typed boxes, sort applies at once, the rest on Apply; both lead to /search); the header search shows the text, keeps the filters when searching again, and lists them as chips that each remove one filter. The header search is left out of the sign-in, sign-up and password pages. Search is unavailable (503) when Typesense is down.
- Main page (added 2026-11-02, slice 2): "Ending soon" (live auctions ending within 24 hours, soonest first) and "Upcoming" (not started yet, soonest start first) sections of 4 cards each sit above the full list on page 1. A section with no auctions is hidden. `GET /listings` takes an optional `section=endingSoon|upcoming` for this. Slice 3 search may replace it.
- Watchlist with "ending soon" emails.
- Seller profiles with post-sale ratings from the buyer.
- Users have a first name, last name, and username. The username is the public handle (header, later listings and bids); real names stay private. Usernames are 3-20 characters that may contain lowercase letters, numbers, and underscores (none required), unique, with a few reserved names (such as `admin`) blocked, and can be changed any time. Sign-in is by email, not username.
- Account settings (`/account/settings`): change first/last name, username, email, and password. Changing the email or password needs the current password, and an email change is confirmed with a 6-digit code sent to the new address. Every place a new password is entered (sign-up, change, reset) asks for it twice. Forgot password emails a link that expires after 1 hour and works once; using it also verifies the email and does not sign the user in.
- Outbid notifications: email, plus an in-app realtime toast ("You've been outbid") with a one-click bid action.
- Auction-extended notices (decided 2026-11-02, slice 4): when a late bid moves the end time, everyone viewing the listing sees it live (the countdown jumps and a banner shows the new end time); the bidder who was just outbid gets their usual outbid email and toast, now with the new end time; every other bidder on that auction who is signed in elsewhere on the site gets an in-app toast. The second and last extension is marked more strongly: a banner in the urgency colour, "Final chance to bid. This auction cannot be extended again.", stays on the listing page for the rest of the auction (it shows after a reload too, since it follows `Listing.extensionCount` reaching 2), and the toast for other bidders says "Final chance to bid". There is deliberately no email to the top 10 or to all bidders (the owner's choice, to keep email volume low); an auction now extends at most twice, so these notices happen at most twice per auction.
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
- Bid path: **Postgres decides** (decided 2026-11-02, slice 4, replacing the earlier plan of a Redis Lua script plus a reconciliation job). A bid runs in one database transaction that locks the listing row, checks the minimum, saves the bid, and updates the high bid and end time together, so two simultaneous bids cannot both win and a bid is never accepted but unsaved. Why: Postgres is then the only source of truth, with no gap to repair when the API machine stops (the Fly trial does every 5 minutes); one hot auction is limited to a few hundred bids a second by the row lock, which is far above what this project needs. Redis is still used for rate limits and WebSocket fan-out. Bid placement sits behind one service, so it can move to Redis later if load ever needs it.
- Auth.js (free) issues a JWT that NestJS verifies with the shared secret, for HTTP and WebSocket connections. Admin and storefront share the user table; admins have `role = ADMIN`.
- Postgres on Neon. Redis and QStash on Upstash (NestJS needs a standard TCP Redis connection for the websocket adapter). Why: the owner doesn't care which, and this fits Vercel and QStash.
- Typesense indexes only live and upcoming auctions, synced from Postgres via the outbox. Ended auctions drop out. Price refresh is throttled to every few seconds per auction.
- Zustand holds only live client state (current high bid, bid feed over the WebSocket). Server data goes through server components and a query library, with no duplication in Zustand.

## Visual style

- Decided with the owner on 2026-10-30, after comparing mockups inspired by eBay, Yahoo Auctions Japan, and ZenMarket.
- Dense, information-first layout in the style of Yahoo Auctions Japan: facts in tables (price, bids, watchers, time left, auto-extension, minimum next bid), compact spacing, and a prominent bid input with a place-bid button.
- Brand accent: teal `#0f766e`, used for the header, links, buttons, and tags.
- Urgency (ending soon, final minutes) uses its own red/orange colour, separate from the brand accent, so it stays distinct whatever the brand colour is.
- The countdown is one shared timer synced to the server, so the listing page and bid history never disagree. Until slice 4 it counts from the browser clock.
- Countdown colour (added 2026-11-02): green while more than 50% of the auction's total time is left, orange from 50% down to 10%, and the urgency red at 10% or less. On the main page's cards it shows alone; on the listing page it is a "Time left" row for live auctions.
- Each app still has its own theme tokens (section 5). The admin theme is not chosen yet.

## 6. Quality and process

- Unit tests; integration tests against real Postgres and Redis in Docker; a concurrency test (50 simultaneous bids, exactly one wins); a few Playwright end-to-end tests (sign up, list, bid, win, pay).
- GitHub Actions runs lint, typecheck, and tests through Turborepo's cache on every PR.
- Environments: local (Docker Compose for Postgres and Redis), preview (Vercel previews with a staging backend), production. Stripe in test mode everywhere.
- Seed script: users, listings with images, auctions in every state (upcoming, live, ending in 1 minute, ended), simulated bidders. Plus a bot-bidder dev script that bids on a chosen auction so realtime can be watched solo. Built so far (2026-11-02): `yarn workspace @auction/db seed [count]` (default 1000, up to 20000, 0 removes it) creates 40 sample sellers (emails ending `@seed.local`, passwords that cannot sign in) and listings across all categories, conditions, prices and states; re-running replaces only its own data, and it refuses to run unless the database is local. Run `yarn workspace @auction/api reindex` afterwards. Bids and bidders come with slice 4.

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
- Anti-sniping parameters: **step 1: 5-minute window, 15-minute extension; step 2 (only after step 1): 60-second window, 5-minute extension; then no more** (decided 2026-11-02, slice 4; the owner first chose a flat 15 minutes with no cap and then bounded it at two extensions). The steps are `ANTI_SNIPING_STEPS` in `packages/shared`, and `Listing.extensionCount` (0 to 2, checked by the database) records how many an auction has used.
- Bid rule details (decided 2026-11-02, slice 4): the minimum next bid is `current + max(€1, 5% of current)` with the 5% rounded up to a whole cent, and the first bid only needs to meet the starting price. A bid must be at or above the minimum; a seller cannot bid on their own listing; only live auctions take bids; you cannot outbid yourself while you hold the high bid; bids are binding. Every bid carries an idempotency key, unique per bidder, so a retry after a dropped connection or a stopped API cannot place it twice. Bid API (slice 4, step 2): `POST /listings/:id/bids` with `{ amountCents, idempotencyKey }` (sign-in required) answers 201 for a new bid and 200 with `replayed: true` for a retry of one that already went through; a refusal carries a `code` and, for a bid below the minimum, `minimumNextBidCents`: 404 `NOT_FOUND`, 403 `OWN_LISTING`, 409 `NOT_LIVE` / `ALREADY_HIGHEST` / `IDEMPOTENCY_KEY_REUSED`, 422 `TOO_LOW`. `GET /listings/:id/bids` is the public history, highest first, with bidder usernames. A listing that has a bid cannot be removed (409). The search index shows the current bid and bid count when a listing is next synced; updating it on every bid (throttled) is step 7.
- Reserve price: **the amount is visible to everyone** on the listing (decided 2026-10-30, slice 2). If it is not met when the auction closes there is no sale and the seller can relist (applied in slice 5).
- Listing lifecycle: a seller saves a draft, adds photos, then publishes either now or at a start time up to 30 days ahead; the end time is fixed at publish (`startsAt` plus the duration). Drafts are private to the seller and fully editable. After publishing, only the description and photos can change (at least one photo must stay). A draft can be deleted, and a seller can remove a published listing (deleting it, its photos, and its search entry) until it has a bid (checked and deleted in one statement, so a bid that lands at the same moment is never deleted with the listing). (Decided 2026-10-30, slice 2; removal of published listings added 2026-11-02.)
- Images: a **public** Vercel Blob store, used with OIDC and **presigned uploads** (no long-lived read-write token exists; decided 2026-10-30). The browser uploads straight to Blob using a short-lived upload URL from `apps/web/app/api/uploads` (sign-in required, own folder `listings/<userId>/`, JPG/PNG/WebP, 5 MB, 10-minute lifetime). The API accepts only photo URLs on a `*.public.blob.vercel-storage.com` host inside the seller's own folder, and reports which photos a change removed; the **web app** deletes them from Blob, because OIDC only works on Vercel and the API runs on Fly. Locally, `npx vercel link` and `npx vercel env pull apps/web/.env.local` provide `BLOB_STORE_ID`, `BLOB_WEBHOOK_PUBLIC_KEY` and a 12-hour `VERCEL_OIDC_TOKEN`.
- Search host: **self-hosted Typesense in Docker Compose, not Typesense Cloud** (decided 2026-11-02, slice 3). Cloud's free allowance is 720 hours (about 30 days of one cluster), one time per account, and it then bills; whether signup needs a card is unconfirmed. The owner won't add a card. The Fly trial machine stops every 5 minutes, so it cannot host Typesense either. The code talks to Typesense through a `SearchIndex` interface and a URL and key from config, so a Cloud cluster can be swapped in later without code changes. Deployed environments have no search until then.
- Search index sync: **direct from the API, not through the outbox** (decided 2026-11-02, slice 3). The outbox and QStash delivery do not exist yet, so after a listing is saved the API updates Typesense itself (`syncSearch` in `ListingsService`). A search outage never fails the request: it is logged, and a sweep (at start-up and every 5 minutes, which also drops ended auctions) plus `yarn workspace @auction/api reindex` repair the gap. Searches also filter out ended auctions by end time, so a missed sweep never shows one. Move the sync onto the outbox when the notification work in slices 4 and 5 builds it, and add the live price and bid count (throttled, as in section 5) then.
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
