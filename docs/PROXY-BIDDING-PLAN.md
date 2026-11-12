# Proxy bidding: implementation plan

Status: draft for the owner, written 2026-11-12. Nothing in this plan is built yet. `docs/DESIGN.md` currently lists proxy bidding as out of scope, so slice 0 (the owner's decisions, recorded in `docs/decisions/bidding.md`) comes before any code.

Built from a read of: `apps/api/src/bids/*`, `packages/shared/src/bids.ts` and `realtime.ts`, `auction-close.service.ts`, `order-expiry.service.ts`, `realtime/notifications.service.ts` and `realtime.gateway.ts`, `search-sync.service.ts`, `account-deletion.service.ts`, `admin-listings.service.ts`, `listing-retention.ts`, the bid migrations, the seed code, and the web files `bid-panel.tsx`, `live-auction.tsx`, `bid-actions.ts`, `notifications.tsx`. Files I did not open (e.g. `listings/[id]/page.tsx`, `listings.service.ts` view fields, the e2e specs) are marked "check" below.

---

## 1. What changes for users

Today a bid is a price: you type €50, the price becomes €50. With proxy bidding the number you type is a **maximum**. The system bids for you, one increment at a time, only as far as needed to keep you ahead, up to your maximum. Nobody else sees your maximum. You pay the price, never the maximum.

Kept as they are: the minimum-bid rule (current + max(€1, 5%)), anti-sniping (2 minutes, 24-hour ceiling), binding bids (no lowering or withdrawing), seller cannot bid, two strikes block bidding, rate limits, idempotency keys, the audit log, payment after close.

---

## 2. How bidding works today (from the code)

- `BidsService.placeBid` runs one transaction. It locks the listing row (`SELECT … FOR UPDATE`), reads the database clock, checks seller / live / strikes / `ALREADY_HIGHEST` / minimum, inserts one `Bid`, writes a `BidAudit` row, and updates `Listing` (`currentBidCents`, `bidCount + 1`, `highBidderId`, `endsAt`, `extensionCount`).
- After commit it publishes `BidPlaced` (and `AuctionExtended`) on the in-process `AuctionEvents`. The gateway, `NotificationsService` and `SearchSyncService` subscribe.
- `Bid` is one row per accepted bid. Unique `(bidderId, idempotencyKey)`. A replay compares `earlier.amountCents` to the input.
- DB check `Listing_bid_fields_agree`: no bids means no current bid, no count and no high bidder; any bid means all three are set.
- Readers of `Bid` outside the bid service: history (`ORDER BY amountCents DESC, id DESC`), runner-up selection in `order-expiry.service.ts` (`MAX(amountCents)` per bidder), the close (distinct bidders for "you did not win" emails), `notifications.service.ts` (distinct bidders for the extension toast), `admin-listings.service.ts` (distinct bidders on removal), `listing-retention.ts` (`count` of a viewer's bids), seed code.
- Web: `BidPanel` (amount box starts at the minimum, second-click confirm, 10× warning, mode `highest` shows only "You are the highest bidder"), `LiveAuction` zustand store (`applyBid` ignores events whose `bidCount` is not higher than held, and refreshes the page if `bidCount > held + 1`), outbid toast with a one-click "Bid €minimum".

---

## 3. Proposed model

### 3.1 Data

| Change | Purpose |
|---|---|
| New table `AutoBid(listingId, bidderId, maxCents, updatedAt)`, unique `(listingId, bidderId)` | Each bidder's current maximum on an auction. Only ever raised (`GREATEST`). Never sent to anyone but its owner. |
| `Bid.kind` enum `BID | AUTO | RAISE` (default `BID`) | `BID` = the row a request produced (visible). `AUTO` = a row the system placed for the current leader. `RAISE` = a request that only raised the leader's own maximum (hidden, no price change, kept for idempotency and audit). |
| `Bid.maxCents Int?` | What the bidder typed in the request (null on `AUTO`). Replay checks compare this, not `amountCents`. |
| `Bid.outcome` enum (`LEADING`, `OUTBID_BY_PROXY`, `MAX_RAISED`), nullable | Stored on request rows so a replay can answer exactly what happened the first time. |
| `Bid.seq` identity column | A strict order inside one transaction (two rows share a timestamp and can share an amount). History orders by `amountCents DESC, seq DESC`. |

`Listing` keeps `currentBidCents`, `bidCount`, `highBidderId`. `bidCount` counts visible rows (`BID` + `AUTO`), i.e. what the history shows. The DB check stays as is.

Backfill in the migration: for every `Bid`, `maxCents = amountCents`, `kind = BID`; for every (listing, bidder) with bids, an `AutoBid` row with their highest amount. Auctions that are live at deploy time then behave as if every bid had been a maximum equal to itself.

### 3.2 Resolution rules (one pure function in `packages/shared`, so web, API and tests agree)

Notation: `P` current price, `S` starting price, `R` reserve (optional), `L` current leader with maximum `Ml`, challenger `C` with maximum `M`, `inc(p) = max(100, ceil(p × 5%))`, `next(p) = p + inc(p)`, `minNext(P)` is today's `minimumNextBidCents`.

1. **No bids yet.** Require `M ≥ S`. `C` leads. Price is `S` (not `M`). One `BID` row at `S`.
2. **`C` is the leader.** Require `M > Ml`, otherwise refuse `MAX_NOT_HIGHER`. Store the new maximum. Price unchanged. One hidden `RAISE` row. No extension, no bid-count change, no outbid notice.
3. **`C` is someone else.** Require `M ≥ minNext(P)`, otherwise `TOO_LOW` (as today). Then:
   - **`M > Ml`: `C` takes the lead.** If `Ml > P`, first an `AUTO` row for `L` at `Ml`. Then a `BID` row for `C` at `min(M, next(Ml))`. `L` is outbid.
   - **`M = Ml`: tie, the earlier maximum wins.** A `BID` row for `C` at `M`, then an `AUTO` row for `L` at `M`. `L` keeps the lead at price `M`.
   - **`M < Ml`: `L` defends.** A `BID` row for `C` at `M`, then an `AUTO` row for `L` at `min(Ml, next(M))`. `C` is told at once that a higher maximum exists.
4. **Reserve** (decision D1): after steps 1 to 3, if `R` is set and the leader's maximum is at least `R` and the price is below `R`, the price rises to `R` (an `AUTO` row for the leader at `R`). Without this a lone bidder whose maximum is above the reserve would still end with "no sale".
5. **Time.** Every request that creates a `BID` or `AUTO` row is a price change and uses the same anti-sniping call as today (`endsAtAfterBid`) with the one database-clock reading. `RAISE` never extends.

Worked examples (starting price €10):

| # | Action | Rows created | Price | Leader |
|---|---|---|---|---|
| 1 | A sets max €50 | A €10 | €10 | A |
| 2 | B sets max €20 | B €20, A(auto) €21 | €21 | A |
| 3 | B sets max €60 | A(auto) €50, B €52.50 | €52.50 | B (A is outbid) |
| 4 | A sets max €60 (tie) | A €60, B(auto) €60 | €60 | B (earlier) |
| 5 | B raises max to €80 | RAISE (hidden) | €60 | B |
| 6 | Reserve €100, A sets max €150 on a fresh auction | A €100 | €100 | A |

### 3.3 API

- Keep `POST /listings/:id/bids` and the `amountCents` field name on the wire for now (decision D11). The new web and the old web both work against the new API; the old web just keeps its "bid" wording until it is redeployed.
- Response is a superset of today's: adds `outcome`, `yourMaxCents`, `rows` (the visible rows created). `bid` stays and is the top row. `previousHighBidderId` keeps its meaning ("the leader before this request, if the leader changed, else null"); a new `requestedBy` names the bidder who asked.
- New refusal `MAX_NOT_HIGHER` (409). `ALREADY_HIGHEST` is retired. `BID_REFUSALS`, `BID_REFUSAL_MESSAGES` and `REFUSAL_STATUS` are typed `Record<BidRefusal, …>`, so the compiler will point at every place.
- Viewer-only data: the listing page needs the signed-in viewer's own maximum. Check how `listings/[id]/page.tsx` and `listings.service.ts` build viewer fields (e.g. `highBidder` / `phase`) and add `viewerMaxCents` there, or a `GET /listings/:id/my-bid`.

---

## 4. Decisions the owner must make (with my recommendation)

| ID | Question | Recommendation |
|---|---|---|
| D0 | Overturn "no proxy bidding in v1" in `DESIGN.md` §2 and the out-of-scope list. | Yes, record date and reason in `docs/decisions/bidding.md`. |
| D1 | Reserve: raise the price to the reserve when the leader's maximum covers it? | Yes (as eBay does). The reserve is public, so nothing is hidden by it. |
| D2 | Does a challenger who loses at once (case `M < Ml`) extend the auction? | Yes: the price moved. A hidden raise does not. |
| D3 | Ties | Earlier maximum wins. |
| D4 | Mark automatic rows in the public history? | No label. Just the amounts and who. |
| D5 | Can a maximum be lowered or withdrawn? | No (bids are binding). |
| D6 | The outbid toast's one-click "Bid €minimum" | Replace by "Raise your maximum" linking to the listing page, because a one-click minimum is now an easily beaten maximum. |
| D7 | First bid shows the starting price, not the typed amount | Yes. |
| D8 | A leader who is banned, has a deletion request, or has two strikes: does their maximum keep defending? | No. Treat them as a plain bid at the current price (`Ml = P`). Otherwise a banned account keeps bidding automatically. |
| D9 | `bidCount` counts automatic rows | Yes (matches the history). "Most bids" sort gets slightly inflated. |
| D10 | Keep the 10× warning and second click | Yes; the wording changes to "maximum". |
| D11 | Wire field name | Keep `amountCents` until both apps are deployed, rename later if wanted. |
| D12 | Rate limits (10 a minute per user) | Unchanged. |
| D13 | Can admins see maximums? | No, until there is a support reason. |
| D14 | Runner-up price after a non-payer | The runner-up's highest visible bid, as today. Not their hidden maximum. |

---

## 5. Slices and steps

Each slice ends with tests passing and stops for the owner to check before the next one starts (project rule).

### Slice 0: Decisions and docs (no code)
1. Owner answers D0 to D14.
2. Update `docs/DESIGN.md` §2 (bid rules) and the out-of-scope line, and the short bidding and notifications bullets in §4; put the detail (the listing-page bid box, notifications, the decision with date and reason) in `docs/decisions/bidding.md`, where the long versions now live; fix the runner-up line in `docs/decisions/close-payment-delivery.md`.

Done when: the docs match the agreed model and the owner has read them.

### Slice 1: The rules, as pure code (`packages/shared`)
1. `resolveProxyBid(input)` returns the rows to create, the new price and leader, the outcome, and whether it is a price change. No database, no clock.
2. Exhaustive table tests for every case in 3.2 and the examples in 3.2.
3. Randomised invariant tests with a seeded generator: price never exceeds the leader's maximum; price never drops; price is at least `S`; the leader is the highest maximum with ties to the earlier; every created row's amount is at least the previous row's; rows alternate correctly; cap `MAX_BID_CENTS` never breaks the 32-bit column.
4. Keep `minimumNextBidCents`, `endsAtAfterBid`, `extensionCeiling` untouched.

Done when: shared tests pass and cover every branch.

### Slice 2: Database
1. Prisma migration: `AutoBid`, `Bid.kind`, `Bid.maxCents`, `Bid.outcome`, `Bid.seq`; backfill as in 3.1. Additive, so the old API code keeps working against it.
2. Update `schema.prisma` and regenerate the client.
3. Update the seed (`seed-bids.ts`, `seed-data.ts`, `seed-scenarios.ts`) so every seeded bid also has its `AutoBid` row, `kind`, `maxCents`, `seq`, and the existing consistency test passes. Add one named scenario: an auction where a leader's hidden maximum is well above the price and a challenger loses at once.
4. DB test: the unique rule on `AutoBid`, the backfill result on a few shapes (no bids, one bidder, two bidders).

Done when: migration applies to an empty and to a seeded database, `seed` and `seed 0` still work.

### Slice 3: The bid transaction (`BidsService`)
Build in this order, each step with its own tests:
1. Request and response types; `MAX_NOT_HIGHER` refusal in shared and the API.
2. Replace the `ALREADY_HIGHEST` and `TOO_LOW` block with the rules: read the leader's `AutoBid` (and, for D8, the leader's ban, deletion and strike state) inside the lock.
3. No-leader and takeover cases (rows, listing update, `AutoBid` upsert with `GREATEST`).
4. Defence and tie cases.
5. Own-maximum raise (`RAISE` row, no price change).
6. Reserve lift (needs `reservePriceCents` added to the `LockedListing` select).
7. Anti-sniping on any price change; ceiling respected; `extensionCount` increments once per request, not once per row.
8. Idempotency and replay: replay is found by the request row's key; compare `maxCents`; answer from the stored `outcome` plus the current listing; `AUTO` rows use the key `auto:<request row id>`, which can never collide with a user key.
9. Audit rows: `ACCEPTED` records the typed maximum as today; add a reason such as `PROXY_DEFENDED` or `MAX_RAISED` for the new outcomes.
10. `bidFailure` mapping unchanged; confirm `P2002` on an `auto:` key cannot happen except through the same request.

Done when: the existing bid e2e suites are updated to the new semantics and pass, and the 50-simultaneous-bids test still gives one consistent winner (see test plan).

### Slice 4: Events, realtime, notifications, search
1. `BidResult` gains `rows`, `outcome`, `requestedBy`. The event carries it.
2. `BidPlacedEvent` (public) keeps `bid` (the top row) and gains `bids` (all visible rows, newest last). Maximums never appear.
3. `LiveAuction`: `applyBid` merges all `bids`; `bidCount` can jump by 2, so the "gap" refresh rule (`bidCount > held + 1`) must compare against the number of rows in the event, or every proxy fight triggers a page refresh.
4. `NotificationsService.onBid`:
   - the outbid notice goes to `previousHighBidderId` only when the leader changed (as now);
   - "bidding again means they are here" must clear the **requester's** pending outbid email, not the new leader's;
   - the extension toast list excludes the requester as well as the leader and the outbid bidder.
5. `SearchSyncService.onBid` needs no change in logic (it reads price and count from the result); add a test.

Done when: two browsers watching the same auction see consistent price, history and counts through a defended bid and a takeover.

### Slice 5: Other code that reads bids
1. Runner-up (`order-expiry.service.ts`): `MAX(amountCents)` over rows where `kind <> 'RAISE'` (D14), so a hidden raise never counts as a bid.
2. History (`BidsService.history`): exclude `RAISE`, order by `amountCents DESC, seq DESC`, total from `bidCount`.
3. `hasStake`, close "you did not win" emails, `tellBidders`, extension toast list: they use distinct bidders, so a `RAISE`-only bidder cannot exist (a raise needs a prior bid). Confirm by test, change nothing.
4. Account deletion: `HIGH_BIDDER` blocker stays valid. A user who deletes or is banned after bidding while not leading has an `AutoBid` row that is simply ignored (D8).
5. Admin: no maximum shown (D13). Check the admin listing and user pages still count correctly (`bidCount`, user `_count.bids` includes `RAISE` and `AUTO` rows; decide whether the user page should count only their own `BID` rows).

### Slice 6: Web UI
1. `bid-actions.ts`: result adds `outcome`, `yourMaxCents`, `currentBidCents`.
2. `BidPanel`: label "Your maximum bid (€)"; help text "We bid for you, one step at a time, up to this amount. You only pay what is needed to stay ahead. A maximum cannot be lowered or withdrawn."; confirmation text names the maximum; modes:
   - `live` (not leading): box starts at the minimum.
   - `highest` (leading): shows "You are the highest bidder. Your maximum: €X" and a form to raise it (box starts at current max + one step); refuses a non-higher value on the client.
3. After a bid, show one of three messages from `outcome`: "You are the highest bidder at €X" / "Someone has a higher maximum. The price is now €X" (with a button to raise) / "Your maximum is now €Y".
4. Toasts and bell: outbid wording ("Someone's maximum is higher than yours"); replace the one-click button by a link (D6).
5. Outbid email wording in `notifications.service.ts` (and the other copy) mentions the maximum.
6. Listing page: pass `viewerMaxCents` into the panel; the live store re-syncs it after each bid.
7. History table: nothing hidden or labelled (D4); it just lists more rows per event.

Done when: the screens are checked by hand in a browser (leading, defended, outbid, raise, reserve, extension, signed-out, seller, blocked) with screenshots.

### Slice 7: Tests, tools, deploy notes
1. Update the Playwright spec `apps/e2e/tests/bidding.spec.ts` (labels and the "below the minimum" flow), check `win-and-pay.spec.ts` for bid steps.
2. Update the bot bidder: bids as a maximum; optional `--proxy` mode.
3. Run the whole suite (`yarn test:local` for the API) and the web/shared tests; fix the fallout.
4. Update the decision docs with what was actually built.
5. Deploy notes for the owner: run the migration first, then deploy the API, then the web; check live migration status before deploying.

---

## 6. What can fail, and when

| # | When | What goes wrong | How the plan prevents it |
|---|---|---|---|
| 1 | Two bids at once on a hot auction | A second request judges against a stale leader or maximum | Everything, including the `AutoBid` read, runs after the listing row lock. The `AutoBid` write happens after the lock too, so lock order is always listing then `AutoBid`: no deadlock. |
| 2 | A request creates two or three rows and the connection drops mid-way | Half a bid | One transaction; all rows or none. |
| 3 | Client retries after a timeout | Double placement, or an answer that does not match the first | Replay found by the request row's key; answer built from the stored `outcome`. |
| 4 | Replay check compares `amountCents` | Every proxy bid looks like a "key reused" error, because the stored visible amount differs from what was typed | Compare `maxCents`. Listed as its own test. |
| 5 | The same key is used for a different max | Silent acceptance | `KEY_REUSED` as today, on `maxCents` and listing. |
| 6 | Auto row collides with a user key | `P2002` | Auto rows use `auto:<request row id>`; the prefix is not allowed by the user key regex (`^[A-Za-z0-9_-]+$` has no colon). |
| 7 | Auctions live when the migration lands | Leaders have no `AutoBid` row | Backfill; code also treats a missing row as `Ml = P`. |
| 8 | Rounding at the edges (5% of odd cents, €1 floor) | Off-by-one-cent prices, or a price above the leader's maximum | One shared function, invariant tests, `Math.min` with the maximum on every price. |
| 9 | Bid near the €10,000,000 cap | `next()` overflows the 32-bit column | `min(M, next(Ml))` and `M ≤ MAX_BID_CENTS` mean the price never exceeds a typed value; existing reasoning for the cap stays. |
| 10 | Equal amounts on two rows (tie) | History order flips, the top row is not the leader | `seq` column and `ORDER BY amountCents DESC, seq DESC`. |
| 11 | Leader's maximum is above the reserve but the price is not | Auction ends "no sale" though a willing buyer exists | Reserve lift (D1), tested at close. |
| 12 | A late bid that loses immediately | Auction extended or not inconsistently | D2 decided; one code path for "price changed". |
| 13 | A raise-only request near the end | Extension used as a stall | `RAISE` never extends. |
| 14 | Leader is banned, deleted, or gets a 2nd strike elsewhere mid-auction | Their maximum keeps bidding automatically | D8: ignored when judging. Needs one extra read inside the lock. |
| 15 | Seller removal or close at the same moment | A bid sneaks in after the end | Unchanged: close and removal use the same lock and the database clock; the `NOT_LIVE` check stays before any rule. |
| 16 | Two rows in one event reach the browser | The store thinks it missed a bid and reloads the page for every fight | Gap rule compares `bidCount` against the rows in the event (slice 4). |
| 17 | New API, old web (during rollout) | Old web ignores `rows`/`outcome`; users see "Your bid was placed" for a defended bid | Superset response; API deployed first; the mismatch lasts only until the web deploy. Old web with `highest` mode shows no raise box, which is acceptable for the window. |
| 18 | New web, old API | New fields missing | Deploy order: API first. The web treats missing `outcome` as `LEADING`. |
| 19 | Outbid notice sent to the wrong person | The challenger who lost at once gets an outbid toast, or the leader is told they were outbid when they were not | The notice goes to `previousHighBidderId` only if the leader changed; test both. |
| 20 | Requester's own pending outbid email is not cleared | They get an email about an auction they just bid on | Clear by `requestedBy` (slice 4). |
| 21 | The maximum leaks | A competitor reads your ceiling | Never in: the socket events, `/listings/:id`, history, the extension list, admin pages, logs. Only the owner's own `viewerMaxCents`. A test greps the public payloads for the number. The price itself still reveals a lower bound (inherent). |
| 22 | Lock held longer | More queued bids, 15 s transaction limit | Extra work inside the lock is one `AutoBid` read, one leader-status read, one upsert and up to three inserts. Measure with the 50-bid test before and after. |
| 23 | Runner-up selection counts a hidden raise | Non-payer's runner-up is offered the item at a price they never bid | Filter `kind <> 'RAISE'` and test it. |
| 24 | Runner-up's maximum is above the reserve but their last visible bid is below | Wrongly "no sale" | Not possible if the reserve lift ran while they led; covered by a test with a lift and a takeover. |
| 25 | Users misunderstand "I bid €50 and it says €21" | Support, complaints | Copy in slice 6; the confirmation says what will and will not happen. |
| 26 | Mobile/narrow layouts break with the longer panel | Overflow | Check in the browser at phone width. |
| 27 | Seed and `seed-bids.test` encode the old rules | Seed fails or produces rows the app would never create | Slice 2 updates the generator and keeps its consistency test. |
| 28 | Rollback after proxy auctions ran | Old code ignores `AutoBid`; maximums are lost; `AUTO`/`RAISE` rows look like manual bids | Door is two-way for code, but running auctions would lose hidden maximums; roll back only between auctions or accept it. |
| 29 | `bidCount` jumps by 2 | The "Most bids" sort and the cards show more bids than people bid | D9 accepted; wording is "bids", the history agrees with it. |
| 30 | Live migration not applied before deploy | New API fails on every bid | Deploy notes: migration first, check status, then API. |

---

## 7. Test plan

**Shared (unit):** table tests for each rule in 3.2 and each worked example; seeded random sequences of 1,000 requests checking the invariants in slice 1; reserve cases (below, equal, above); cap cases; increments at €0.99, €1, €20, €20.01, €1,000.

**API (integration, real Postgres and Redis):** update the existing suites that assume one row per bid: `bids.e2e`, `bids-guarantees.e2e`, `bid-protection.e2e`, `realtime.e2e`, `notifications.e2e`, `saved-notifications.e2e`, `order-expiry.e2e`, `auction-close.e2e`, `auction-end-emails.e2e`, `watchlist.e2e`, `orders.e2e`, `account-deletion.e2e`, `admin-listings.e2e`, `search-sync.test`, `postgres-search.e2e`. Add:
- a proxy fight end to end (examples 1 to 5), checking rows, price, leader, `bidCount`, `AutoBid`;
- replay of each outcome (leading, defended, raised) returns the same answer and creates no rows;
- key reuse with a different maximum;
- banned, strike-blocked and deletion-requested leader (D8);
- reserve lift at publish-to-close;
- extension by a defended bid, by a takeover, not by a raise; the 24-hour ceiling;
- runner-up after a proxy fight;
- the concurrency test: 50 simultaneous bids from distinct bidders, then check the invariants (price ≤ leader's maximum, leader holds the highest maximum, `bidCount` equals the visible rows, history strictly ordered). The old "exactly one accepted" assertion changes meaning when bids have different maximums; keep a variant where all 50 type the same amount, which still has exactly one accepted.
- the public payloads never contain a maximum.

**Web (jsdom):** `bid-panel`, `bid-actions`, `live-auction`, `live-details`, `notifications`, `notification-bell` tests updated for the new wording, the raise form and the three outcomes.

**Browser (Playwright):** update `bidding.spec.ts`; add a defended-bid scenario with two users.

**Manual check:** with the dev servers already running, bot bidder against a seeded auction, two browsers, phone width, light and dark.

---

## 8. Rough size

Slice 0: half a day of decisions. Slice 1: half a day. Slice 2: half a day. Slice 3: 1 to 1.5 days (the most delicate). Slice 4: half a day. Slice 5: half a day. Slice 6: 1 day. Slice 7: 1 day, mostly fixing tests. About 5 to 6 working days in total.
