# Implementation Plan — PRD-004 Phase 2: Banks, Kinds, Sessions, Recall

> **Scope:** all eleven Phase 2 stories (S2-01 … S2-11), one pull request per parent task, executed in the dependency order below. Tasks 1.0 and 2.0 are independent of each other; tasks 4.0, 5.0, and 6.0 are independent of each other but all depend on task 3.0; tasks 8.0 and 9.0 are independent of each other. Every other pair is sequential.
>
> **Source artifacts:** PRD `docs/requirements/prd-004-long-lived-agent-memory.md` v1.12 · Spec `workstream/specification-prd-004-long-lived-agent-memory.md` v1.2, §18 (implementation contract) · Stories `workstream/user-stories-prd-004-phase-2.md` v1.0 · Publication `workstream/github-publication-prd-004-phase-2.md`
>
> **Execution rule:** this is an existing codebase (v1.2.0), so there is no Task 0. Every parent task ends with the quality gate, the mandatory `verifier` audit, and a merged PR before the next dependent task starts. Target release: memo-cli **1.3.0** (tagging/publishing remain human-run via `scripts/release.sh`).

## GitHub Issues

| Task | Story | Issue                                                                         | Status |
| ---- | ----- | ----------------------------------------------------------------------------- | ------ |
| 1.0  | S2-01 | [#53](https://github.com/llipe/memo-cli/issues/53) (reused, Decision comment) | Open   |
| 2.0  | S2-02 | [#81](https://github.com/llipe/memo-cli/issues/81)                            | Open   |
| 3.0  | S2-03 | [#82](https://github.com/llipe/memo-cli/issues/82)                            | Open   |
| 4.0  | S2-04 | [#83](https://github.com/llipe/memo-cli/issues/83)                            | Open   |
| 5.0  | S2-05 | [#84](https://github.com/llipe/memo-cli/issues/84)                            | Open   |
| 6.0  | S2-06 | [#85](https://github.com/llipe/memo-cli/issues/85)                            | Open   |
| 7.0  | S2-07 | [#86](https://github.com/llipe/memo-cli/issues/86)                            | Open   |
| 8.0  | S2-08 | [#87](https://github.com/llipe/memo-cli/issues/87)                            | Open   |
| 9.0  | S2-09 | [#88](https://github.com/llipe/memo-cli/issues/88)                            | Open   |
| 10.0 | S2-10 | [#89](https://github.com/llipe/memo-cli/issues/89)                            | Open   |
| 11.0 | S2-11 | [#90](https://github.com/llipe/memo-cli/issues/90)                            | Open   |

## Relevant Files

**New**

- `src/lib/entry-normalize.ts` — pure read-boundary normalization of v1 payloads (`bank`, `kind`, booleans)
- `src/lib/bank.ts` — bank resolution (`resolveBank`, `defaultKind`, `isPrivateBank`, `policyFor`)
- `src/lib/filters.ts` — `buildBaseFilter` (bank/kind/state/session/as-of)
- `src/lib/duration.ts` — parses `--expires-in`/`--older-than` durations (`\d+[dhm]`)
- `src/lib/read-flags.ts` — shared `--bank`/`--kind`/`--session`/`--include-*`/`--as-of` parsing and validation
- `src/lib/recall.ts` — pure `assembleRecall` (section caps, trimming order, dedup, budget)
- `src/lib/migrate.ts` — pure `planMigration`, rules schema, exhaustiveness check
- `src/commands/timeline.ts`, `src/commands/recall.ts`, `src/commands/bank.ts`, `src/commands/migrate.ts` — new commands
- `tests/unit/lib/{entry-normalize,bank,filters,duration,read-flags,recall,migrate}.test.ts`
- `tests/unit/types/entry.test.ts`
- `tests/unit/commands/{timeline,recall,bank,migrate}.test.ts`
- `tests/integration/commands/{timeline,recall,bank,migrate}.test.ts`
- `docs/adr/` — new ADR for one-collection `bank`+`kind` isolation (task 11.0)

**Modified**

- `src/types/config.ts` — `schema_version` enum `'1'|'2'`, `bank`, `banks` (kb/private × self/episodic/semantic policy), `recall.max_tokens`
- `src/types/entry.ts` — `EntryPayloadV2Schema` superset, kind/bank `superRefine` rules, `entry_type` gains `policy`/`observation`, `source` gains `scan`
- `src/lib/dedupe.ts` — `buildDedupeKeyV2` (per-kind), `sourceToConfidence('scan')`
- `src/lib/qdrant.ts` — 12 new payload indexes, `scrollOrdered`, `scrollAll`, `count`, `setPayload`, `batchSetPayload`, `fetchStalenessCorpus` (replaces `fetchByRepo`)
- `src/lib/search-filters.ts`, `src/lib/list-filters.ts` — accept and merge a `base` filter
- `src/commands/write.ts` — `--bank/--kind/--session/--seq/--context/--provenance/--manual/--supersedes/--pin/--expires-in`, v2 payload build order, soft-cap warning
- `src/commands/search.ts` — read-flags, `base` filter wired through dense/lexical/staleness, `--kind self` unranked path, `rankCandidates()` extraction for reuse by `recall`
- `src/commands/list.ts`, `src/commands/tags.ts`, `src/commands/read.ts` — read-flags, v2 fields, provenance `(deleted)` markers
- `src/commands/setup.ts` — `--v2` init flag, resolved bank default in `validate`
- `src/commands/inspect.ts` — `banks` facet
- `src/index.ts` — register `timeline`, `recall`, `bank`, `migrate`
- `tests/unit/commands/{write,search,list,tags,read,setup,inspect}.test.ts`, `tests/unit/lib/{config,qdrant,dedupe,search-filters,list-filters}.test.ts`, `tests/integration/commands/{write,search,read,setup,migrate}.test.ts`
- `tests/relevance/replay.test.ts` — AC-2.3 identity assertion added
- `README.md`, `docs/data-model.md`, `docs/system-overview.md`, `docs/technical-guidelines.md`, `/TESTING.md`, `docs/requirements/prd-004-long-lived-agent-memory.md`
- `.claude/skills/memo-cli-usage/SKILL.md`, `REFERENCE.md` (this repo's copy; task 10.0 also touches `llipe/dev-tasks`)

## Migration Posture (applies per task; see task 9.0 for the one exception)

Every task except **9.0** changes no stored payload — new v2 fields are written only by new/updated writes (task 4.0 onward) and read paths treat their absence as v1 via `normalizeEntry` (task 1.0). Migration artifacts are **not required** for tasks 1.0–8.0 and 10.0–11.0; the opt-out rationale is recorded per task. **Task 9.0 is itself the migration artifact** (`memo migrate --to-v2`): it is exercised only against the isolated `memo_eval` collection during this phase's development and testing — applying it to the production `decisions` collection is an explicit, separate, user-confirmed step performed after the 1.3.0 release, never run automatically by any task here.

## Tasks

- [ ] 1.0 Implement Story S2-01: Config v2 and payload schema v2 — [#53](https://github.com/llipe/memo-cli/issues/53)

  > Note: reconciles issue #53 ("separate episodic and semantic memory stores") as one collection with a `kind` field per PRD §2.5, per the Decision comment already posted on the issue. Nothing user-visible changes in this task — v1 config and v1 writes still work unchanged.
  - [ ] 1.1 Write `tests/unit/lib/config.test.ts` cases: v1 file unchanged; every `banks.*` §8.4 default; `kb` `purge_after_days` absent → `undefined`, explicit → kept; `soft_cap`/`max_tokens` rejections; unknown keys preserved
  - [ ] 1.2 Write `tests/unit/types/entry.test.ts`: one case per AC5 rule (self-in-kb, episodic-without-session, agent-semantic-without-provenance, self-with-retention-fields, seq-on-non-episodic) plus positive cases per kind and `source: scan`
  - [ ] 1.3 Write `tests/unit/lib/entry-normalize.test.ts`: v1 payload → defaults; v2 payload untouched; missing `timestamp_utc` handled
  - [ ] 1.4 Write `tests/unit/commands/setup.test.ts` cases for `--v2` output shape
  - [ ] 1.5 Extend `src/types/config.ts`: `schema_version: z.enum(['1','2'])`, `bank`, `banks.{kb,private}.{self?,episodic,semantic}` (`KindPolicySchema`, `SelfPolicySchema`), `recall.max_tokens`; export `DEFAULT_*` constants per §18.2
  - [ ] 1.6 Add `EntryPayloadV2Schema` to `src/types/entry.ts` with the §18.3 `superRefine` rule table; keep the v1 `EntryPayloadSchema` export; extend `entry_type` (`policy`, `observation`) and `source` (`scan`)
  - [ ] 1.7 Add `sourceToConfidence('scan') === 'low'` to `src/lib/dedupe.ts`
  - [ ] 1.8 Create `src/lib/entry-normalize.ts` (`normalizeEntry`, pure)
  - [ ] 1.9 Add `--v2` to `memo setup init`; print resolved default bank in `memo setup validate`
  - [ ] 1.10 Verify AC1–AC4: config resolution and validation test matrix
  - [ ] 1.11 Verify AC5–AC6: schema rule table and new enum values
  - [ ] 1.12 Verify AC7: `normalizeEntry` mapping
  - [ ] 1.13 Verify AC8: `setup --v2` / `validate` round-trip
  - [ ] 1.14 Verify AC9: full `pnpm test` green with no command behavior change (no shipped command calls the new schema/normalize yet)
  - [ ] 1.15 Edge cases: `bank` as UUID; `banks.private` partially overridden; invalid `contexts`/`provenance` entries
  - [ ] 1.16 Map every AC to its test in the PR body
  - [ ] 1.17 Migration: not required — schema definitions only, no stored data touched; record opt-out rationale in the PR body
  - [ ] 1.18 Update `docs/data-model.md`: config v2 table, payload v2 field list
  - [ ] 1.19 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`; confirm `setup.ts` coverage at or above `jest.config.ts` thresholds
  - [ ] 1.20 Run `verifier` audit (mandatory, pre-PR-ready); route drift findings to `product-engineer`
  - [ ] 1.21 Open PR against `main`, link `Closes #53` (reused issue — confirm with the user before closing a reused issue, since #53's original scope predates this PRD), obtain user approval, merge

- [ ] 2.0 Implement Story S2-02: `QdrantRepository` extensions and v2 payload indexes — [#81](https://github.com/llipe/memo-cli/issues/81)

  > Note: pure adapter work, independent of task 1.0 — can run in parallel on a separate branch.
  - [ ] 2.1 Write `tests/unit/lib/qdrant.test.ts` cases: `scrollAll` over three mocked pages (no `order_by`, correct `offset` chaining); `scrollOrdered` request shape (no `offset`); `count`; `batchSetPayload` chunking (300 ops → 2 calls); `fetchStalenessCorpus` filter shape for `kb` vs private; error mapping
  - [ ] 2.2 Write `tests/integration/lib/qdrant.test.ts` case: `ensureIndexes` on a mocked v1.2.0 `payload_schema` creates exactly 12 indexes; second run creates 0
  - [ ] 2.3 Append the 12 indexes to `PAYLOAD_INDEXES` (`bank`, `kind`, `session_id`, `contexts` keyword; `seq` integer; `archived`, `superseded`, `consolidated`, `pinned` bool; `valid_to`, `expires_at`, `archived_at` datetime)
  - [ ] 2.4 Implement `scrollOrdered(filter, { orderBy, limit, withVector })`
  - [ ] 2.5 Implement `scrollAll(filter, { batch, withVector }, onPage)` (unordered, `next_page_offset` pagination)
  - [ ] 2.6 Implement `count(filter)`
  - [ ] 2.7 Implement `setPayload(id, payload)` and `batchSetPayload(ops)` (256-op chunking)
  - [ ] 2.8 Implement `fetchStalenessCorpus({ bank, repos }, limit)`; remove `fetchByRepo` once its only caller (`search.ts`, task 5.0) moves off it — acceptable to land the removal in either this task or task 5.0, but it must not survive Phase 2
  - [ ] 2.9 Verify AC1: index count and idempotency, live against a pre-existing collection
  - [ ] 2.10 Verify AC2–AC6: unit test matrix above
  - [ ] 2.11 Verify AC7: existing `scroll`/`search`/`getById`/`getByDedupeKey`/`deleteById`/`deleteByFilter`/`upsert` tests unchanged and green
  - [ ] 2.12 Edge cases: empty collection (`scrollAll` zero `onPage` calls); page exactly `batch` long; `batchSetPayload([])` no-op; `count` on an empty-match filter; client throws mid-`scrollAll`
  - [ ] 2.13 Map every AC to its test in the PR body
  - [ ] 2.14 Migration: not required — indexes are additive and reconciled at runtime; record opt-out rationale in the PR body
  - [ ] 2.15 Update `docs/data-model.md` index table and `docs/technical-guidelines.md` adapter method list
  - [ ] 2.16 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`
  - [ ] 2.17 Run `verifier` audit (mandatory, pre-PR-ready); route drift findings to `product-engineer`
  - [ ] 2.18 Open PR against `main`, link `Closes #81`, obtain user approval, merge

- [ ] 3.0 Implement Story S2-03: Bank resolution, base filter, and dedupe v2 — [#82](https://github.com/llipe/memo-cli/issues/82)

  > Note: depends on tasks 1.0 and 2.0 (needs `KindPolicySchema`/`bank`/`banks` config and the new indexes). Unblocks every remaining task.
  - [ ] 3.1 Write `tests/unit/lib/bank.test.ts`: every resolution permutation of flag/env/config/default; invalid-value error naming its source; `defaultKind`; `policyFor` incl. the `kb`/`self` throw
  - [ ] 3.2 Write `tests/unit/lib/filters.test.ts`: filter shape per combination of bank type × kind × exclusions × session × as-of
  - [ ] 3.3 Write `tests/unit/lib/search-filters.test.ts`, `tests/unit/lib/list-filters.test.ts` cases for `base` merge semantics and the conditional `repo` clause
  - [ ] 3.4 Write `tests/unit/lib/dedupe.test.ts` cases: v2 keys per kind; `self` uniqueness across 1,000 calls; `seq` sensitivity
  - [ ] 3.5 Create `src/lib/bank.ts` (`resolveBank`, `isPrivateBank`, `policyFor`, `defaultKind`)
  - [ ] 3.6 Create `src/lib/filters.ts` (`buildBaseFilter`)
  - [ ] 3.7 Extend `src/lib/search-filters.ts` and `src/lib/list-filters.ts` to accept and merge `base`
  - [ ] 3.8 Add `buildDedupeKeyV2` to `src/lib/dedupe.ts`
  - [ ] 3.9 Verify AC1–AC3: bank resolution and policy lookup test matrix
  - [ ] 3.10 Verify AC4–AC5: filter shape and builder-merge test matrix
  - [ ] 3.11 Verify AC6–AC7: dedupe key test matrix
  - [ ] 3.12 Edge cases: `MEMO_BANK=""` treated as unset; `MEMO_BANK=KB` invalid; `asOf` boundary inclusivity/exclusivity; `--kind self --include-superseded`
  - [ ] 3.13 Map every AC to its test in the PR body
  - [ ] 3.14 Migration: not required — pure functions, no data change; record opt-out rationale in the PR body
  - [ ] 3.15 Update `docs/technical-guidelines.md` architecture tree with both new modules
  - [ ] 3.16 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`
  - [ ] 3.17 Run `verifier` audit (mandatory, pre-PR-ready); route drift findings to `product-engineer`
  - [ ] 3.18 Open PR against `main`, link `Closes #82`, obtain user approval, merge

- [ ] 4.0 Implement Story S2-04: `memo write` v2 — banks, kinds, sessions, supersede — [#83](https://github.com/llipe/memo-cli/issues/83)

  > Note: depends on task 3.0. Independent of tasks 5.0 and 6.0 (touches `write.ts` only). AC-2.1, AC-2.2, and AC-2.8 are proved here.
  - [ ] 4.1 Write `tests/unit/lib/duration.test.ts`: `2d`/`12h`/`30m` parse; invalid strings rejected; `0d` rejected
  - [ ] 4.2 Write `tests/unit/commands/write.test.ts` cases for every AC (payload shape per kind, warning text, error codes/messages, call order `getById` → `upsert` → `setPayload`)
  - [ ] 4.3 Write `tests/integration/commands/write.test.ts`: supersede round-trip (write A, write B `--supersedes A`, confirm A's `valid_to`/`superseded_by`); v1-key dedupe fallback catches a v1.2.0 duplicate; two-bank writes never share dedupe hits
  - [ ] 4.4 Create `src/lib/duration.ts`
  - [ ] 4.5 Add flags to `write.ts`: `--bank`, `--kind`, `--session`, `--seq`, `--context` (repeatable), `--provenance`, `--manual`, `--supersedes`, `--pin`, `--expires-in`
  - [ ] 4.6 Implement the §18.6 eleven-step write order: resolve bank/kind/policy → scope rules → source/entry_type defaults → build v2 payload incl. retention fields and `nextSeq` → validate → supersede target checks → soft-cap check/warning → dedupe v2 with `kb`-semantic v1 fallback → embed/upsert → supersede `setPayload` with the two-id failure message → v2 JSON result
  - [ ] 4.7 Verify AC1 (PRD AC-2.1): `--kind self` in `kb` fails `VALIDATION_FAILED`; in a private bank via `MEMO_BANK` it succeeds with the right payload
  - [ ] 4.8 Verify AC2 (PRD AC-2.2): default kind by bank
  - [ ] 4.9 Verify AC3: `kb` scope requirement unchanged; private bank optional
  - [ ] 4.10 Verify AC4: auto-`seq`, `--expires-in` parsing and defaults
  - [ ] 4.11 Verify AC5–AC6: entry_type/source defaults, provenance requirement
  - [ ] 4.12 Verify AC7 (PRD AC-2.8, write half): supersede success and every rejection path (other bank, other kind, already superseded, missing target)
  - [ ] 4.13 Verify AC8: supersede-update failure message contains both ids
  - [ ] 4.14 Verify AC9: soft-cap warning at exactly `soft_cap`, silent at `soft_cap - 1`
  - [ ] 4.15 Verify AC10–AC11: dedupe v2 + v1 fallback; full v2 JSON result shape
  - [ ] 4.16 Manual: against `MEMO_COLLECTION=memo_eval`, write one `self`, three episodic with auto-`seq`, one semantic `--supersedes`
  - [ ] 4.17 Edge cases: explicit `--seq` below existing max; `--supersedes` self-reference guard; `--bank kb --kind self` explicit; duplicate `--context` values; JSON-mode duplicate error unchanged
  - [ ] 4.18 Map every AC to its test in the PR body
  - [ ] 4.19 Migration: not required by this story — new writes are v2, existing points untouched and still readable via `normalizeEntry`; record opt-out rationale and the v1.2.x read-compatibility note in the PR body
  - [ ] 4.20 Update `README.md` write section and `docs/data-model.md` write-path notes
  - [ ] 4.21 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`; confirm `write.ts` coverage at or above `jest.config.ts` thresholds
  - [ ] 4.22 Run `verifier` audit (mandatory, pre-PR-ready); route drift findings to `product-engineer`
  - [ ] 4.23 Open PR against `main`, link `Closes #83`, obtain user approval, merge

- [ ] 5.0 Implement Story S2-05: Read-side flags on `search`, `list`, `tags`, `read`, and bank-aware staleness — [#84](https://github.com/llipe/memo-cli/issues/84)

  > Note: depends on task 3.0 (and task 2.0 for `fetchStalenessCorpus`). Independent of tasks 4.0 and 6.0. Proves PRD AC-2.3 (identity) and AC-2.4 (isolation) — treat AC-2.3 as a regression gate, not a nice-to-have.
  - [ ] 5.1 Write `tests/unit/lib/read-flags.test.ts`: valid/invalid `--kind`, `--as-of` ISO validation, `--include-*` toggles
  - [ ] 5.2 Write the AC-2.3 identity case first in `tests/relevance/replay.test.ts`: feed the recorded `candidates.json` ids through the v2 filter path, assert identical top-N to the Phase 1 recording — confirm it fails before this task's code exists, then passes after
  - [ ] 5.3 Write `tests/unit/commands/search.test.ts` cases: filter shapes shared by dense/lexical/staleness; two-bank isolation on the mocked repo; `--kind self` skips `rankResults`; `--as-of` implies `--include-superseded`
  - [ ] 5.4 Write `tests/unit/commands/{list,tags,read}.test.ts` cases: new flags, v2 JSON fields, `(deleted)` provenance marker
  - [ ] 5.5 Write `tests/integration/commands/search.test.ts` (two-bank mocked run) and `tests/integration/commands/read.test.ts` (provenance with one deleted id)
  - [ ] 5.6 Create `src/lib/read-flags.ts`
  - [ ] 5.7 Wire `base` (from `buildBaseFilter`) through `search.ts`'s dense query, lexical scroll, and staleness corpus (`fetchStalenessCorpus`, removing `fetchByRepo` if task 2.0 did not already)
  - [ ] 5.8 Add read-flags to `list.ts` and `tags.ts`; merge `base` into their filters
  - [ ] 5.9 Extend `read.ts`: v2 field printing, one `scroll({ has_id: provenance })` call, `(deleted)` markers, JSON `provenance: [{ id, deleted }]`
  - [ ] 5.10 Add `[archived]`/`[superseded]` human-output prefixes and `archived`/`superseded` JSON fields via `normalizeEntry`
  - [ ] 5.11 Verify AC1: flag validation matrix
  - [ ] 5.12 Verify AC2 (PRD AC-2.3): replay identity — this is the regression gate; do not weaken or delete the assertion to make it pass
  - [ ] 5.13 Verify AC3 (PRD AC-2.4): two-bank isolation, unit + integration + manual on `memo_eval`
  - [ ] 5.14 Verify AC4: shared base filter across dense/lexical/staleness, `fetchByRepo` no longer exists
  - [ ] 5.15 Verify AC5: `--kind self` unranked path
  - [ ] 5.16 Verify AC6: archived/superseded prefixes and fields
  - [ ] 5.17 Verify AC7: `--as-of` semantics
  - [ ] 5.18 Verify AC8: new JSON fields, no existing key changed
  - [ ] 5.19 Verify AC9: `read` provenance rendering
  - [ ] 5.20 Manual: on `memo_eval`, confirm identical search results before/after; write to two private banks (using task 4.0's write path) and search each
  - [ ] 5.21 Edge cases: `--kind all --include-archived` on an all-archived bank; `--as-of` in the future; `--as-of` before every `valid_from`; `--session` on `search` with `kind=semantic`; `read` on a v1 point
  - [ ] 5.22 Map every AC to its test in the PR body, with the AC-2.3 before/after ids included as evidence
  - [ ] 5.23 Migration: not required — read-only; v1 points pass the default filter via `is_empty`; record opt-out rationale in the PR body
  - [ ] 5.24 Update `README.md` flag tables and `docs/system-overview.md` search flow
  - [ ] 5.25 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`
  - [ ] 5.26 Run `verifier` audit (mandatory, pre-PR-ready); route drift findings to `product-engineer`
  - [ ] 5.27 Open PR against `main`, link `Closes #84`, obtain user approval, merge

- [ ] 6.0 Implement Story S2-06: `memo timeline` — [#85](https://github.com/llipe/memo-cli/issues/85)

  > Note: depends on tasks 2.0 and 3.0. Independent of tasks 4.0 and 5.0.
  - [ ] 6.1 Write `tests/unit/commands/timeline.test.ts`: scrambled-order mock → sorted output; grouping without `--session`; `--last` clamp at 500; `--since` filter shape; no `createEmbeddings` call; empty results
  - [ ] 6.2 Write `tests/integration/commands/timeline.test.ts`: three mocked episodic writes replayed in `seq` order
  - [ ] 6.3 Create `src/commands/timeline.ts`: `--bank`, `--session`, `--last` (default 50, max 500), `--since`, `--json`; `scrollOrdered` (session shape) vs `scroll` + grouping (no-session shape); register in `src/index.ts`
  - [ ] 6.4 Verify AC1 (PRD AC-2.5): seq-then-timestamp ordering regardless of content
  - [ ] 6.5 Verify AC2: grouped-by-session shape and human header
  - [ ] 6.6 Verify AC3: `--since` filter and invalid-ISO rejection
  - [ ] 6.7 Verify AC4: episodic-only, default exclusions, no embeddings/ranking call (asserted)
  - [ ] 6.8 Verify AC5–AC6: empty-result envelope; human line format
  - [ ] 6.9 Manual: on `memo_eval` after task 4.0's manual writes, run with and without `--session`
  - [ ] 6.10 Edge cases: `--last 0` rejected; `--last 501` clamped with warning; equal `seq` values; session id existing only in another bank
  - [ ] 6.11 Map every AC to its test in the PR body
  - [ ] 6.12 Migration: not required — read-only; record opt-out rationale in the PR body
  - [ ] 6.13 Update `README.md` command section and `docs/system-overview.md`
  - [ ] 6.14 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`
  - [ ] 6.15 Run `verifier` audit (mandatory, pre-PR-ready); route drift findings to `product-engineer`
  - [ ] 6.16 Open PR against `main`, link `Closes #85`, obtain user approval, merge

- [ ] 7.0 Implement Story S2-07: `memo recall` — [#86](https://github.com/llipe/memo-cli/issues/86)

  > Note: depends on tasks 5.0 and 6.0. The headline Phase 2 feature (PRD goal 3). Per decision A14, this task writes no local snapshot and updates no retrieval counters — `recall` is read-only until Phase 3.
  - [ ] 7.1 Write `tests/unit/lib/recall.test.ts` (pure `assembleRecall`): SELF complete and first; superseded `self` absent; SELF intact under a budget smaller than SELF alone; cross-section dedup; trimming order (`conflicts → last_session → mine → shared → policies`); single `query_id`; `bank=kb` omits SELF/MINE/LAST SESSION
  - [ ] 7.2 Write `tests/unit/commands/recall.test.ts`: call-count/shape assertions on the mocked repo and embeddings adapter; assert zero `setPayload`/`batchSetPayload`/filesystem calls; `--scope` reaches only the SHARED filter; POLICIES filter shape
  - [ ] 7.3 Write `tests/integration/commands/recall.test.ts`: seeded mock with two banks, one superseded `self`, one `policy` entry, a two-session episodic history — assert the full JSON bundle
  - [ ] 7.4 Extract `rankCandidates()` from `src/commands/search.ts` (over-fetch, lexical union, `rankResults`, `detectStaleness`) with no behavior change — confirm Phase 1 and task 5.0 tests stay green after extraction
  - [ ] 7.5 Create `src/lib/recall.ts` (`assembleRecall`, pure, per §8.5/§18.9 caps and trimming order)
  - [ ] 7.6 Create `src/commands/recall.ts`: gather SELF/POLICIES/SHARED/MINE/LAST SESSION/CONFLICTS per the §18.9 table, one embed call, `query_id = randomUUID()`; register in `src/index.ts`
  - [ ] 7.7 Implement the human-output renderer (section headers, `budget: used/max · truncated: …` footer) per spec §10
  - [ ] 7.8 Verify AC1 (PRD AC-2.6): section order and SELF completeness/superseded-omission
  - [ ] 7.9 Verify AC2–AC3: budget trimming behavior and honest over-budget reporting when SELF alone exceeds it
  - [ ] 7.10 Verify AC4: cross-section dedup and single `query_id`
  - [ ] 7.11 Verify AC5: section caps
  - [ ] 7.12 Verify AC6: SHARED/MINE ranked identically to `memo search`; LAST SESSION seq-ordered; SELF unscored
  - [ ] 7.13 Verify AC7: `bank=kb` omission
  - [ ] 7.14 Verify AC8: exactly one embed call, zero write calls
  - [ ] 7.15 Verify AC9: `--max-tokens` default from config, `--scope` scoping, envelope/output shape
  - [ ] 7.16 Verify AC10: POLICIES population from `kb` `entry_type=policy` entries
  - [ ] 7.17 Manual: on `memo_eval` after task 4.0's writes, run `memo recall "plan the next story" --bank <b>` human and `--json`, `--max-tokens 200`, `--bank kb`; measure and record wall time (`< 4s` target)
  - [ ] 7.18 Edge cases: bank with no episodic history; `self` count above `soft_cap`; empty task string rejected; duplicate entry in SHARED and MINE candidates (dedup keeps SHARED); huge `--max-tokens` (`truncated: []`); embeddings failure surfaces `EMBEDDING_API_ERROR` with no partial bundle
  - [ ] 7.19 Map every AC to its test in the PR body, including the recorded latency measurement
  - [ ] 7.20 Migration: not required — read-only, no local state written; record opt-out rationale in the PR body
  - [ ] 7.21 Update `README.md` (command + session protocol preview) and `docs/system-overview.md` (recall flow diagram)
  - [ ] 7.22 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`
  - [ ] 7.23 Run `verifier` audit (mandatory, pre-PR-ready); route drift findings to `product-engineer`
  - [ ] 7.24 Open PR against `main`, link `Closes #86`, obtain user approval, merge

- [ ] 8.0 Implement Story S2-08: `memo bank init|list|show` and `inspect` banks facet — [#87](https://github.com/llipe/memo-cli/issues/87)

  > Note: depends on task 4.0 (`bank init` delegates to the S2-04 write path). Independent of task 9.0.
  - [ ] 8.1 Write `tests/unit/commands/bank.test.ts`: id validation and `kb` rejection; idempotent `init`; `writeConfig` called only with `--set-default`; `list` folding of `bank`-absent points into `kb`; `show` ordering and state counts
  - [ ] 8.2 Write `tests/unit/commands/inspect.test.ts` case: `banks` facet present
  - [ ] 8.3 Write `tests/integration/commands/bank.test.ts`: init → list → show on a mocked repo with a v1 point present
  - [ ] 8.4 Create `src/commands/bank.ts` with `init`, `list`, `show` subcommands; `init` delegates to the write handler with fixed flags per §18.10; `--set-default` gates the sole `writeConfig` call (decision A13)
  - [ ] 8.5 Add a `banks` facet (counts only) to `src/commands/inspect.ts`
  - [ ] 8.6 Register `bank` in `src/index.ts`
  - [ ] 8.7 Verify AC1–AC3: init creation, idempotency, `--set-default` gating
  - [ ] 8.8 Verify AC4: `list` folding and counts
  - [ ] 8.9 Verify AC5: `show` ordering and state counts, unknown-bank zero-count response
  - [ ] 8.10 Verify AC6: `inspect` `banks` facet
  - [ ] 8.11 Manual: on `memo_eval`, `memo bank init --id smoke-bank` (twice), `memo bank list`, `memo bank show --id smoke-bank`, `memo inspect`
  - [ ] 8.12 Edge cases: id as UUID; `--tags` with one tag rejected by the 2–5 schema rule; `--set-default` with no `memo.config.json` present; `show` on an all-archived bank
  - [ ] 8.13 Map every AC to its test in the PR body
  - [ ] 8.14 Migration: not required — writes go through the S2-04 path, no existing data changes; document the 1.2.x read-compatibility caveat (a `self` point looks like an ordinary entry to 1.2.x `memo list`) in the PR body
  - [ ] 8.15 Update `README.md` command section and `docs/system-overview.md`
  - [ ] 8.16 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`
  - [ ] 8.17 Run `verifier` audit (mandatory, pre-PR-ready); route drift findings to `product-engineer`
  - [ ] 8.18 Open PR against `main`, link `Closes #87`, obtain user approval, merge

- [ ] 9.0 Implement Story S2-09: `memo migrate --to-v2` — [#88](https://github.com/llipe/memo-cli/issues/88)

  > Note: depends on tasks 1.0 and 2.0. Independent of task 8.0. **This is the one task in the plan with an active migration lifecycle — read the Migration subtasks before starting.**
  - [ ] 9.1 Write `tests/unit/lib/migrate.test.ts`: rule 1 vs rule 2 fixtures; `story` → `session_id`, absent → `legacy`; `expires_at` arithmetic; v2 points skipped; every "all" field set correctly; custom rules file incl. each `when` operator (`tags_any`, `tags_all`, `entry_type_in`, `source_in`, `repo_in`); exhaustiveness rejection when no catch-all rule exists
  - [ ] 9.2 Write `tests/unit/commands/migrate.test.ts`: dry-run issues zero write calls; page-loop call count; JSON envelope shape
  - [ ] 9.3 Write `tests/integration/commands/migrate.test.ts`: three mocked pages of v1 points — dry-run (zero writes) → real run (one `batchSetPayload` per page) → second real run (`scanned: 0`); assert no `delete*` call ever; replay-identity check after migration
  - [ ] 9.4 Create `src/lib/migrate.ts`: `planMigration` (pure), rules Zod schema with exhaustiveness validation
  - [ ] 9.5 Create `src/commands/migrate.ts`: `scrollAll` over `is_empty schema_version` → plan → `batchSetPayload` per page; `--dry-run`, `--rules <file>`, `--json`; stderr progress unless `--json`; register in `src/index.ts`
  - [ ] 9.6 Verify AC1: full planner rule table, including the "all" fields
  - [ ] 9.7 Verify AC2 (PRD AC-2.7, dry-run half): zero write calls, correct printed counts
  - [ ] 9.8 Verify AC3 (PRD AC-2.7, real-run half): one `batchSetPayload` per page; second run `scanned: 0`; no `delete*` call ever; no vector sent
  - [ ] 9.9 Verify AC4: custom `--rules` file behavior and exhaustiveness rejection
  - [ ] 9.10 Verify AC5: progress/exit-0 behavior
  - [ ] 9.11 Verify AC6: replay identity holds across the rewrite (feeds task 5.0's AC-2.3 assertion with migrated payloads)
  - [ ] 9.12 **Migration — create artifact:** `memo migrate --to-v2` itself, with `--dry-run` and `--rules`, is the migration artifact (already built in 9.4–9.5)
  - [ ] 9.13 **Migration — rollback/impact notes:** document in the PR that this is payload-only (vectors untouched), that 1.2.x ignores the added fields, and that there is no automated rollback — the practical rollback is reinstalling memo-cli 1.2.x (per spec §15)
  - [ ] 9.14 **Migration — dry-run against `memo_eval`:** `MEMO_COLLECTION=memo_eval pnpm exec node dist/index.js migrate --to-v2 --dry-run`; record the printed `by_rule` counts in the PR body
  - [ ] 9.15 **Migration — request user confirmation before any real apply:** present the dry-run counts and ask the user to confirm before running the real migration against `memo_eval` (development/testing only — **never against `decisions` in this task**)
  - [ ] 9.16 **Migration — apply (after confirmation, `memo_eval` only):** `MEMO_COLLECTION=memo_eval pnpm exec node dist/index.js migrate --to-v2`; run a second time to confirm `scanned: 0`
  - [ ] 9.17 **Migration — verify applied state:** `pnpm run eval:relevance` against `memo_eval` unchanged at 96.4%; `memo bank list` shows all migrated points under `kb`
  - [ ] 9.18 Edge cases: point with both `intent` and `outcome` tags (rule 1 applies once); `intent`-tagged point with no `story` (`legacy`); point with `bank` set but no `schema_version` (migrated, existing `bank` preserved); empty collection; non-array rules file; page boundary exactly at 256
  - [ ] 9.19 Map every AC to its test in the PR body
  - [ ] 9.20 Update `README.md` migration section (dry-run first, what changes, what does not — and that applying to `decisions` is a separate post-release step) and `docs/data-model.md`
  - [ ] 9.21 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`
  - [ ] 9.22 Run `verifier` audit (mandatory, pre-PR-ready); route drift findings to `product-engineer`
  - [ ] 9.23 Open PR against `main`, link `Closes #88`, obtain user approval, merge — note in the PR description that the `decisions` collection migration is intentionally **not** run by this PR and remains a user-run step after the 1.3.0 release

- [ ] 10.0 Implement Story S2-10: dev-tasks consumer — `MEMO_BANK`, `memo recall`, episodic writes — [#89](https://github.com/llipe/memo-cli/issues/89)

  > Note: cross-repo partition per RF-63 (spec §18.12) — this task targets `llipe/dev-tasks` and this repository's own `.claude/skills/memo-cli-usage/` copy. Depends on tasks 4.0 and 7.0 (needs the memo-cli 1.3.0 `--json` contract for `write`/`recall` to exist and be stable). Acceptance criteria reference only that contract, never memo-cli internals — do **not** start until 4.0 and 7.0 are merged and a 1.3.0-shaped build exists locally.
  - [ ] 10.1 Build memo-cli locally from the merged tasks 4.0/7.0 state (`pnpm build`) to verify the 1.3.0 `--json` contract for `write`, `recall`, `timeline`, `bank`, `migrate`
  - [ ] 10.2 Update `llipe/dev-tasks`'s `.claude/skills/memo-cli-usage/SKILL.md` and `REFERENCE.md`: document banks, kinds, `recall`, `timeline`, `bank`, `migrate`, the read-side flags, and migration guidance (dry-run first); verify every command example against the local 1.3.0 build's `--help` output
  - [ ] 10.3 Update the `developer` agent/prompt: session start becomes `memo recall "<task>" --bank $MEMO_BANK --json`, replacing the four-command sequence; document the old sequence as a fallback when `memo --version < 1.3.0`
  - [ ] 10.4 Update the `developer` agent/prompt: intent/outcome entries become `memo write --kind episodic --session ISSUE-<n> --bank $MEMO_BANK …`; ADR/decision entries stay `memo write --kind semantic` in `kb` with `--provenance` or `--manual`
  - [ ] 10.5 Update the `technical-writer`, `product-engineer`, `planner` definitions: declare `MEMO_BANK=<agent>-memory`, export it for the session
  - [ ] 10.6 Document session close as "no memo action in Phase 2; `memo used` and `memo decay` arrive with memo-cli 1.4.0"
  - [ ] 10.7 Copy the updated skill files into this repository's `.claude/skills/memo-cli-usage/` so both copies are byte-identical
  - [ ] 10.8 Verify AC1: bank id declared and exported per agent
  - [ ] 10.9 Verify AC2 (PRD AC-2.9, recall half): single-call session start documented, fallback preserved
  - [ ] 10.10 Verify AC3 (PRD AC-2.9, write half): episodic-in-bank vs semantic-in-kb write examples correct
  - [ ] 10.11 Verify AC4: session-close documentation
  - [ ] 10.12 Verify AC5: skill/reference command examples all valid against the 1.3.0 build
  - [ ] 10.13 Verify AC6: `diff -r` between the two skill directories shows no difference
  - [ ] 10.14 Verify AC7: "installed but unconfigured" / "not installed" behaviors unchanged
  - [ ] 10.15 Manual: run one `developer` session end-to-end with `MEMO_BANK=developer-memory` against `memo_eval` — `recall` at start, two episodic writes with `--session ISSUE-<n>`, `memo timeline` confirms them, `kb` receives no episodic entry; attach a transcript summary to the PR
  - [ ] 10.16 Edge cases: `MEMO_BANK` unset falls back to `kb` (private sections omitted, documented); memo-cli 1.2.x installed uses the fallback sequence; `memo recall` embeddings failure surfaces a warning and the session continues without context
  - [ ] 10.17 Map every AC to its evidence (prompt/skill diff, `diff -r` output, manual transcript) in the PR body
  - [ ] 10.18 Migration: not required — no data-model change in this repository, consumer prompts only; record opt-out rationale in the PR body
  - [ ] 10.19 Quality gate: no automated `pnpm` gate applies to prompt/skill prose — confirm both repositories' existing lint/format checks (if any) on the changed files still pass
  - [ ] 10.20 Open two PRs (one per repository per RF-63 producer/consumer ordering), each linking `Closes #89` from the `llipe/memo-cli` side, obtain user approval, merge both

- [ ] 11.0 Implement Story S2-11: Phase 2 exit gate — measure, document, release notes — [#90](https://github.com/llipe/memo-cli/issues/90)

  > Note: depends on every prior task (1.0–10.0). Mirrors Phase 1's task 8.0. Per PRD R6, a phase that lowers the top-3 hit rate does not close — if AC1 fails, only the S1-02 sweep methodology on `recency_half_life_days` is an allowed fix, and any weight change reopens PRD §8.2 with its own changelog row.
  - [ ] 11.1 Confirm `memo_eval` is fully migrated (task 9.0's second dry-run/real run reported `scanned: 0`); if not, run `memo migrate --to-v2` against `memo_eval` and confirm
  - [ ] 11.2 Run `MEMO_COLLECTION=memo_eval pnpm run eval:relevance` live with every Phase 2 feature in place; record overall and per-category numbers
  - [ ] 11.3 Run `pnpm test` and confirm `tests/relevance/replay.test.ts` (including the S2-05 AC-2.3 identity assertion) passes unweakened
  - [ ] 11.4 Run `pnpm run validate` and `pnpm run test:coverage`; record `coverage_gate: PASS | FAIL(<reason>)`; confirm `write.ts` and `setup.ts` are no longer below the `jest.config.ts` thresholds recorded as debt in Phase 1
  - [ ] 11.5 Doc sweep: `README.md`, `docs/data-model.md`, `docs/system-overview.md`, `docs/technical-guidelines.md`, `/TESTING.md`, `.claude/skills/memo-cli-usage/` — list every Phase 2 command/flag/config-key/index/file described accurately; fix any gap found
  - [ ] 11.6 Request `technical-writer` write one ADR in `docs/adr/` for "one collection, `bank` + `kind` payload isolation" (decisions A1/A2/A10) and one memo `kb` semantic entry per ADR
  - [ ] 11.7 Manual smoke on `memo_eval`: `write` (three kinds), `search`/`list`/`read` with and without new flags, `timeline`, `recall` (private and `kb`), `bank list/show`, `migrate` second run `scanned: 0`; confirm no regression in default human output
  - [ ] 11.8 Verify AC1: eval number ≥ 96.4% floor, recorded in the PRD changelog
  - [ ] 11.9 Verify AC2: replay test passes unweakened
  - [ ] 11.10 Verify AC3: quality gates and coverage recorded honestly
  - [ ] 11.11 Verify AC4: doc drift sweep, gaps listed and fixed in the PR body
  - [ ] 11.12 Verify AC5: ADR written and cross-referenced in memo
  - [ ] 11.13 Verify AC6: manual smoke transcript
  - [ ] 11.14 Verify AC7: PRD changelog row added; PRD §13 Phase 2 boxes AC-2.1…AC-2.9 ticked with the proving task cited; release notes drafted for 1.3.0 with the migration instruction (`--dry-run` first, `decisions` apply is a separate user step)
  - [ ] 11.15 Verify AC8: request the `verifier` PRD-level rollup audit; route its drift findings to `product-engineer` via `activity-drift-reconciliation`
  - [ ] 11.16 Edge cases: eval on an un-migrated `memo_eval` state must also still pass (v1 points rank identically); a private bank's entries never appear in eval results
  - [ ] 11.17 Map every AC to its evidence in the PR body
  - [ ] 11.18 Migration: not required — no new schema change in this task; the `memo_eval` migration was already applied in task 9.0; the `decisions` migration remains the user's post-release step (restate in the release notes)
  - [ ] 11.19 Run final quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`
  - [ ] 11.20 Run `verifier` audit (mandatory, pre-PR-ready) at the PRD-level rollup scope; route drift findings to `product-engineer`
  - [ ] 11.21 Open PR against `main`, link `Closes #90`, obtain user approval, merge — tagging/publishing memo-cli 1.3.0 is a separate, explicit, human-run decision (`scripts/release.sh`) after this PR is reviewed
