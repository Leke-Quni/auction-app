# Implementation Plan: Proxy bidding

Planned 2026-11-12. Source: `docs/PROXY-BIDDING-PLAN.md` (the design: rules, data model, failure modes, test plan), treated here as the task. Task details, acceptance criteria and verification live in `tasks/todo.md`; this file holds the order, the decisions and the risks. Nothing is built yet.

## Overview

Today a bid is a price. With proxy bidding the number a bidder types is a hidden **maximum**: the system bids for them, one increment at a time, up to it, and they pay only the price. Minimum rule (current + max(€1, 5%)), anti-sniping, binding bids, strikes, rate limits, idempotency, audit log and payment-after-close stay as they are.

## Project rules that apply (CLAUDE.md, memory)

- `DESIGN.md` lists proxy bidding as out of scope: **T0 (owner decisions) comes before any code.**
- Build one slice at a time and stop after each checkpoint so the owner can test, change or remove it.
- Run the relevant tests after each task and report failures honestly. Never commit or push unless asked.
- Match surrounding style; keep changes minimal; record decisions in `docs/decisions/bidding.md`.

## Architecture decisions (assumed defaults = my recommendations; the owner confirms in T0)

- **Rules live in one pure function in `packages/shared`** (`resolveProxyBid`), so web, API and tests agree; the API only supplies the clock and the database rows.
- **Postgres still decides every bid** in the existing listing-row-locked transaction. New reads/writes inside the lock: the leader's `AutoBid` row, the leader's eligibility (D8), up to three `Bid` inserts, one `AutoBid` upsert.
- **`Bid` stays the single history table.** New `kind` (`BID`, `AUTO`, `RAISE`), `maxCents` (what the bidder typed), `outcome` (for exact replays) and `seq` (strict order). New `AutoBid(listingId, bidderId, maxCents)` holds the current maximum. `bidCount` counts visible rows (`BID` + `AUTO`).
- **Wire compatibility:** keep the field name `amountCents` (it now means the maximum) and only add response fields, so the API can deploy before the web.
- **Vertical order:** foundation (rules, schema, seed) first, then the bid path in small API slices, then events, readers, UI. Every task leaves the existing system working and its tests green.

## Task list (index; details in `tasks/todo.md`)

### Phase 0: Decide
- [x] T0: Owner decisions D0 to D14 and the docs updated

### Phase 1: Foundation
- [x] T1: The resolver (`resolveProxyBid`) with table and invariant tests
- [x] T2: Database migration and schema (`AutoBid`, new `Bid` columns, backfill)
- [ ] T3: Seed and bot bidder keep working and gain a proxy scenario

### Checkpoint A: foundation

### Phase 2: The bid path (API)
- [ ] T4: First bid, takeover, defence and tie through the resolver
- [ ] T5: Raising your own maximum
- [ ] T6: Idempotency and replay for multi-row bids
- [ ] T7: Reserve lift
- [ ] T8: Anti-sniping on price changes
- [ ] T9: Ineligible leaders (banned, closing, two strikes)

### Checkpoint B: the API places proxy bids correctly

### Phase 3: Events and notifications
- [ ] T10: Realtime: several rows per event, live store, no leaks
- [ ] T11: Notifications go to the right person

### Phase 4: Everything else that reads bids
- [ ] T12: Runner-up, history, admin bid lists and counts

### Checkpoint C: backend complete

### Phase 5: UI
- [ ] T13: The viewer's own maximum reaches the listing page
- [ ] T14: Bid panel: maximum wording, raise form, outcome messages
- [ ] T15: Toasts, bell and emails

### Checkpoint D: usable by hand in the browser

### Phase 6: Hardening and release
- [ ] T16: Concurrency tests redefined, plus the no-leak and invariant checks
- [ ] T17: Playwright specs, bot and seed scenarios
- [ ] T18: Docs final, full suite, deploy notes

### Checkpoint E: ready for a PR

## Dependency graph

```
T0 ─┬─ T1 ──┐
    └─ T2 ──┼─ T4 ─┬─ T5 ─┐
       T3 ──┘      ├─ T6   ├─ T7, T8, T9 ─ T10 ─ T11 ─┐
                   │       │                          │
                   └───────┘                T12 ──────┤
                                                      ├─ T13 ─ T14 ─ T15 ─ T16 ─ T17 ─ T18
```
T12 depends on T2 and T4 only and can run alongside T10/T11. T13 needs the response shape from T4. T14 can start after T13.

## Parallelisation

- Safe to run in parallel once their dependencies are done: T3 with T4; T12 with T10 and T11; T15 with T14 (different files).
- Must be sequential: T2 (migration) before any API task; T4 before T5 to T9 (same file, same transaction); T7, T8, T9 edit `placeBid` and should land one at a time.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Replay check compares `amountCents`, which now differs from what was typed | High: every proxy bid looks like a key reuse | Compare `maxCents`; own task (T6) and test |
| `bidCount` jumps by 2 and the live store thinks it missed a bid | Med: a page refresh on every fight | Gap rule compares against the rows in the event (T10) |
| The maximum leaks through a public payload, history, admin page or log | High | Public payloads built from rows only; a test greps them for the number (T16) |
| Banned or struck leader keeps bidding automatically | High | T9 ignores their maximum |
| Lock held longer under 50 simultaneous bids | Med | Measure the existing concurrency test before and after (T16) |
| Old tests encode one-row-per-bid | Med: slow slog | Fix the tests inside the task that changes the behaviour, never in a batch at the end |
| New API with old web, or the reverse | Low | Superset responses; API deploys first; web treats a missing `outcome` as leading |
| Migration applied after the API deploy | High: every bid fails | Deploy notes (T18): migration first, check status, then API, then web |
| The admin "Auctions they bid on" page (built 2026-11-12) counts every `Bid` row | Low | T12 filters `RAISE` out of its counts |

## Open questions (for the owner, T0)

- D0 to D14 in `docs/PROXY-BIDDING-PLAN.md` section 4. Highest impact: D1 reserve lift, D6 outbid toast, D8 banned leaders, D2 whether a losing challenger extends the auction.
- Whether to rename the wire field `amountCents` to `maxCents` after both apps are deployed (D11).
