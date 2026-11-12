# Proxy bidding: tasks

Order, decisions and risks: `tasks/plan.md`. Design, rules, data model and failure modes: `docs/PROXY-BIDDING-PLAN.md`. Section numbers below refer to that file.

Verification commands used below (run from the repo root):
- Shared: `yarn workspace @auction/shared test`
- API test file: `bash scripts/test-local.sh test/<file>` (clean `auction_test` database)
- API whole suite: `yarn test:local`
- Web: `yarn workspace @auction/web test <file>`
- DB package: `yarn workspace @auction/db test`
- Types and lint: `yarn workspace @auction/<shared|db|api|web|admin> typecheck` and `lint`
- Browser: `yarn workspace @auction/e2e e2e tests/<spec>`

Rules for every task: leave the system working and the existing tests green (fix the tests this task makes wrong, inside this task); stop at each checkpoint for the owner; never commit or push unless asked.

---

## Phase 0: Decide

### Task 0: Owner decisions and the docs updated

**Description:** The owner answers D0 to D14 (section 4 of the plan doc; defaults are my recommendations). Then the docs say proxy bidding is in scope and describe the agreed rules, before any code.

**Acceptance criteria:**
- [ ] D0 to D14 each have an answer written in `docs/decisions/bidding.md` with the date and the reason.
- [ ] `docs/DESIGN.md` section 2 (bid rules) and the out-of-scope line no longer say "no proxy bidding"; the short bidding and notifications bullets in section 4 match.
- [ ] `docs/decisions/close-payment-delivery.md` runner-up line says the runner-up pays their highest visible bid, not a hidden maximum (D14).
- [ ] The plan doc is adjusted for any answer that differs from the defaults.

**Verification:**
- [ ] Manual: the owner reads the three files and agrees.

**Dependencies:** None
**Files likely touched:** `docs/DESIGN.md`, `docs/decisions/bidding.md`, `docs/decisions/close-payment-delivery.md`, `docs/PROXY-BIDDING-PLAN.md`
**Estimated scope:** Small (docs only)

---

## Phase 1: Foundation

### Task 1: The resolver, as pure code

**Description:** `resolveProxyBid` in `packages/shared`: given the current price, starting price, reserve, the leader and their maximum, the challenger and their maximum, it returns the rows to create, the new price and leader, the outcome (`LEADING`, `OUTBID_BY_PROXY`, `MAX_RAISED`) and whether the price changed. No database and no clock. Implements the rules in section 3.2 (cases 1 to 4; the reserve lift is part of it).

**Acceptance criteria:**
- [ ] All cases in 3.2 produce the rows and prices of the six worked examples.
- [ ] Ties go to the earlier maximum; a maximum below `minNext` is a refusal result, not a row.
- [ ] Invariants hold over 1,000 seeded random requests: price never exceeds the leader's maximum, never drops, is at least the starting price, row amounts never decrease, the leader holds the highest maximum, no amount exceeds `MAX_BID_CENTS`.
- [ ] `minimumNextBidCents`, `endsAtAfterBid` and `extensionCeiling` are unchanged.

**Verification:**
- [ ] Tests pass: `yarn workspace @auction/shared test`
- [ ] `yarn workspace @auction/shared typecheck` and `lint` pass
- [ ] Manual: read the table test names; each case in 3.2 has one.

**Dependencies:** T0 (D1, D3, D7)
**Files likely touched:** `packages/shared/src/proxy-bid.ts` (new), `packages/shared/src/proxy-bid.test.ts` (new), `packages/shared/src/index.ts`
**Estimated scope:** Medium (3 files)

### Task 2: Database migration and schema

**Description:** Add `AutoBid(listingId, bidderId, maxCents, updatedAt)` with a unique `(listingId, bidderId)`; add `Bid.kind` (enum `BID | AUTO | RAISE`, default `BID`), `Bid.maxCents` (nullable), `Bid.outcome` (nullable enum) and `Bid.seq` (identity). Backfill: every existing `Bid` gets `maxCents = amountCents`; every (listing, bidder) with bids gets an `AutoBid` at their highest amount. Additive, so the old API keeps working against it.

**Acceptance criteria:**
- [ ] Migration applies to an empty database and to a seeded one, and the existing `Listing_bid_fields_agree` check still holds.
- [ ] Backfill is right for no bids, one bidder, and two bidders on the same listing.
- [ ] `Bid` ordering by `amountCents DESC, seq DESC` is stable for equal amounts.
- [ ] The existing API suites still pass against the migrated database (nothing reads the new columns yet).

**Verification:**
- [ ] `yarn workspace @auction/db migrate:deploy` on the test database; `yarn workspace @auction/db test`
- [ ] `yarn workspace @auction/db typecheck`; `yarn workspace @auction/api typecheck` (regenerated client)
- [ ] Tests pass: `yarn test:local`
- [ ] Manual: `\d "Bid"` and `\d "AutoBid"` in psql show the columns and the unique index.

**Dependencies:** T0
**Files likely touched:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/<timestamp>_proxy_bidding/migration.sql`, a db test file
**Estimated scope:** Small-Medium (3 files)

### Task 3: Seed and bot keep working, and gain a proxy scenario

**Description:** The seed writes the new columns and an `AutoBid` row per bidder so seeded auctions are consistent with the new model (each seeded bid is a maximum equal to itself), and adds one named scenario: a leader whose hidden maximum is far above the price and a challenger who lost at once. The bot bidder keeps working.

**Acceptance criteria:**
- [ ] `seed`, `seed 0` and `seed --owner` run against the local database without error and leave consistent rows.
- [ ] `seed-bids.test` and `seed-scenarios.test` pass and check the new columns.
- [ ] The new scenario's maximum never appears in any seeded `Bid.amountCents`.

**Verification:**
- [ ] Tests pass: `yarn workspace @auction/db test`
- [ ] Manual: seed locally, open the scenario's listing, price is below the hidden maximum.

**Dependencies:** T2
**Files likely touched:** `packages/db/src/seed-bids.ts`, `seed-data.ts`, `seed-scenarios.ts`, `seed.ts`, their tests
**Estimated scope:** Medium (5 files)

### Checkpoint A: foundation
- [ ] Shared and DB tests pass; the migration applied locally
- [ ] Existing API suite still green
- [ ] Review with the owner before touching the bid transaction

---

## Phase 2: The bid path (API)

### Task 4: First bid, takeover, defence and tie

**Description:** `BidsService.placeBid` uses the resolver. It reads the leader's `AutoBid` inside the lock, applies cases 1 and 3 (first bid at the starting price; takeover; leader defends; tie to the earlier maximum), writes the `Bid` rows (`BID` for the request, `AUTO` for the leader's counter), upserts `AutoBid` with `GREATEST`, updates `Listing`, and returns a superset response (`outcome`, `yourMaxCents`, `rows`). `TOO_LOW` still applies below the minimum. The wire field stays `amountCents` (D11). The old `ALREADY_HIGHEST` path for a different person no longer applies.

**Acceptance criteria:**
- [ ] Worked examples 1 to 4 of 3.2 produce exactly the rows, price and leader listed.
- [ ] A challenger who loses at once gets 201 with `outcome: "OUTBID_BY_PROXY"` and the new price, not an error.
- [ ] `bidCount` increases by the number of visible rows created; `Listing_bid_fields_agree` holds.
- [ ] The leader's maximum is never in the response of anyone else.
- [ ] Existing tests that assumed one row per bid are updated to the new semantics.

**Verification:**
- [ ] Tests pass: `bash scripts/test-local.sh test/bids.e2e.test.ts test/bid-protection.e2e.test.ts`
- [ ] `yarn workspace @auction/api typecheck` and `lint` pass
- [ ] Manual: place the four cases through `curl` or the bot against a local auction and read the rows in psql.

**Dependencies:** T1, T2
**Files likely touched:** `apps/api/src/bids/bids.service.ts`, `packages/shared/src/bids.ts` (types, refusals), `apps/api/test/bids.e2e.test.ts`, `apps/api/test/bid-protection.e2e.test.ts`
**Estimated scope:** Medium-Large (4 files, the most delicate task; split further if the tests take more than a session)

### Task 5: Raising your own maximum

**Description:** The current leader can raise their maximum. It stores a hidden `RAISE` row, changes no price, does not extend the auction, does not change `bidCount` or send an outbid notice. A value that is not higher is refused with the new `MAX_NOT_HIGHER` (409); `ALREADY_HIGHEST` is retired.

**Acceptance criteria:**
- [ ] Example 5 of 3.2 holds: price and `bidCount` unchanged, `AutoBid.maxCents` raised.
- [ ] A raise to the same or a lower value answers 409 `MAX_NOT_HIGHER` and changes nothing.
- [ ] `BID_REFUSALS`, `BID_REFUSAL_MESSAGES` and the status map include the new code (the compiler enforces it).
- [ ] The web's bid action maps the new code to its message.

**Verification:**
- [ ] Tests pass: `bash scripts/test-local.sh test/bids.e2e.test.ts test/bids-guarantees.e2e.test.ts`; `yarn workspace @auction/web test bid-actions`
- [ ] Typecheck passes in shared, api and web.

**Dependencies:** T4
**Files likely touched:** `apps/api/src/bids/bids.service.ts`, `packages/shared/src/bids.ts`, `apps/web/app/listings/[id]/bid-actions.ts` (+ test), `apps/api/test/bids-guarantees.e2e.test.ts`
**Estimated scope:** Medium (5 files)

### Task 6: Idempotency and replay for multi-row bids

**Description:** A retry of a request that created several rows answers 200 with the stored `outcome` and creates nothing. The replay and key-reuse checks compare `maxCents`, not `amountCents`. System rows use the key `auto:<request row id>` (cannot collide with a user key).

**Acceptance criteria:**
- [ ] Replaying each outcome (leading, defended, raised) returns the same answer and adds no rows.
- [ ] The same key with a different maximum or listing is `IDEMPOTENCY_KEY_REUSED`.
- [ ] 10 simultaneous identical requests from one person create exactly one request row and its derived rows.
- [ ] The failed-transaction test (nothing saved, key not used up) still passes.

**Verification:**
- [ ] Tests pass: `bash scripts/test-local.sh test/bids.e2e.test.ts test/bids-guarantees.e2e.test.ts`

**Dependencies:** T4, T5
**Files likely touched:** `apps/api/src/bids/bids.service.ts`, `apps/api/test/bids.e2e.test.ts`, `apps/api/test/bids-guarantees.e2e.test.ts`
**Estimated scope:** Small-Medium (3 files)

### Task 7: Reserve lift

**Description:** When the leader's maximum is at least the reserve and the price is below it, the price rises to the reserve (an `AUTO` row at the reserve), as in D1. `reservePriceCents` is added to the locked listing read.

**Acceptance criteria:**
- [ ] Example 6 of 3.2: a lone bidder with a maximum above the reserve ends the auction as `SOLD` at the reserve, not `NO_SALE`.
- [ ] Reserve below, equal to and above the maximum each behave as listed in the plan.
- [ ] No reserve: behaviour unchanged.

**Verification:**
- [ ] Tests pass: `bash scripts/test-local.sh test/bids.e2e.test.ts test/auction-close.e2e.test.ts`

**Dependencies:** T4
**Files likely touched:** `apps/api/src/bids/bids.service.ts`, `packages/shared/src/proxy-bid.ts`, `apps/api/test/bids.e2e.test.ts`, `apps/api/test/auction-close.e2e.test.ts`
**Estimated scope:** Small-Medium (4 files)

### Task 8: Anti-sniping on price changes

**Description:** Any request that changes the price (new `BID`/`AUTO` rows) extends the auction through `endsAtAfterBid` with the single database-clock reading; `extensionCount` goes up once per request, not once per row; a raise never extends (D2).

**Acceptance criteria:**
- [ ] A takeover, and a defended bid, in the last 2 minutes move the end to 2 minutes from now; a raise does not.
- [ ] The 24-hour ceiling and "final chance" still hold.
- [ ] A defended bid that creates two rows extends once.

**Verification:**
- [ ] Tests pass: `bash scripts/test-local.sh test/bids.e2e.test.ts` (anti-sniping group)

**Dependencies:** T4, T5
**Files likely touched:** `apps/api/src/bids/bids.service.ts`, `apps/api/test/bids.e2e.test.ts`
**Estimated scope:** Small (2 files)

### Task 9: Ineligible leaders

**Description:** A leader who is banned, has asked to delete their account, or has two strikes no longer defends (D8): they are treated as a plain bid at the current price (`Ml = P`). One extra read inside the lock.

**Acceptance criteria:**
- [ ] With a banned, closing or struck leader, a challenger at the minimum wins and nobody is defended automatically.
- [ ] An eligible leader still defends.
- [ ] The extra read does not run when there is no leader.

**Verification:**
- [ ] Tests pass: `bash scripts/test-local.sh test/bids.e2e.test.ts test/admin-users.e2e.test.ts test/account-deletion.e2e.test.ts`

**Dependencies:** T4
**Files likely touched:** `apps/api/src/bids/bids.service.ts`, `apps/api/test/bids.e2e.test.ts`
**Estimated scope:** Small (2 files)

### Checkpoint B: the API places proxy bids correctly
- [ ] All bid, guarantee, protection and close suites pass
- [ ] The three outcomes can be driven by hand with the bot or `curl`
- [ ] Review with the owner before touching realtime and the UI

---

## Phase 3: Events and notifications

### Task 10: Realtime with several rows per event

**Description:** `BidResult` carries `rows`, `outcome` and `requestedBy`. The public `bid:placed` event keeps `bid` (the top row) and adds `bids` (all visible rows). The live store merges them and its gap rule compares against the number of rows in the event so a normal fight does not trigger a page refresh. Maximums never appear in any public payload.

**Acceptance criteria:**
- [ ] Two browsers watching the same auction show the same price, history and count after a takeover and after a defended bid.
- [ ] A defended bid (two rows) does not call `router.refresh()`; a genuinely missed bid still does.
- [ ] An old client that reads only `bid` still works.

**Verification:**
- [ ] Tests pass: `bash scripts/test-local.sh test/realtime.e2e.test.ts test/search-sync.test.ts`; `yarn workspace @auction/web test live-auction`
- [ ] Manual: two browser windows on one local auction.

**Dependencies:** T4
**Files likely touched:** `apps/api/src/bids/bids.service.ts` (result), `apps/api/src/realtime/realtime.gateway.ts`, `packages/shared/src/realtime.ts`, `apps/web/app/listings/[id]/live-auction.tsx` (+ test), `apps/api/test/realtime.e2e.test.ts`
**Estimated scope:** Medium (6 files)

### Task 11: Notifications go to the right person

**Description:** The outbid notice and email go only to a leader who actually lost the lead; the requester's own pending outbid email is cleared (not the new leader's); the extension toast list excludes the requester as well as the leader and the outbid bidder. A challenger beaten at once gets no notice (the response tells them).

**Acceptance criteria:**
- [ ] Takeover: the old leader gets the toast, bell entry and queued email; defence: nobody is "outbid".
- [ ] The requester's pending outbid email is deleted after they bid again.
- [ ] No duplicate extension toast for the requester.

**Verification:**
- [ ] Tests pass: `bash scripts/test-local.sh test/notifications.e2e.test.ts test/saved-notifications.e2e.test.ts`

**Dependencies:** T4, T10
**Files likely touched:** `apps/api/src/realtime/notifications.service.ts`, `apps/api/test/notifications.e2e.test.ts`, `apps/api/test/saved-notifications.e2e.test.ts`
**Estimated scope:** Small-Medium (3 files)

---

## Phase 4: Everything else that reads bids

### Task 12: Runner-up, history, admin lists and counts

**Description:** Runner-up selection ignores `RAISE` rows and offers the bidder's highest visible bid (D14). History excludes `RAISE`, orders by `amountCents DESC, seq DESC`, and its total comes from `bidCount`. The admin "Auctions they bid on" list and the user's bid counts exclude `RAISE` rows. Confirm by test that the other readers (distinct bidders for emails, `hasStake`, removal) are unaffected.

**Acceptance criteria:**
- [ ] After a proxy fight and an unpaid win, the runner-up is offered at their last visible bid.
- [ ] History never shows a hidden raise; equal amounts order by `seq`.
- [ ] `/admin/users/:id/bids` and the user's bid count do not count `RAISE` rows.

**Verification:**
- [ ] Tests pass: `bash scripts/test-local.sh test/order-expiry.e2e.test.ts test/bids.e2e.test.ts test/admin-users.e2e.test.ts test/auction-end-emails.e2e.test.ts`

**Dependencies:** T2, T4
**Files likely touched:** `apps/api/src/orders/order-expiry.service.ts`, `apps/api/src/bids/bids.service.ts`, `apps/api/src/admin/admin-users.service.ts`, and their tests
**Estimated scope:** Medium (6 files)

### Checkpoint C: backend complete
- [ ] `yarn test:local` passes in full
- [ ] The maximum appears in no public response (spot check with curl)
- [ ] Review with the owner

---

## Phase 5: UI

### Task 13: The viewer's own maximum reaches the listing page

**Description:** `findOne` in `listings.service.ts` adds `viewerMaxCents` for a signed-in viewer (one more query in the existing `Promise.all`). The listing page passes it to the bid panel; the live store re-syncs it after each bid.

**Acceptance criteria:**
- [ ] A bidder sees their own maximum; everyone else, and signed-out visitors, get no such field.
- [ ] No extra sequential request is added to the page load.

**Verification:**
- [ ] Tests pass: `bash scripts/test-local.sh test/listings.e2e.test.ts`; `yarn workspace @auction/web test live-details`

**Dependencies:** T4
**Files likely touched:** `apps/api/src/listings/listings.service.ts`, `apps/web/app/listings/[id]/page.tsx`, `apps/web/app/listings/[id]/live-details.tsx`, tests
**Estimated scope:** Medium (5 files)

### Task 14: Bid panel

**Description:** "Your maximum bid (€)" with the help text; the confirmation names the maximum; the leader sees "You are the highest bidder. Your maximum: €X" and a form to raise it; after a bid one of three messages shows ("You are the highest bidder at €X" / "Someone has a higher maximum. The price is now €X" with a button to raise / "Your maximum is now €Y"). 10× warning and second click stay.

**Acceptance criteria:**
- [ ] Each outcome shows its message; the raise form refuses a non-higher value client-side.
- [ ] Signed-out, owner, blocked, upcoming and ended modes are unchanged.
- [ ] Works at phone width and in dark mode.

**Verification:**
- [ ] Tests pass: `yarn workspace @auction/web test bid-panel bid-actions`; `yarn workspace @auction/web typecheck`, `lint`
- [ ] Manual: browser check of leading, defended, outbid, raise, reserve, extension; screenshots at 390px.

**Dependencies:** T5, T13
**Files likely touched:** `apps/web/app/listings/[id]/bid-panel.tsx`, `bid-actions.ts`, `bid-panel.test.tsx`, `bid-actions.test.ts`
**Estimated scope:** Medium (4 files)

### Task 15: Toasts, bell and emails

**Description:** The outbid toast says someone's maximum is higher and links to the listing page to raise it instead of a one-click minimum bid (D6); bell text and the outbid email mention the maximum.

**Acceptance criteria:**
- [ ] The toast has no one-click bid; its link opens the listing.
- [ ] Email and bell wording matches the new model.

**Verification:**
- [ ] Tests pass: `yarn workspace @auction/web test notifications notification-bell`; `bash scripts/test-local.sh test/notifications.e2e.test.ts`

**Dependencies:** T11
**Files likely touched:** `apps/web/app/notifications.tsx`, `notification-bell.tsx`, `apps/api/src/realtime/notifications.service.ts`, tests
**Estimated scope:** Medium (6 files)

### Checkpoint D: usable by hand
- [ ] Two browsers, bot and a seeded auction: every case from the six worked examples visible and understandable
- [ ] Phone width and dark mode checked
- [ ] Review with the owner

---

## Phase 6: Hardening and release

### Task 16: Concurrency, invariants and no-leak tests

**Description:** Redefine "50 different amounts at the same moment": after the burst, price ≤ the leader's maximum, the leader holds the highest maximum, `bidCount` equals the visible rows and history is strictly ordered. Keep a variant where all 50 type the same amount (exactly one accepted). Add a test that no public payload (socket events, listing, history, extension list) contains the maximum. Compare lock timing with the old 50-bid test.

**Acceptance criteria:**
- [ ] Both concurrency variants pass repeatedly (5 runs).
- [ ] The leak test fails if a maximum is added to a public payload (check by temporarily adding it).
- [ ] Other requests still get through while 50 bidders queue.

**Verification:**
- [ ] Tests pass: `bash scripts/test-local.sh test/bids.e2e.test.ts` five times

**Dependencies:** T4 to T12
**Files likely touched:** `apps/api/test/bids.e2e.test.ts`, `apps/api/test/realtime.e2e.test.ts`
**Estimated scope:** Small-Medium (2 files)

### Task 17: Playwright, bot and seed scenarios

**Description:** Update `bidding.spec.ts` (labels, the below-minimum flow) and add a defended-bid scenario with two users; check `win-and-pay.spec.ts` for bid steps; give the bot an optional `--proxy` mode.

**Acceptance criteria:**
- [ ] `bidding.spec.ts` and `win-and-pay.spec.ts` pass against the local stack.
- [ ] The bot places maximums and the demo auction shows a defended bid.

**Verification:**
- [ ] `yarn workspace @auction/e2e e2e tests/bidding.spec.ts tests/win-and-pay.spec.ts` (API with Stripe keys blanked for the pay spec, see `docs`)

**Dependencies:** T14, T15
**Files likely touched:** `apps/e2e/tests/bidding.spec.ts`, `win-and-pay.spec.ts`, `apps/api/src/dev/bot-bidder.ts`
**Estimated scope:** Small-Medium (3 files)

### Task 18: Docs final, full suite, deploy notes

**Description:** Write what was actually built into `docs/decisions/bidding.md` and `DESIGN.md`; delete `docs/PROXY-BIDDING-PLAN.md` and `tasks/` or keep them as the owner prefers; run every suite; write the deploy notes.

**Acceptance criteria:**
- [ ] `yarn test:local`, shared, db, web and admin tests, lint and typecheck all pass.
- [ ] Deploy notes: apply the migration to Neon and check status, then `fly deploy -c apps/api/fly.toml --ha=false`, then the web deploy.
- [ ] No doc still says proxy bidding is out of scope.

**Verification:**
- [ ] `yarn test:local` and `yarn test`; `yarn lint`; `yarn typecheck`
- [ ] Manual: owner reads the docs.

**Dependencies:** T16, T17
**Files likely touched:** `docs/decisions/bidding.md`, `docs/DESIGN.md`, `docs/PROXY-BIDDING-PLAN.md`, `tasks/*`
**Estimated scope:** Small (docs)

### Checkpoint E: ready for a PR
- [ ] All acceptance criteria above met; every suite green
- [ ] Owner approves opening the PR (commit and push only when asked)
