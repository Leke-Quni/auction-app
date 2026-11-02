# Slice 4 (bidding and realtime): handoff

For an agent picking this slice up. Read `CLAUDE.md` and `docs/DESIGN.md` first; `DESIGN.md` is the source of truth and already records every decision below. This file says what is built, what is left, and what to watch for.

## Working rules (from the owner)
- **Never commit, push or delete files unless asked.** When asked to commit, make separate commits per piece of work, and end each message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **One step at a time.** Finish a step, run the checks, then **stop** so the owner can test, change or remove it. Do not start the next step until told to.
- Do not deviate from `DESIGN.md` without asking the owner; when a decision is made, write it into `DESIGN.md` (section 7) the same day.
- Match the surrounding style, keep changes minimal, no comments that restate the code.
- Report test failures honestly. Free tiers only, no card (the owner will not pay).
- `apps/web` runs a Next.js version that differs from older ones: read the docs in `node_modules/next/dist/docs/` before writing Next code (see `apps/web/AGENTS.md`).

## Slice 4 goal (`DESIGN.md` section 8)
Done when: users can place bids that obey the minimum rule; the page updates live over WebSocket; anti-sniping works; the outbid toast and email fire; the 50-concurrent-bids test passes with exactly one winner; rate limits and audit logging are in place.

## Decisions already made (all in `DESIGN.md`)
- **Postgres decides** between simultaneous bids, in one transaction that locks the listing row (not the Redis Lua script the design first described). Redis is for rate limits and WebSocket fan-out.
- **Minimum next bid** = current + max(EUR 1, 5% of current, rounded up to the cent); the first bid needs only the starting price.
- **Anti-sniping, two steps and no more:** first bid in the last 5 minutes sets the end to 15 minutes after that bid; then a bid in the last 60 seconds sets it to 5 minutes after that bid; then it never moves again. `Listing.extensionCount` (0 to 2) records it.
- Rules: the seller cannot bid; only live auctions; the high bidder cannot bid again (refused `ALREADY_HIGHEST`, by design); bids are binding; every bid has an idempotency key unique per bidder.
- **Extension notices:** everyone viewing the page sees it live (countdown jumps, banner with the new end time); the bidder just outbid gets the normal outbid email and toast with the new end time; every other bidder on that auction who is signed in elsewhere gets an in-app toast; **no email to the top 10 or all bidders**. The second (last) extension is marked "Final chance to bid. This auction cannot be extended again." in the urgency colour, kept on the page for the rest of the auction (it follows `extensionCount === 2`), and the toast for other bidders says "Final chance to bid".
- A listing or account that has bids cannot be deleted (database `Restrict`); a bid is at most EUR 10,000,000 (`MAX_BID_CENTS`).

## Built so far (branch `slice-4-bidding`, on top of `main`)
| Step | Commit | What |
|---|---|---|
| 1. Rules and data model | `46a161e` | `packages/shared/src/bids.ts` (minimum rule, `endsAtAfterBid`, `placeBidSchema`, refusal codes, `isFinalChance`); Prisma `Bid`, `BidAudit`, and `Listing.currentBidCents / bidCount / highBidderId / extensionCount`; migrations with CHECK constraints |
| (card tag) | `6fb81d8` | Yellow "Final chance to bid" tag on listing cards (`apps/web/app/listing-card.tsx`) |
| 2. Place-a-bid API | `be06e5f` | `apps/api/src/bids/` (`BidsService.placeBid`, controller, module): `POST /listings/:id/bids` (201 new, 200 replay), `GET /listings/:id/bids` (public history, highest first); listing data carries current bid, bid count, minimum next bid, high bidder; removal of a listing with bids refused (one conditional delete) |
| Hardening | `88a33e6` | Review fixes: database `Restrict` deletes, high-bidder CHECK, draft-only edit write, bid cap, 404/503 mapping (`bidFailure`), seed and test cleanup delete bids first |
| 3. Listing page | next commit | `apps/web/app/listings/[id]/` (`page.tsx`, `bid-panel.tsx`, `bid-history.tsx`, `bid-actions.ts` server action); countdown follows the server clock (`serverTime` in the listing data); cards show "current bid" and the bid count; search results carry `currentBidCents` |

State of the dev database: 20,003 listings from the seed (sample sellers have emails ending `@seed.local`), **no bids**, and 36 sample listings have `extensionCount = 2` so the card tag has data.

## What is left (do in this order, stopping after each)

### Step 4. Realtime
- Add deps (none installed yet): `@nestjs/websockets`, `@nestjs/platform-socket.io`, `@socket.io/redis-adapter` and a Redis client in `apps/api`; `socket.io-client` and `zustand` in `apps/web`. Redis already runs (`docker-compose.yml`, `REDIS_URL` in `.env.example`, a service in CI) but no code uses it yet.
- A gateway with rooms `auction:<listingId>` (everyone viewing) and `user:<userId>` (private). Events at least: `bid:placed` (listing id, current bid, bid count, high bidder `{id, username}`, `endsAt`, `extensionCount`, minimum next bid, server time, and the bid row for the history table) and `auction:extended` (with `extensionCount`).
- Emit **after** the transaction commits, from the result of `BidsService.placeBid` (`BidResult` already has `extended` and `previousHighBidderId`). The design names in-process domain events `BidPlaced` and `AuctionExtended`; keep `BidsService` free of socket code.
- **Auth for the socket:** the browser cannot read the Auth.js session JWT (httpOnly). Add a web route (for example `apps/web/app/api/realtime-token/route.ts`) that, for a signed-in user, returns a short-lived HS256 JWT built with `encodeJwt` from `apps/web/lib/jwt.ts`; the gateway verifies it like `authenticate()` in `apps/api/src/auth/jwt-auth.guard.ts` (it is not exported yet; export or share it). Spectators may join `auction:<id>` without a token; `user:<id>` needs one. Allow the web origin in CORS (`webUrl()` in `apps/api/src/config.ts`).
- **Web:** a Zustand store holding only live client state (current high bid, bid feed) as the design says; the listing page (`page.tsx` is a server component, `BidPanel` already calls `router.refresh()` after your own bid) should update price, bid count, high bidder, minimum next bid, history, end time, and show the extension and final-chance banners live. `Countdown` (`apps/web/app/countdown.tsx`) takes `iso` and `serverNowIso`.
- **Fly trial constraint:** the API machine stops every 5 minutes. The client must auto-reconnect and **resync** (refetch `/listings/:id` and `/listings/:id/bids`) after every reconnect; no state may live only in API memory.
- Tests: two socket clients receive the same event; reconnect resyncs; a spectator cannot join a user room.

### Step 5. Outbid and extension notifications
- Outbid email through the existing `MAIL_SENDER` (`apps/api/src/email/`; with no `RESEND_API_KEY` it prints to the API log; the Resend sandbox sender only delivers to the account owner's own address). Include the new end time when the bid extended the auction.
- In-app toast on `user:<id>` ("You've been outbid") with a **one-click bid action** (bids the current minimum through `placeBidAction`); a toast for other signed-in bidders on an extension ("Final chance to bid" on the second). There is no toast component yet. **No** email to the top 10 or to all bidders.

### Step 6. Rate limits, audit log, login-code cooldown
- Redis limiter per user (start at 10 bids/minute) and per IP (30/minute); throw `refusal("RATE_LIMITED")` (already defined, 429).
- Write one `BidAudit` row for **every** attempt, accepted or refused, with user id, IP, listing, amount, outcome and reason. The table and indexes exist; nothing writes to it yet.
- **Real client IP:** today `Bid.ip` is the **web server's** address, because `placeBidAction` calls the API from the server. Forward the viewer's address (for example `X-Forwarded-For` from `next/headers` in `bid-actions.ts`) and set Express `trust proxy` appropriately in `apps/api/src/main.ts`.
- The cooldown on requesting login codes that `DESIGN.md` flagged "add with the slice 4 rate limits" (`apps/api/src/auth/auth.service.ts`).

### Step 7. Keep the search index current
- On each bid update the Typesense document (`price_cents`, `bid_count`, `extension_count`, `ends_at`); `toDocument` in `apps/api/src/listings/listings.service.ts` already builds them from the listing, but `syncSearch` is private and only runs on listing edits. The design says to throttle price refreshes to every few seconds per auction, **but an extension must update `ends_at` immediately**: otherwise the 5-minute sweep (`removeEnded`) and the `ends_at > now` search filter drop a still-live extended auction from search after its original end time.
- "Most bids" sorting becomes meaningful here.

### Step 8. Seed and bot
- Extend `packages/db/src/seed.ts` with bids from sample users on live listings, keeping the Listing fields consistent (the CHECK constraints enforce it). `seed-guard.ts` must keep refusing non-local databases.
- A bot-bidder dev script that bids on a chosen auction every few seconds **through the HTTP API** (mint an HS256 JWT with `AUTH_SECRET` for a sample user) so the realtime path is exercised. Removing sample data must delete bids first and reset any real listing a sample user was leading (a listing's high bidder and any bid is `Restrict`ed from deletion).

## Open questions for the owner
- Should the current high bidder be allowed to raise their own bid? Today it is refused (`ALREADY_HIGHEST`); the owner's wording was ambiguous. Ask before changing it.
- Set an explicit Prisma pool size and test pool starvation / the 15-second transaction timeout (review finding, not done).

## How to work in this repo
- **Checks:** `yarn typecheck`, `yarn lint`, `yarn test` (`yarn test --force` ignores the Turborepo cache). Docker must be running: `docker compose up -d` starts Postgres, Redis and Typesense. `yarn dev` runs web (3000), API (4000) and admin (3001).
- **API tests use the shared dev database.** They create their own users and listings with a unique stamp and must clean up **bids, then listings, then users** (deletes are `Restrict`ed). See `apps/api/test/bids.e2e.test.ts` and `bids-guarantees.e2e.test.ts`: users are inserted with Prisma and tokens signed with `SignJWT` and `authSecret()`, which is far faster than signing up through the API.
- **Migrations:** edit `packages/db/prisma/schema.prisma`, `yarn workspace @auction/db migrate:dev --name <name> --create-only`, add raw SQL (CHECK constraints) to the generated file, then `yarn workspace @auction/db migrate:deploy`. Typecheck regenerates the client.
- **Web tests:** Vitest with jsdom; `apps/web/vitest.config.ts` maps `@/` like `tsconfig.json`. Server actions are tested by mocking `@/auth`, `@/lib/api` and `next/cache`.
- **Tailwind:** write class names out in full. Classes built from variables are not generated.
- **Checking a page in a real browser:** headless Chrome (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new --screenshot=...`) and, for clicking, the DevTools protocol over Node's built-in `WebSocket`. Sign-in is a password followed by an emailed code that the dev API prints in its log. When writing scripts through a shell heredoc, quote it (`<<'EOF'`) so `${...}` is not expanded.
- **Search:** Typesense runs locally (`docker compose`); `yarn workspace @auction/api reindex` rebuilds the index from Postgres (run it after changing the seed).
- **Test data hygiene:** anything you add to the dev database for manual testing must be removed afterwards (bids first).
- Two full test runs once took over 8 minutes and had unrelated failures; they did not repeat and the cause was not found. Mention it if it reappears.
