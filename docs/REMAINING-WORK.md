# Remaining work

Updated 2026-11-05, after the slice 7 build and its first deploy. `docs/DESIGN.md` is the source of truth for every decision; this file lists what is still to do, in the order to do it, plus the working rules.

## Where things stand
Slices 1 to 6 are done and merged to `main`. Slice 7 (admin) is built, all five build steps: roles and bans read from the database on every request, the admin app and its sign-in, the reports queue and question log, moderation (remove a listing, ban and unban, clear a strike) and the order view with both addresses. PR #15 put that on `main`. `DESIGN.md` section 7 records every step.

Five commits are on `slice-7-admin` and **not yet merged**: the mail guard for sample accounts, the extended seed script, and three speed fixes (Vercel in Frankfurt, pages loading in one wave, a shared admin check). The speed fixes only reach production once they are merged, because Vercel builds from `main`.

Production, as of 2026-11-05: Neon has all 40 migrations; the API on Fly answers on the new admin routes; the admin app is its own Vercel project and the owner has signed in to it; the first admin was made with `make-admin`. The live site was seeded once with the sample data and cleaned again (`seed 0`), so it holds only real data.

## 1. Slice 7: what is left
Done-criteria are in `DESIGN.md` section 8. The five build steps are done; what remains is deploy checks and gaps found while building.

**Deploy checks (owner)**
- Merge the pull request for the five commits above (https://github.com/Leke-Quni/auction-app/compare/main...slice-7-admin?expand=1), then wait for both Vercel projects to redeploy.
- In each Vercel project (storefront and admin), Settings, Functions: Function Region must say Frankfurt (`fra1`), matching the `vercel.json` files. Without it the apps run in Washington D.C. and every page crosses the Atlantic.
- `ADMIN_URL` is not in `turbo.json`'s `globalPassThroughEnv`. It is only read at run time, so nothing should break; add it if the admin sign-in ever redirects to the wrong address.

**Not built in the admin app (decide which to do, section 4)**
- ~~A record of who did what~~ Done 2026-11-06 (`AdminAction`, Audit log page). Not recorded: sign-ins and who marked a report handled.
- ~~Telling people~~ Done 2026-11-06 (ban email; removal email and bell entry for the seller).
- ~~Removing a reported post~~ Done 2026-11-06.
- ~~Finding things~~ Done 2026-11-06 (Overview counts, open-reports badge, Listings page).
- **Changing an order.** The order view is read only: no refund, cancel or address correction.
- **Smaller:** (an admin's role can now be changed in the admin app; `LAST_ADMIN` untested) banning an admin without demoting them first, clearing all of a person's strikes in one click, and hiding a removed listing's words and photos from the public (today it shows as an ended auction with a banner).
- **Rating comments** have no report button or moderation path (decision, section 4).
- **Admin app tests.** `apps/admin` has no tests of its own; its behaviour is covered by API tests and by throwaway browser scripts.

## 2. Production and deploy (only the owner can do these)
- **Keep the Fly API awake.** The free trial stops the machine 5 minutes after each start whatever `fly.toml` says (Fly's own event log shows it), and the next request waits about 5 seconds for a boot; sockets drop and the background sweeps pause in between. Ping `https://auction-api-leke.fly.dev/health` every minute from a free scheduler (for example cron-job.org) to cut the stopped time to about a minute per cycle.
- **Check Neon's usage.** The API's sweeps query the database every few seconds, so its compute never idles; on the free plan that can use up the monthly compute allowance. Look at the usage page.
- **Stripe:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` on Fly, plus a webhook endpoint at `https://auction-api-leke.fly.dev/payments/stripe/webhook`. Until then production uses the fake payment provider. Payouts also need Connect and Accounts v2 enabled on the Stripe account and the platform's loss-liability acknowledgement accepted (Platform profile in the Dashboard); both were done on the test sandbox.
- A verified Resend domain, so won, pay-now, shipping, ending-soon and outbid emails reach people other than the Resend account owner (`MAIL_FROM` too). Until then the admin sign-in code only arrives for the account that owns the Resend account.
- `REDIS_URL` (Upstash) on Fly, and `NEXT_PUBLIC_API_URL` on Vercel pointing at the Fly address. Deployed environments search Postgres until Typesense is hosted.
- Rotate the Neon password and the QStash token (both were shown in a chat while setting up), then `fly secrets set` the new values.
- **Seeding production for a demo** (the owner runs it; it never runs on its own): the command, with `--owner`, `--allow-remote` and `--confirm-host`, is in `DESIGN.md` section 6, and `seed 0` with the same flags removes it. Sample times are relative to the moment it runs and mostly run out within a week (the named scenarios within minutes to days), so run it again to refresh. Deploy the API with the mail guard first.

## 3. Loose ends
**Not proven or not tried by hand**
- **The EUR seller payout against real Stripe.** The owner's test sandbox is a US account that only holds USD, so Stripe refuses a EUR transfer there. Everything up to the transfer works (account creation, readiness, the sweep). It needs a platform that settles in EUR.
- "Set up payouts" opens Stripe's hosted onboarding page (it works on `http://localhost`, but the page has a captcha, so it cannot be scripted). Finishing it by hand through the app's own button has not been done end to end.
- A socket refused because the database could not be asked (`UNAVAILABLE`) has no test; the reminder toast's wording has no test of its own (the bell's does).
- Load testing has not been done. Planned: browsing and search over a seeded database, and a burst of bidders on one auction (bids are limited to 10 per person and 30 per address a minute, so it needs many sample accounts or lifted limits). Run the first round locally; Postgres search, the Fly trial machine and Neon's free tier are the likely limits in production.

**Small gaps, by choice**
- Payout: no Stripe webhook for account changes (the account is asked about live), no email nudging a seller who has not set up payouts, and no early release on buyer confirmation (decided: timer only, 3 days after delivery). The transfer is not tied to the buyer's charge when that charge settled in a non-EUR currency, and nothing handles a refund or dispute after payment.
- Shipping updates are emails only, opt-in, and not in the bell. Two simultaneous "Mark as shipped" clicks could both reach a real carrier (harmless with the fake one; a real carrier must dedupe by order id).
- The "ending soon" reminder is not moved when anti-sniping extends an auction, and a 1-day auction can never send one (its last 24 hours are already running when it starts). The "24 hours left to pay" reminder is sent once; there is no closer second one.
- The unread count on an open page is not pushed when notifications expire; sales that closed before orders existed have no order; a person cannot see their strikes except in the listing note and the email (admin strikes send no email at all).
- A draft or unknown listing answers HTTP 200 with a "not found" page, not a real 404, because the root `loading.tsx` streams before the page knows. It was like this before the speed fixes.
- The web app has no "waking up" message for the first request after the Fly machine has stopped.
- `apps/web/next-env.d.ts` is tracked but rewritten by typegen, so it shows as modified after every typecheck. Commit the generated form once, or ignore the file.

**Earlier slices**
- **Database connection pool and timeouts.** Done 2026-11-06: `createPrismaClient` sets the pool explicitly (`DB_POOL_MAX`, default 10 as before; `DB_CONNECT_TIMEOUT_MS`, default 10 s, so a request that cannot get a connection fails instead of waiting for ever: a bid answers 503 `BUSY`, other routes would answer 500). A test shows reads still answer in under 5 s while 50 bidders queue on one auction. Still to do: pick the real pool size for Fly and Neon's pooler, and run a heavier burst against the deployed API. The bid's 15 s row-lock wait is unchanged.
- **Playwright end-to-end tests: started 2026-11-06.** `apps/e2e` (`yarn workspace @auction/e2e e2e`, needs Docker and `yarn dev`, or starts it) has two specs: sign up, confirm the code, sign out, sign in again, and a wrong code; and bidding (a bid needs a second click, a bid under the minimum is refused, and a second bidder's bid shows the first an outbid notice live). The seller and listing for the bid spec are made straight in the database, because photos upload to Vercel Blob, which a local run cannot reach. Emailed codes are stored hashed, so `tests/helpers.ts` swaps the stored code for a known one after the page asks for it (no app change). A third spec, `win-and-pay`, bids, ends the auction early in the database, waits for the API's sweep to close it, fills in delivery and pays with the test card. **It needs the API on the fake payment provider**: the local `.env` has Stripe test keys, so it skips itself when the pay step leaves for Stripe. To run it, start the API with the keys blanked (`STRIPE_SECRET_KEY= STRIPE_WEBHOOK_SECRET= yarn workspace @auction/api dev`; Turbo strips these variables, so `yarn dev` cannot do it). A fourth spec, `admin`, makes an account an admin in the database, signs in to the admin app (port 3001, its own two-step sign-in), bans a user, removes a listing and checks the Audit log. Still to write: listing through the pages (needs a way around the photo upload) from the throwaway scripts. The local `.env` has Stripe test keys, so a pay test would hit real Stripe Checkout unless the keys are blanked for the run. It is not part of `yarn test` or CI yet.
- **One timing-sensitive API test.** Changed 2026-11-06: `flushEmails` in `notifications.e2e.test.ts` now keeps sweeping until nothing of the test's is still due, because `sweep()` returns at once when the background sweep is mid-run (the likely cause of the failure on a busy machine). The full `yarn test` passed (530 API, 290 web); the failure was never reproduced here, so watch for it in CI.

## 4. Open decisions still to make (from `DESIGN.md` section 7)
- **Rating comments.** Whether they get the same report button and queue as questions and answers, or admin-only removal.
- **A removed listing's content.** Whether its words and photos stay public (an ended auction with a banner, as now) or are hidden.
- **Which gaps in section 1 to build** before launch, and which to leave.
- Query library for server data: React Query or SWR.
- Username squatting: a cleanup rule for stale unverified accounts, before launch.
- Whether to keep `BidAudit` rows for ever (no clean-up exists).

## Working rules (from the owner)
- **Never commit, push or delete files unless asked.** When asked to commit, make separate commits per piece of work, and end each message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **One step at a time.** Finish a step, run the checks, then stop so the owner can test, change or remove it.
- Do not deviate from `DESIGN.md` without asking the owner; when a decision is made, write it into `DESIGN.md` (section 7) the same day.
- Match the surrounding style, keep changes minimal, no comments that restate the code.
