# Remaining work

Updated 2026-11-04, partway through slice 5. `docs/DESIGN.md` is the source of truth for every decision; this file lists what is still to do, in the order to do it, plus the working rules and repo how-tos.

## Where things stand
Slices 1 to 4b are done and merged to `main` (PR #11). Slice 5 (auction close and payment) is in progress on branch `slice-5-close`, cut from `origin/main`. Steps 1 to 3 are committed locally and **not pushed**:
- `9bbe411` Step 1: an idempotent close (`AuctionCloseService`, sweep at start-up and every 10 seconds) sets `closedAt`, `outcome` (`SOLD`, `NO_SALE`, `NO_BIDS`), winner and final price; the listing page shows the result.
- `9804b15` Step 2: every bidder who did not win gets one "auction ended" email (`PendingEndEmail`, leased rows with 3 tries); the auction's notifications expire at close; waiting outbid emails are dropped at close.
- `a13cd7a` Step 3: an `Order` for the winner (5% fee, 48 hours to pay), a "you won: pay now" email, the `PaymentProvider` interface with an in-memory fake, the order API (`/orders`), the pay-now page `/orders/[id]` and a test checkout page, the pay prompt in the bid panel, and a "You won the auction" toast.
All checks passed at the last full run (lint, typecheck, 322 API, 241 web, 87 shared tests). Decisions taken with the owner this slice are recorded in `DESIGN.md` section 7: fee 5% and payout 3 days after delivery, strikes never expire (admin clears them), runner-up is offered the item at their own bid only if it meets the reserve, and QStash comes last.

## 1. Rest of slice 5 (one step at a time; stop after each for the owner to test)
### Step 4: Stripe test mode
- Read Stripe's API documentation first (owner rule). Add `stripe` to `apps/api`; write `StripePaymentProvider` (Checkout Session with `success_url` `/orders/:id?paid=1`, which the order page already confirms; webhook with signature check, idempotent on the event id; `confirm`, `refund`, `payout`). Choose the provider in `PaymentsModule` from the environment: Stripe with `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, otherwise the fake, as mail falls back to the console. Add the variables to `.env.example`.
- **Needs from the owner:** a Stripe account with test-mode keys (no card needed for test mode) and the Stripe CLI for `stripe listen` while testing by hand. Stripe availability in Kosovo, Albania and North Macedonia is unverified; the interface keeps it swappable.
- Tests: unit tests with a mocked Stripe client; try a real test card by hand.

### Step 4b: delivery before payment, confirmation email, PDF invoice (built and tried in a browser, 2026-11-04)
- Done in code and tests (API 357, web 250, shared 98); see `DESIGN.md` section 7, "Delivery, confirmation email and invoice". Delivery is the platform's own: 5% of the item (EUR 3 to 50) plus the option's extra, kept by the platform to pay carriers; sellers give a pickup address (default in account settings, per listing). Tried by hand with Playwright (headless Chrome, driven from outside the repo) against Stripe test mode: sign-up, default pickup address, listing, bid, close, delivery form, two tabs, backing out of Stripe, changing the delivery mid-payment, paying, invoice PDFs, seller view and pickup correction. Emails were checked in the API tests, not in the browser run.
- Open for later: the admin view of an order with both addresses (slice 6); a real carrier booking, if ever wanted.

### Step 5: payment expiry, runner-up offer and strikes (built 2026-11-04, not yet tried by hand)
- Done in code and tests (see `DESIGN.md` section 7, "Payment expiry, the runner-up offer and strikes"). To try by hand: win an auction, let `payBy` pass (set it in the past in the database), and watch the order expire, the strike, the offer to the next bidder, the emails and the toast; then miss a second payment and try to bid.
- Open for later: where a person can see their strikes (only the listing note and the email say so for now); the admin screen that clears them (slice 6); a "second chance" email to the non-payer is deliberately not sent.

### Step 6: one-click relist (built 2026-11-04)
- A seller action on a `NO_SALE` or `NO_BIDS` listing creates a new draft with the same details and photos through the existing listing service (the old listing stays as the record). A button on the closed listing page, for the seller only.

### Step 7: QStash (built and checked against the QStash dev server and the production image, 2026-11-04; needs the owner's Upstash account and the four Fly secrets, see DESIGN.md "QStash jobs")
- Put scheduling behind a `JobScheduler` interface with the current sweep as the in-process implementation and a QStash one: a delayed message per auction to a signed `POST /jobs/close/:id` (verify the Upstash signature with the two signing keys), rescheduled when the auction is extended (`AuctionExtended`); the sweep stays as the safety net. Use it for the 48-hour order expiry too. Needs an Upstash account (free tier) and the QStash dev server or a tunnel for local testing; document how.
- Replace the outbid-email sweeper with a QStash delayed message only if it stays small; otherwise keep the leased rows and record that in `DESIGN.md`. A full transactional outbox is not planned: leased rows are used instead.
- On the Fly trial the machine stops every 5 minutes, so an auction that ends while it is stopped closes at the next start. QStash would wake the machine at the end time.

### Housekeeping for slice 5
- Update `DESIGN.md` section 7 with each step as it lands (done for steps 1 to 3). When the slice is finished, check that section 3 (close and payment) still matches what was built.
- Known small gaps, all noted in `DESIGN.md`: the unread count on an open page is not pushed when notifications expire; the won toast is not saved to the bell; sales that closed before orders existed have no order; sample users' `@seed.local` addresses would be emailed (and fail) if a real Resend key is set.
- Push `slice-5-close` and open a PR when the owner asks (nothing is pushed yet).

## 2. Left over from earlier slices
- **Database connection pool and timeouts.** `packages/db/src/index.ts` uses the default pool, and a bid waits up to 15 seconds for the row lock. Set an explicit pool size, then test a burst of bids on one hot auction to check that other requests still get through.
- **Sockets after a token expires or a user is banned.** The sign-in token is checked only when a socket connects, so an old socket keeps its private room. Handle this with the admin slice and the role freshness decision below.
- **Settings only the owner can set for the deployed apps:** Fly API `REDIS_URL` (Upstash) via `fly secrets set`; Vercel `NEXT_PUBLIC_API_URL` set to the Fly address; later `STRIPE_*` and QStash keys. Deployed environments search Postgres until Typesense is hosted.
- **Playwright end-to-end tests** (sign up, list, bid, win, pay) are in the quality plan (`DESIGN.md` section 6) but not in the repo. A browser test of sign up, bid and live outbid was written and passed during slice 4 review, then removed at the owner's request. Add one when the pay step works end to end (after step 4).

## 3. Slice 6: shipping, notifications, admin
Done-criteria are in `DESIGN.md` section 8 (fake shipping, watchlist and "ending soon" emails, seller ratings, `apps/admin` with moderation and the reports queue behind the `ADMIN` role). Decide **role freshness** first (how the API gets a current role so a demoted admin or banned user loses access), and choose the admin theme. The admin app also reads `QuestionLog` and `Report`, clears strikes, and handles reports (handled reports are deleted by the clean-up 30 days later). Shipping releases the seller payout (`PaymentProvider.payout`, 3 days after delivery).

## 4. Open decisions still to make (from `DESIGN.md` section 7)
- Query library for server data: React Query or SWR.
- Role freshness (see slice 6).
- Username squatting: a cleanup rule for stale unverified accounts, before launch.
- Email sending through QStash instead of directly (see step 7); Resend's sandbox sender only delivers to the Resend account's own address until a domain is verified.
- Whether to keep `BidAudit` rows for ever (no clean-up exists).
- Decided this slice, so no longer open: platform fee and payout delay, strike lifecycle, runner-up rule.

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
