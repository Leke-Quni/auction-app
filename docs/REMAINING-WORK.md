# Remaining work

Updated 2026-11-05, during slice 7. `docs/DESIGN.md` is the source of truth for every decision; this file lists what is still to do, in the order to do it, plus the working rules.

## Where things stand
Slices 1 to 6 are done and merged to `main` (slice 6 in PR #14). Slice 7 (admin) is in progress on branch `slice-7-admin`: step 1 (roles and bans read from the database on every request, `AdminGuard`, `GET /admin/me`) is committed; step 2 (the admin app shell, admin-only sign-in and the slate and indigo theme) is committed; step 3 (reports queue and question log) is committed; step 4 is half built: listing removal is done and tested (not yet committed), ban and unban and clearing strikes are left. `DESIGN.md` section 7 records every step.

Production is behind: the API on Fly and the Neon database were last set up at the end of slice 5 (30 migrations). The repository now has 39, and slice 6 and the slice 7 work are not deployed.

## 1. Slice 7: admin (what is left)
Done-criteria are in `DESIGN.md` section 8. Build order (decided 2026-11-05), one step at a time:
1. ~~Role and ban freshness in the API.~~ Done.
2. ~~Admin app shell, admin-only sign-in, theme.~~ Done.
3. ~~**Reports queue and `QuestionLog`.**~~ Built 2026-11-05 (questions and answers only; rating comments still undecided, section 4). Listed open `Report` rows (the reporter, reason, the words as written, `postedAt`, status `OPEN` or `HANDLED`, and the automatic `CONTACT_DETAILS` ones), mark one handled, and read `QuestionLog` (every post, edit and deletion). Handled reports are deleted by the existing clean-up 30 days later.
4. **Moderation.** Remove a listing (**done 2026-11-05**: ends it early with no sale, see `DESIGN.md`); ban and unban a user (`User.bannedAt`, `banReason`) and clear a strike are still to do. A ban must also disconnect that user's open sockets and tell their open storefront pages what happened (the suspended-account page, section 3).
5. **An order with both addresses.** The admin reads the full order: the buyer's delivery address and phone, the seller's pickup address, the amounts and the payout.
6. **Deploy the admin app** as its own Vercel project (`AUTH_SECRET` the same as the API, `API_URL`, `ADMIN_URL`) and make the first admin with `yarn workspace @auction/db make-admin <email>`.

Decided: a ban does not hold back a seller's payout; the API checks the database for the role on every request; the admin theme is light, slate and indigo.

## 2. Production and deploy (only the owner can do these)
- **Run the 9 new migrations on Neon** (`yarn workspace @auction/db migrate:deploy` against the Neon `DATABASE_URL`) **before** deploying the new API.
- **Stripe:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` on Fly, plus a webhook endpoint at `https://auction-api-leke.fly.dev/payments/stripe/webhook`. Until then production uses the fake payment provider. Payouts also need Connect and Accounts v2 enabled on the Stripe account and the platform's loss-liability acknowledgement accepted (Platform profile in the Dashboard); both were done on the test sandbox.
- A verified Resend domain, so won, pay-now, shipping, ending-soon and outbid emails reach people other than the Resend account owner (`MAIL_FROM` too).
- `REDIS_URL` (Upstash) on Fly, and `NEXT_PUBLIC_API_URL` on Vercel pointing at the Fly address. Deployed environments search Postgres until Typesense is hosted.
- Rotate the Neon password and the QStash token (both were shown in a chat while setting up), then `fly secrets set` the new values.

## 3. Loose ends
**Not proven or not tried by hand**
- **The EUR seller payout against real Stripe.** The owner's test sandbox is a US account that only holds USD, so Stripe refuses a EUR transfer there. Everything up to the transfer works (account creation, readiness, the sweep). It needs a platform that settles in EUR.
- Payment expiry, the runner-up offer, the strike and the "the item is yours to pay for" notice (slice 5, step 5) have not been tried by hand in a browser: win an auction, set `payBy` in the past, then miss a second payment and try to bid.
- "Set up payouts" opens Stripe's hosted onboarding page (it works on `http://localhost`, but the page has a captcha, so it cannot be scripted). Finishing it by hand through the app's own button has not been done end to end.

**Small gaps, by choice**
- Payout: no Stripe webhook for account changes (the account is asked about live), no email nudging a seller who has not set up payouts, and no early release on buyer confirmation (decided: timer only, 3 days after delivery). The transfer is not tied to the buyer's charge when that charge settled in a non-EUR currency, and nothing handles a refund or dispute after payment.
- Shipping updates are emails only, opt-in, and not in the bell. Two simultaneous "Mark as shipped" clicks could both reach a real carrier (harmless with the fake one; a real carrier must dedupe by order id).
- The "ending soon" reminder is not moved when anti-sniping extends an auction, and a 1-day auction can never send one (its last 24 hours are already running when it starts).
- The unread count on an open page is not pushed when notifications expire; sales that closed before orders existed have no order; a person cannot see their strikes except in the listing note and the email; sample users' `@seed.local` addresses would be emailed (and fail) if a real Resend key is set.
- No seeded demo orders or ratings, so a fresh seeded database has nothing delivered to rate.
- Rating comments have no report or moderation path yet (see section 4).

**Earlier slices**
- **Database connection pool and timeouts.** `packages/db/src/index.ts` uses the default pool, and a bid waits up to 15 seconds for the row lock. Set an explicit pool size, then test a burst of bids on one hot auction to check that other requests still get through.
- **Banned users on the storefront.** A banned user with a session already open gets the API's 403 `BANNED` on every call, and the storefront has no page for it (it shows errors). Show a clear "this account has been suspended" page and end the session. Do this with step 4.
- **Playwright end-to-end tests are not in the repo.** The browser checks written during slices 6 and 7 (sign up, rating, watchlist, notifications, orders, admin sign-in) were run from throwaway scripts. Turn them into a committed Playwright suite (`DESIGN.md` section 6), including sign up, list, bid, win and pay.
- **Flaky tests under a full run.** `full-workflow` and a few others occasionally fail in a full API run and always pass alone. The likely cause (not proven) is that the test files share one database and run in parallel, so one file's background email sweep can send another file's pending emails through the wrong fake sender. Running API test files one at a time would probably fix it, at roughly twice the run time.

## 4. Open decisions still to make (from `DESIGN.md` section 7)
- ~~An admin removing a listing that has bids.~~ Decided 2026-11-05: end it early with no sale.
- **Rating comments.** Whether they get the same report button and queue as questions and answers, or admin-only removal. Decide in slice 7 step 3 or 4.
- Query library for server data: React Query or SWR.
- Username squatting: a cleanup rule for stale unverified accounts, before launch.
- Whether to keep `BidAudit` rows for ever (no clean-up exists).

## Working rules (from the owner)
- **Never commit, push or delete files unless asked.** When asked to commit, make separate commits per piece of work, and end each message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **One step at a time.** Finish a step, run the checks, then stop so the owner can test, change or remove it.
- Do not deviate from `DESIGN.md` without asking the owner; when a decision is made, write it into `DESIGN.md` (section 7) the same day.
- Match the surrounding style, keep changes minimal, no comments that restate the code.
