# Remaining work

Updated 2026-11-04, at the end of slice 5. `docs/DESIGN.md` is the source of truth for every decision; this file lists what is still to do, in the order to do it, plus the working rules.

## Where things stand
Slices 1 to 4b are done and merged to `main`. Slice 5 (auction close and payment) is built, tested and pushed on branch `slice-5-close` (PR to be merged by the owner); `DESIGN.md` section 7 records every step. The API is deployed on Fly with the QStash secrets set and the Neon database migrated to all 30 migrations.

## 1. Slice 5 loose ends
- **Not yet tried by hand in a browser:** payment expiry, the runner-up offer, the strike and the "the item is yours to pay for" toast (step 5). Try it by winning an auction, setting `payBy` in the past in the database, then missing a second payment and trying to bid. The delivery, payment and invoice flow was tried against Stripe test mode with Playwright.
- **Production settings only the owner can set:**
  - `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` on Fly, plus a Stripe webhook endpoint at `https://auction-api-leke.fly.dev/payments/stripe/webhook`. Until then production uses the fake payment provider.
  - A verified Resend domain, so won, pay-now, "you did not win" and outbid emails reach people other than the Resend account owner (`MAIL_FROM` too).
  - `REDIS_URL` (Upstash) on Fly, and `NEXT_PUBLIC_API_URL` on Vercel pointing at the Fly address. Deployed environments search Postgres until Typesense is hosted.
  - Rotate the Neon password and the QStash token (both were shown in a chat while setting up), then `fly secrets set` the new values.
- **Known small gaps, noted in `DESIGN.md`:** the unread count on an open page is not pushed when notifications expire; the won toast is not saved to the bell; sales that closed before orders existed have no order; sample users' `@seed.local` addresses would be emailed (and fail) if a real Resend key is set; a person cannot see their strikes except in the listing note and the email.
- **Check section 3 of `DESIGN.md`** (close and payment) still matches what was built.

## 2. Left over from earlier slices
- **Database connection pool and timeouts.** `packages/db/src/index.ts` uses the default pool, and a bid waits up to 15 seconds for the row lock. Set an explicit pool size, then test a burst of bids on one hot auction to check that other requests still get through.
- **Sockets after a token expires or a user is banned.** The sign-in token is checked only when a socket connects, so an old socket keeps its private room. Handle this in slice 7 (admin) with the role freshness decision below.
- **Playwright end-to-end tests** (sign up, list, bid, win, pay) are in the quality plan (`DESIGN.md` section 6) but not in the repo. The pay step now works end to end, so this can be added.

## 3. Slice 6: shipping, payout, watchlist, ratings
Done-criteria are in `DESIGN.md` section 8. Build one step at a time, in this order: (1) shipping and payout: the seller marks a paid order shipped, the fake carrier (`ShippingProvider`) moves it `label created → in transit → delivered` on a timer, shipping-update emails, and the payout released 3 days after delivery or on the buyer's confirmation through `PaymentProvider.payout` (decide first what a payout is while sellers have no Stripe onboarding: record it as paid with no money moving, or Stripe Connect test mode); (2) watchlist and "ending soon" emails; (3) seller profiles with post-sale ratings from the buyer.

## 4. Slice 7: admin
Done-criteria are in `DESIGN.md` section 8. Decide **role freshness** first (how the API gets a current role so a demoted admin or banned user loses access) and choose the admin theme. Then `apps/admin` (a separate Next.js app and Vercel project, no public sign-up, admin-only API routes guarded by `ADMIN`): moderation (remove listings, ban users), the reports queue (handled reports are deleted by the clean-up 30 days later), clearing strikes, reading `QuestionLog` and `Report`, and an order with both addresses. Decide whether a ban holds back a seller's payout.

## 5. Open decisions still to make (from `DESIGN.md` section 7)
- Query library for server data: React Query or SWR.
- Role freshness (see slice 7).
- Username squatting: a cleanup rule for stale unverified accounts, before launch.
- Whether to keep `BidAudit` rows for ever (no clean-up exists).

## Working rules (from the owner)
- **Never commit, push or delete files unless asked.** When asked to commit, make separate commits per piece of work, and end each message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **One step at a time.** Finish a step, run the checks, then stop so the owner can test, change or remove it.
- Do not deviate from `DESIGN.md` without asking the owner; when a decision is made, write it into `DESIGN.md` (section 7) the same day.
- Match the surrounding style, keep changes minimal, no comments that restate the code.
