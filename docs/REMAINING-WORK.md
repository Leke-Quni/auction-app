# Remaining work

Written 2026-11-02, at the end of slice 4. `docs/DESIGN.md` is the source of truth for every decision; this file lists what is still to do, in the order to do it, plus the working rules and repo how-tos that used to live in the slice 4 handoff.

## Where things stand
Slice 4 (bidding and realtime) meets its done-criteria and is committed on branch `slice-4-bidding` (nothing pushed, nothing merged to `main`). Built: bidding with the minimum rule and a confirm step, live updates over WebSocket, anti-sniping (2-minute window and extension, 24-hour ceiling), outbid toasts and delayed outbid emails, rate limits and audit log, login-code cooldown, live search sync, seeded bids and a bot bidder. Slices 1 to 3 are done.

## 1. Left over from slice 4
- **Database connection pool and timeouts.** `packages/db/src/index.ts` uses the default pool, and a bid waits up to 15 seconds for the row lock. Set an explicit pool size, then test a burst of bids on one hot auction to check that other requests still get through (pool starvation).
- **Sockets after a token expires or a user is banned.** The sign-in token is checked only when a socket connects, so an old socket keeps its private room. Handle this with the admin slice, together with the "role freshness" decision below.
- **Settings only the owner can set for the deployed apps:**
  - Fly API: `REDIS_URL` pointing at the Upstash Redis (`fly secrets set REDIS_URL=...`). `TRUST_PROXY=1` is already in `apps/api/fly.toml`.
  - Vercel web app: `NEXT_PUBLIC_API_URL` set to the Fly address.
  - Deployed environments have no search until Typesense is hosted (bidding does not need it).
- **Merge** `slice-4-bidding` into `main` when the owner is ready (the owner decides when to push or merge).
- **Playwright end-to-end tests** (sign up, list, bid, win, pay) are in the quality plan (`DESIGN.md` section 6) and not started. The "win and pay" part needs slice 5.

## 2. Slice 4b: contacting the seller (next, by the owner's choice)
Done-criteria are in `DESIGN.md` section 8. Both public questions and answers on the listing and private buyer-seller threads with an inbox. It also builds the **in-app notification list** the owner asked for:
- Saved notifications (the API writes one when it creates a notice; the toast becomes the live display of a saved one), an unread count, mark as read, and clicking one opens its listing.
- They expire after a few days; when an auction is completed its notifications expire too, except the latest "You've been outbid" one.
- Reuse the toast component (`apps/web/app/notifications.tsx`), the private `user:<id>` room and `NotificationsService` (`apps/api/src/realtime/`).
- Open decisions to settle when the slice starts (listed in `DESIGN.md` section 7): who may start a private thread, editing and deleting, a length limit, whether threads continue after the auction ends, whether a seller can turn questions off, blocking and reports, and stopping contact-detail swaps. Also the number of days notifications live and the layout.

## 3. Slice 5: auction close and payment
Done-criteria are in `DESIGN.md` section 8. Things to carry in from slice 4:
- The close job (QStash, idempotent, plus a periodic sweep) must also **send every bidder who was outbid an "auction ended, you did not win" email** with the final price. A long bidding war otherwise leaves people with one early email and no result.
- Replace the outbid-email sweeper (`PendingOutbidEmail`, `NotificationsService.sweep`) with a QStash delayed message; the rules stay the same.
- Move the search sync and the emails onto the transactional outbox, as the design plans.
- Strike lifecycle and platform fee percentage are open decisions (below). Reserve not met means no sale and a one-click relist.
- Note: when this slice starts closing auctions, check how it treats the anti-sniping ceiling (`extensionCeiling` in `packages/shared`).

## 4. Slice 6: shipping, notifications, admin
Done-criteria are in `DESIGN.md` section 8 (fake shipping, watchlist and "ending soon" emails, seller ratings, `apps/admin` with moderation and the reports queue behind the `ADMIN` role). Decide the **role freshness** question first (how the API gets a current role so a demoted admin or banned user loses access), and choose the admin theme.

## 5. Open decisions still to make (from `DESIGN.md` section 7)
- Query library for server data: React Query or SWR.
- Role freshness (see slice 6).
- Username squatting: a cleanup rule for stale unverified accounts, before launch.
- Platform fee percentage and the delay before seller payout.
- Strike lifecycle (expiry, appeals).
- Email sending through QStash instead of directly (slices 4b and 5); Resend's sandbox sender only delivers to the Resend account's own address until a domain is verified.
- Whether to keep `BidAudit` rows for ever (no clean-up exists).

## Working rules (from the owner)
- **Never commit, push or delete files unless asked.** When asked to commit, make separate commits per piece of work, and end each message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **One step at a time.** Finish a step, run the checks, then stop so the owner can test, change or remove it.
- Do not deviate from `DESIGN.md` without asking the owner; when a decision is made, write it into `DESIGN.md` (section 7) the same day.
- Match the surrounding style, keep changes minimal, no comments that restate the code.
- Report test failures honestly. Free tiers only, no card (the owner will not pay).
- `apps/web` runs a Next.js version that differs from older ones: read the docs in `node_modules/next/dist/docs/` before writing Next code (see `apps/web/AGENTS.md`).

## How to work in this repo
- **Checks:** `yarn typecheck`, `yarn lint`, `yarn test` (`yarn test --force` ignores the Turborepo cache). Docker must be running: `docker compose up -d` starts Postgres, Redis and Typesense. `yarn dev` runs web (3000), API (4000) and admin (3001).
- **API tests use the shared dev database.** They create their own users and listings with a unique stamp and must clean up bids, then listings, then users (deletes are `Restrict`ed). See `apps/api/test/bids.e2e.test.ts`: users are inserted with Prisma and tokens signed with `SignJWT` and `authSecret()`, which is far faster than signing up through the API. The bid limits and the login-code cooldown are lifted in `apps/api/vitest.config.ts`; the tests for them set their own values.
- **Migrations:** edit `packages/db/prisma/schema.prisma`, `yarn workspace @auction/db migrate:dev --name <name> --create-only`, add raw SQL (CHECK constraints) to the generated file, then `yarn workspace @auction/db migrate:deploy`. After a schema change run `yarn workspace @auction/db build` and restart the dev API, which loads the built copy.
- **Web tests:** Vitest with jsdom; `apps/web/vitest.config.ts` maps `@/` like `tsconfig.json`. Server actions are tested by mocking `@/auth`, `@/lib/api` and `next/cache`.
- **Tailwind:** write class names out in full. Classes built from variables are not generated.
- **Seed and bot:** `yarn workspace @auction/db seed [count]` (default 1000, up to 20000, 0 removes it; local database only), then `yarn workspace @auction/api reindex`. `yarn workspace @auction/api bot <listingId> [--every 4] [--max 20]` bids on a live auction as the sample users through the API.
- **Checking a page in a real browser:** headless Chrome (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new ...`) with the DevTools protocol over Node's built-in `WebSocket`. A signed-in session can be faked by setting the `authjs.session-token` cookie to an HS256 JWT signed with `AUTH_SECRET` (claims `id`, `email`, `name`, `role`, subject = user id). Real sign-in is a password followed by an emailed code that the dev API prints in its log. When writing scripts through a shell heredoc, quote it (`<<'EOF'`).
- **Search:** Typesense runs locally (`docker compose`); `yarn workspace @auction/api reindex` rebuilds the index from Postgres.
- **Test data hygiene:** anything you add to the dev database for manual testing must be removed afterwards (bids first, then listings, then users).
- Two full test runs once took over 8 minutes and had unrelated failures; they did not repeat and the cause was not found. Mention it if it reappears.
