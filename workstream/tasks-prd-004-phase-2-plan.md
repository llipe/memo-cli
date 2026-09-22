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
- `src/lib/qdrant.ts` — 12 new payload indexes (task 2.0) + `pending_contradiction` (task 7.0, discovered missing during S2-07 live manual validation against a strict-mode Qdrant cluster), `scrollOrdered`, `scrollAll`, `count`, `setPayload`, `batchSetPayload`, `fetchStalenessCorpus` (replaces `fetchByRepo`)
- `src/lib/search-filters.ts`, `src/lib/list-filters.ts` — accept and merge a `base` filter
- `src/commands/write.ts` — `--bank/--kind/--session/--seq/--context/--provenance/--manual/--supersedes/--pin/--expires-in`, v2 payload build order, soft-cap warning
- `src/commands/search.ts` — read-flags, `base` filter wired through dense/lexical/staleness, `--kind self` unranked path, `rankCandidates()` extraction for reuse by `recall`
- `src/commands/list.ts`, `src/commands/tags.ts`, `src/commands/read.ts` — read-flags, v2 fields, provenance `(deleted)` markers
- `src/commands/setup.ts` — `--v2` init flag, resolved bank default in `validate`
- `src/commands/inspect.ts` — `banks` facet
- `src/index.ts` — register `timeline`, `recall`, `bank`, `migrate`
- `src/lib/output.ts` — `recallSections`/`recallFooter` human-output renderer (task 7.0)
- `tests/unit/commands/{write,search,list,tags,read,setup,inspect}.test.ts`, `tests/unit/lib/{config,qdrant,dedupe,search-filters,list-filters}.test.ts`, `tests/integration/commands/{write,search,read,setup,migrate}.test.ts`
- `tests/relevance/replay.test.ts` — AC-2.3 identity assertion added
- `README.md`, `docs/data-model.md`, `docs/system-overview.md`, `docs/technical-guidelines.md`, `/TESTING.md`, `docs/requirements/prd-004-long-lived-agent-memory.md`
- `.claude/skills/memo-cli-usage/SKILL.md`, `REFERENCE.md` (this repo's copy; task 10.0 also touches `llipe/dev-tasks`)

## Migration Posture (applies per task; see task 9.0 for the one exception)

Every task except **9.0** changes no stored payload — new v2 fields are written only by new/updated writes (task 4.0 onward) and read paths treat their absence as v1 via `normalizeEntry` (task 1.0). Migration artifacts are **not required** for tasks 1.0–8.0 and 10.0–11.0; the opt-out rationale is recorded per task. **Task 9.0 is itself the migration artifact** (`memo migrate --to-v2`): it is exercised only against the isolated `memo_eval` collection during this phase's development and testing — applying it to the production `decisions` collection is an explicit, separate, user-confirmed step performed after the 1.3.0 release, never run automatically by any task here.

## Tasks

- [ ] 1.0 Implement Story S2-01: Config v2 and payload schema v2 — [#53](https://github.com/llipe/memo-cli/issues/53)

  > Note: reconciles issue #53 ("separate episodic and semantic memory stores") as one collection with a `kind` field per PRD §2.5, per the Decision comment already posted on the issue. Nothing user-visible changes in this task — v1 config and v1 writes still work unchanged.
  - [x] 1.1 Write `tests/unit/lib/config.test.ts` cases: v1 file unchanged; every `banks.*` §8.4 default; `kb` `purge_after_days` absent → `undefined`, explicit → kept; `soft_cap`/`max_tokens` rejections; unknown keys preserved
  - [x] 1.2 Write `tests/unit/types/entry.test.ts`: one case per AC5 rule (self-in-kb, episodic-without-session, agent-semantic-without-provenance, self-with-retention-fields, seq-on-non-episodic) plus positive cases per kind and `source: scan`
  - [x] 1.3 Write `tests/unit/lib/entry-normalize.test.ts`: v1 payload → defaults; v2 payload untouched; missing `timestamp_utc` handled
  - [x] 1.4 Write `tests/unit/commands/setup.test.ts` cases for `--v2` output shape
  - [x] 1.5 Extend `src/types/config.ts`: `schema_version: z.enum(['1','2'])`, `bank`, `banks.{kb,private}.{self?,episodic,semantic}` (`KindPolicySchema`, `SelfPolicySchema`), `recall.max_tokens`; export `DEFAULT_*` constants per §18.2
  - [x] 1.6 Add `EntryPayloadV2Schema` to `src/types/entry.ts` with the §18.3 `superRefine` rule table; keep the v1 `EntryPayloadSchema` export; extend `entry_type` (`policy`, `observation`) and `source` (`scan`)
  - [x] 1.7 Add `sourceToConfidence('scan') === 'low'` to `src/lib/dedupe.ts`
  - [x] 1.8 Create `src/lib/entry-normalize.ts` (`normalizeEntry`, pure)
  - [x] 1.9 Add `--v2` to `memo setup init`; print resolved default bank in `memo setup validate`
  - [x] 1.10 Verify AC1–AC4: config resolution and validation test matrix
  - [x] 1.11 Verify AC5–AC6: schema rule table and new enum values
  - [x] 1.12 Verify AC7: `normalizeEntry` mapping
  - [x] 1.13 Verify AC8: `setup --v2` / `validate` round-trip
  - [x] 1.14 Verify AC9: full `pnpm test` green with no command behavior change (no shipped command calls the new schema/normalize yet)
  - [x] 1.15 Edge cases: `bank` as UUID; `banks.private` partially overridden; invalid `contexts`/`provenance` entries
  - [x] 1.16 Map every AC to its test in the PR body
  - [x] 1.17 Migration: not required — schema definitions only, no stored data touched; record opt-out rationale in the PR body
  - [x] 1.18 Update `docs/data-model.md`: config v2 table, payload v2 field list
  - [x] 1.19 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`; confirm `setup.ts` coverage at or above `jest.config.ts` thresholds
  - [ ] 1.20 Run `verifier` audit (mandatory, pre-PR-ready); route drift findings to `product-engineer` — **not run in this execution context** (no-delegation default, see closeout payload); caller (`planner`) invokes `verifier` directly
  - [ ] 1.21 Open PR against `main`, link `Closes #53` (reused issue — confirm with the user before closing a reused issue, since #53's original scope predates this PRD), obtain user approval, merge — PR opened as draft; approval/merge pending

- [x] 2.0 Implement Story S2-02: `QdrantRepository` extensions and v2 payload indexes — [#81](https://github.com/llipe/memo-cli/issues/81)

  > Note: pure adapter work, independent of task 1.0 — can run in parallel on a separate branch.
  - [x] 2.1 Write `tests/unit/lib/qdrant.test.ts` cases: `scrollAll` over three mocked pages (no `order_by`, correct `offset` chaining); `scrollOrdered` request shape (no `offset`); `count`; `batchSetPayload` chunking (300 ops → 2 calls); `fetchStalenessCorpus` filter shape for `kb` vs private; error mapping
  - [x] 2.2 Write `tests/integration/lib/qdrant.test.ts` case: `ensureIndexes` on a mocked v1.2.0 `payload_schema` creates exactly 12 indexes; second run creates 0
  - [x] 2.3 Append the 12 indexes to `PAYLOAD_INDEXES` (`bank`, `kind`, `session_id`, `contexts` keyword; `seq` integer; `archived`, `superseded`, `consolidated`, `pinned` bool; `valid_to`, `expires_at`, `archived_at` datetime)
  - [x] 2.4 Implement `scrollOrdered(filter, { orderBy, limit, withVector })`
  - [x] 2.5 Implement `scrollAll(filter, { batch, withVector }, onPage)` (unordered, `next_page_offset` pagination)
  - [x] 2.6 Implement `count(filter)`
  - [x] 2.7 Implement `setPayload(id, payload)` and `batchSetPayload(ops)` (256-op chunking)
  - [x] 2.8 Implement `fetchStalenessCorpus({ bank, repos }, limit)`; `fetchByRepo` left in place — its only caller (`search.ts`, task 5.0) has not moved off it yet; removal deferred to task 5.0 per AC6's documented either-order allowance
  - [x] 2.9 Verify AC1: index count and idempotency verified via unit + integration tests against a mocked v1.2.0-shaped `payload_schema` (SC-1/CT-6) — **live verification against a real Qdrant instance not performed** (no live instance available in this execution environment); documented as a manual follow-up in the PR
  - [x] 2.10 Verify AC2–AC6: unit test matrix above — 72/72 targeted tests passing
  - [x] 2.11 Verify AC7: existing `scroll`/`search`/`getById`/`getByDedupeKey`/`deleteById`/`deleteByFilter`/`upsert` tests unchanged and green
  - [x] 2.12 Edge cases: empty collection (`scrollAll` zero `onPage` calls); page exactly `batch` long; `batchSetPayload([])` no-op; `count` on an empty-match filter; client throws mid-`scrollAll`
  - [x] 2.13 Map every AC to its test in the PR body
  - [x] 2.14 Migration: not required — indexes are additive and reconciled at runtime; opt-out rationale recorded in the PR body
  - [x] 2.15 Update `docs/data-model.md` index table and `docs/technical-guidelines.md` adapter method list
  - [x] 2.16 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit` — all pass for this story's files (repo-wide `format:check` flags one pre-existing, unrelated file: `workstream/planner-state-prd-004-phase-2.md`)
  - [ ] 2.17 Run `verifier` audit (mandatory, pre-PR-ready); route drift findings to `product-engineer` — **not run in this execution context** (no-delegation default, see closeout payload); caller (`planner`) invokes `verifier` directly
  - [ ] 2.18 Open PR against the integration branch (`integration/prd-004-phase-2-banks-kinds-sessions-recall`, per this run's base-branch override), link `Closes #81`, obtain approval, merge — PR [#93](https://github.com/llipe/memo-cli/pull/93) opened as draft; approval/merge pending

- [x] 3.0 Implement Story S2-03: Bank resolution, base filter, and dedupe v2 — [#82](https://github.com/llipe/memo-cli/issues/82)

  > Note: depends on tasks 1.0 and 2.0 (needs `KindPolicySchema`/`bank`/`banks` config and the new indexes). Unblocks every remaining task.
  > Drift follow-up (from `verifier`'s Audit Mode pass on PR #93/S2-02, D-2, Major/Intended): `fetchStalenessCorpus` (`src/lib/qdrant.ts`, S2-02) currently builds its own private copy of the §8.1 base-filter rule instead of composing `buildBaseFilter`. Sub-task 3.7 below closes that gap so S2-05 (task 5.0, AC4) can wire one shared filter through dense/lexical/staleness without a second, silently-divergent implementation surviving in the codebase.
  - [x] 3.1 Write `tests/unit/lib/bank.test.ts`: every resolution permutation of flag/env/config/default; invalid-value error naming its source; `defaultKind`; `policyFor` incl. the `kb`/`self` throw
  - [x] 3.2 Write `tests/unit/lib/filters.test.ts`: filter shape per combination of bank type × kind × exclusions × session × as-of
  - [x] 3.3 Write `tests/unit/lib/search-filters.test.ts`, `tests/unit/lib/list-filters.test.ts` cases for `base` merge semantics and the conditional `repo` clause
  - [x] 3.4 Write `tests/unit/lib/dedupe.test.ts` cases: v2 keys per kind; `self` uniqueness across 1,000 calls; `seq` sensitivity
  - [x] 3.5 Create `src/lib/bank.ts` (`resolveBank`, `isPrivateBank`, `policyFor`, `defaultKind`)
  - [x] 3.6 Create `src/lib/filters.ts` (`buildBaseFilter`)
  - [x] 3.7 **Drift fix (D-2):** refactor `fetchStalenessCorpus` (`src/lib/qdrant.ts`) to accept the caller-built `base: QdrantFilter` (from `buildBaseFilter`) instead of constructing its own private `bank`/`repos` filter internally; add a parity test asserting `fetchStalenessCorpus`'s effective filter is byte-identical to `buildBaseFilter`'s output for the same inputs. Write this test first (it should fail against S2-02's shipped private-helper version), then make the change. — done: `fetchStalenessCorpus` now takes `base: QdrantFilter` and forwards it verbatim to `scroll()`; the private `buildStalenessCorpusFilter` helper is removed
  - [x] 3.8 Extend `src/lib/search-filters.ts` and `src/lib/list-filters.ts` to accept and merge `base`
  - [x] 3.9 Add `buildDedupeKeyV2` to `src/lib/dedupe.ts`
  - [x] 3.10 Verify AC1–AC3: bank resolution and policy lookup test matrix — `tests/unit/lib/bank.test.ts` (28 cases)
  - [x] 3.11 Verify AC4–AC5: filter shape and builder-merge test matrix — `tests/unit/lib/filters.test.ts`, `tests/unit/lib/search-filters.test.ts`, `tests/unit/lib/list-filters.test.ts`
  - [x] 3.12 Verify AC6–AC7: dedupe key test matrix — `tests/unit/lib/dedupe.test.ts` `buildDedupeKeyV2` describe block, incl. the 1,000-call `self` uniqueness property
  - [x] 3.13 Verify the D-2 drift fix: `fetchStalenessCorpus` and `buildBaseFilter` produce identical filter shapes for `kb` and for a private bank, with and without `repos` — `tests/unit/lib/qdrant.test.ts` `fetchStalenessCorpus()` describe block, 3 parity tests
  - [x] 3.14 Edge cases: `MEMO_BANK=""` treated as unset; `MEMO_BANK=KB` invalid; `asOf` boundary inclusivity/exclusivity; `--kind self --include-superseded` — EC-5/EC-6, EC-7, EC-29/EC-30/EC-31, EC-24
  - [x] 3.15 Map every AC to its test in the PR body, including the D-2 parity test as evidence the drift is closed
  - [x] 3.16 Migration: not required — pure functions, no data change; record opt-out rationale in the PR body
  - [x] 3.17 Update `docs/technical-guidelines.md` architecture tree with both new modules
  - [x] 3.18 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit` — all pass (`pnpm run validate`: 722/722 tests, lint clean, format clean, typecheck clean, audit clean)
  - [ ] 3.19 Run `verifier` audit (mandatory, pre-PR-ready), explicitly re-checking D-2 is closed; route any remaining drift findings to `product-engineer` — **not run in this execution context** (no-delegation default, see closeout payload); caller (`planner`) invokes `verifier` directly
  - [ ] 3.20 Open PR against `main`, link `Closes #82`, obtain user approval, merge — PR [#94](https://github.com/llipe/memo-cli/pull/94) opened as draft against the integration branch (`integration/prd-004-phase-2-banks-kinds-sessions-recall`, per this run's base-branch override); approval/merge pending

- [ ] 4.0 Implement Story S2-04: `memo write` v2 — banks, kinds, sessions, supersede — [#83](https://github.com/llipe/memo-cli/issues/83)

  > Note: depends on task 3.0. Independent of tasks 5.0 and 6.0 (touches `write.ts` only). AC-2.1, AC-2.2, and AC-2.8 are proved here. PR: [#95](https://github.com/llipe/memo-cli/pull/95) (draft, against the integration branch).
  - [x] 4.1 Write `tests/unit/lib/duration.test.ts`: `2d`/`12h`/`30m` parse; invalid strings rejected; `0d` rejected
  - [x] 4.2 Write `tests/unit/commands/write.test.ts` cases for every AC (payload shape per kind, warning text, error codes/messages, call order `getById` → `upsert` → `setPayload`)
  - [x] 4.3 Write `tests/integration/commands/write.test.ts`: supersede round-trip (write A, write B `--supersedes A`, confirm A's `valid_to`/`superseded_by`); v1-key dedupe fallback catches a v1.2.0 duplicate; two-bank writes never share dedupe hits
  - [x] 4.4 Create `src/lib/duration.ts`
  - [x] 4.5 Add flags to `write.ts`: `--bank`, `--kind`, `--session`, `--seq`, `--context` (repeatable), `--provenance`, `--manual`, `--supersedes`, `--pin`, `--expires-in`
  - [x] 4.6 Implement the §18.6 eleven-step write order: resolve bank/kind/policy → scope rules → source/entry_type defaults → build v2 payload incl. retention fields and `nextSeq` → validate → supersede target checks → soft-cap check/warning → dedupe v2 with `kb`-semantic v1 fallback → embed/upsert → supersede `setPayload` with the two-id failure message → v2 JSON result
  - [x] 4.7 Verify AC1 (PRD AC-2.1): `--kind self` in `kb` fails `VALIDATION_FAILED`; in a private bank via `MEMO_BANK` it succeeds with the right payload
  - [x] 4.8 Verify AC2 (PRD AC-2.2): default kind by bank
  - [x] 4.9 Verify AC3: `kb` scope requirement unchanged; private bank optional
  - [x] 4.10 Verify AC4: auto-`seq`, `--expires-in` parsing and defaults
  - [x] 4.11 Verify AC5–AC6: entry_type/source defaults, provenance requirement
  - [x] 4.12 Verify AC7 (PRD AC-2.8, write half): supersede success and every rejection path (other bank, other kind, already superseded, missing target)
  - [x] 4.13 Verify AC8: supersede-update failure message contains both ids
  - [x] 4.14 Verify AC9: soft-cap warning at exactly `soft_cap`, silent at `soft_cap - 1`
  - [x] 4.15 Verify AC10–AC11: dedupe v2 + v1 fallback; full v2 JSON result shape
  - [x] 4.16 Manual: against `MEMO_COLLECTION=memo_eval`, write one `self`, three episodic with auto-`seq`, one semantic `--supersedes` — confirmed live (bank `jarvis-eval-s204`): self write, three episodic writes with `seq` 0/1/2, semantic supersede round-trip verified via `memo read --id`
  - [x] 4.17 Edge cases: explicit `--seq` below existing max; `--supersedes` self-reference guard; `--bank kb --kind self` explicit; duplicate `--context` values; JSON-mode duplicate error unchanged
  - [x] 4.18 Map every AC to its test in the PR body
  - [x] 4.19 Migration: not required by this story — new writes are v2, existing points untouched and still readable via `normalizeEntry`; record opt-out rationale and the v1.2.x read-compatibility note in the PR body
  - [x] 4.20 Update `README.md` write section and `docs/data-model.md` write-path notes
  - [x] 4.21 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`; confirm `write.ts` coverage at or above `jest.config.ts` thresholds — `pnpm run validate` green (777/777 tests, no vulnerabilities)
  - [ ] 4.22 Run `verifier` audit (mandatory, pre-PR-ready); route drift findings to `product-engineer` — owned by `planner`/caller: this `developer` run has no `Task` tool (no-delegation default), so `verifier_audit: not-run(no-delegation)` in the closeout payload
  - [ ] 4.23 Open PR against `main`, link `Closes #83`, obtain user approval, merge — draft PR [#95](https://github.com/llipe/memo-cli/pull/95) opened against the integration branch per this run's base-branch override; final PR-to-`main`/merge is `planner`'s consolidated-PR step

- [x] 5.0 Implement Story S2-05: Read-side flags on `search`, `list`, `tags`, `read`, and bank-aware staleness — [#84](https://github.com/llipe/memo-cli/issues/84)

  > Note: depends on task 3.0 (and task 2.0 for `fetchStalenessCorpus`). Independent of tasks 4.0 and 6.0. Proves PRD AC-2.3 (identity) and AC-2.4 (isolation) — treat AC-2.3 as a regression gate, not a nice-to-have. PR: story branch `story/S2-05-read-flags-bank-staleness`, opened against the integration branch per this run's base-branch override.
  - [x] 5.1 Write `tests/unit/lib/read-flags.test.ts`: valid/invalid `--kind`, `--as-of` ISO validation, `--include-*` toggles
  - [x] 5.2 Write the AC-2.3 identity case first in `tests/relevance/replay.test.ts`: feed the recorded `candidates.json` ids through the v2 filter path, assert identical top-N to the Phase 1 recording — `buildBaseFilter` (S2-03) already implements the correct v1-compatible predicate, so this assertion is a genuine regression gate against the pure filter function rather than a "fails-before" TDD case; command-level wiring (task 5.7/5.8) is what this test guards going forward
  - [x] 5.3 Write `tests/unit/commands/search.test.ts` cases: filter shapes shared by dense/lexical/staleness; two-bank isolation on the mocked repo; `--kind self` skips `rankResults`; `--as-of` implies `--include-superseded`
  - [x] 5.4 Write `tests/unit/commands/{list,tags,read}.test.ts` cases: new flags, v2 JSON fields, `(deleted)` provenance marker
  - [x] 5.5 Write `tests/integration/commands/search.test.ts` (two-bank mocked run) and `tests/integration/commands/read.test.ts` (provenance with one deleted id) — also added two-bank isolation to `list.test.ts`/`tags.test.ts` integration suites
  - [x] 5.6 Create `src/lib/read-flags.ts`
  - [x] 5.7 Wire `base` (from `buildBaseFilter`) through `search.ts`'s dense query, lexical scroll, and staleness corpus — `fetchStalenessCorpus` already took `base` directly (S2-03's D-2 fix landed); removed `fetchByRepo` from `qdrant.ts` and its test block
  - [x] 5.8 Add read-flags to `list.ts` and `tags.ts`; merge `base` into their filters (`tags.ts`'s repo clause is now bank-gated: omitted for private banks, EC-11)
  - [x] 5.9 Extend `read.ts`: v2 field printing via full `normalizeEntry` (diagnostic view, unlike search/list's additive-only projection), one `scroll({ has_id: provenance })` call capped at array length, `(deleted)` markers, JSON `provenance: [{ id, deleted }]`
  - [x] 5.10 Add `[archived]`/`[superseded]` human-output prefixes (`output.ts`'s `renderStatePrefix`, shared by `searchResults`/`searchResultsUnranked`/`listResults`) and `archived`/`superseded` JSON fields via `normalizeEntry`/`projectV2Fields`
  - [x] 5.11 Verify AC1: flag validation matrix (`read-flags.test.ts` + per-command VALIDATION_FAILED tests)
  - [x] 5.12 Verify AC2 (PRD AC-2.3): replay identity — 5 new tests in `replay.test.ts` (no false exclusion, no false inclusion, ordering identity, non-vacuous-filter proof, hit-rate floor through the filter path); not weakened
  - [x] 5.13 Verify AC3 (PRD AC-2.4): two-bank isolation — unit (filter-shape) + integration (real filter evaluation against a mocked two-bank corpus) on `search`/`list`/`tags list`; live `memo_eval` manual run not performed this session (see PR body/known limitations)
  - [x] 5.14 Verify AC4: shared base filter across dense/lexical/staleness confirmed by test; `fetchByRepo` removed from `qdrant.ts` (compile-time + runtime absence test)
  - [x] 5.15 Verify AC5: `--kind self` unranked path (no embeddings/dense/staleness calls, no ranking fields, newest-first via `scroll`)
  - [x] 5.16 Verify AC6: archived/superseded prefixes and fields (search/list/output unit tests)
  - [x] 5.17 Verify AC7: `--as-of` semantics (implies `--include-superseded` only; boundary semantics proven at `buildBaseFilter` level by S2-03's `filters.test.ts` EC-29–35, composed unchanged)
  - [x] 5.18 Verify AC8: new JSON fields additive-only (CT-1-style tests), no existing key changed
  - [x] 5.19 Verify AC9: `read` provenance rendering (unit + integration, incl. EC-14 large-array cap)
  - [ ] 5.20 Manual: on `memo_eval`, confirm identical search results before/after; write to two private banks and search each — not performed this session (no separate "before" state to compare against beyond the committed `candidates.json`/`baseline.json`, which the automated AC2 gate already covers more rigorously); tracked as a follow-up for a live sanity pass
  - [x] 5.21 Edge cases: `--kind all --include-archived` on an all-archived bank; `--session` on `search` with `kind=semantic` (valid, empty); `read` on a v1 point (EC-10); `--as-of` future/past boundaries proven at the `buildBaseFilter` layer (S2-03)
  - [x] 5.22 Map every AC to its test in the PR body, with the AC-2.3 before/after evidence included
  - [x] 5.23 Migration: not required — read-only; v1 points pass the default filter via `is_empty`; opt-out rationale recorded in the PR body
  - [x] 5.24 Update `README.md` flag tables (search/list/tags/read) and `docs/system-overview.md` search/list/tags/read flows (plus `bank.ts`/`filters.ts`/`entry-normalize.ts`/`read-flags.ts` Libraries-table entries, closing a pre-existing S2-01–03 doc gap found during this review)
  - [x] 5.25 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit` — `pnpm run validate` green (854/854 tests, no vulnerabilities)
  - [ ] 5.26 Run `verifier` audit (mandatory, pre-PR-ready); route drift findings to `product-engineer` — owned by `planner`/caller: this `developer` run has no `Task` tool (no-delegation default), so `verifier_audit: not-run(no-delegation)` in the closeout payload
  - [ ] 5.27 Open PR against `main`, link `Closes #84`, obtain user approval, merge — draft PR to be opened against the integration branch per this run's base-branch override; final PR-to-`main`/merge is `planner`'s consolidated-PR step

- [ ] 6.0 Implement Story S2-06: `memo timeline` — [#85](https://github.com/llipe/memo-cli/issues/85)

  > Note: depends on tasks 2.0 and 3.0. Independent of tasks 4.0 and 5.0.
  - [x] 6.1 Write `tests/unit/commands/timeline.test.ts`: scrambled-order mock → sorted output; grouping without `--session`; `--last` clamp at 500; `--since` filter shape; no `createEmbeddings` call; empty results
  - [x] 6.2 Write `tests/integration/commands/timeline.test.ts`: three mocked episodic writes replayed in `seq` order
  - [x] 6.3 Create `src/commands/timeline.ts`: `--bank`, `--session`, `--last` (default 50, max 500), `--since`, `--json`; `scrollOrdered` (session shape) vs `scroll` + grouping (no-session shape); register in `src/index.ts`
  - [x] 6.4 Verify AC1 (PRD AC-2.5): seq-then-timestamp ordering regardless of content
  - [x] 6.5 Verify AC2: grouped-by-session shape and human header
  - [x] 6.6 Verify AC3: `--since` filter and invalid-ISO rejection
  - [x] 6.7 Verify AC4: episodic-only, default exclusions, no embeddings/ranking call (asserted)
  - [x] 6.8 Verify AC5–AC6: empty-result envelope; human line format
  - [ ] 6.9 Manual: on `memo_eval` after task 4.0's manual writes, run with and without `--session` — **not run**: no live Qdrant/`memo_eval` environment available in this execution context; left for human verification before merge
  - [x] 6.10 Edge cases: `--last 0` rejected; `--last 501` clamped with warning; equal `seq` values; session id existing only in another bank
  - [x] 6.11 Map every AC to its test in the PR body
  - [x] 6.12 Migration: not required — read-only; record opt-out rationale in the PR body
  - [x] 6.13 Update `README.md` command section and `docs/system-overview.md`
  - [x] 6.14 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`
  - [ ] 6.15 Run `verifier` audit (mandatory, pre-PR-ready); route drift findings to `product-engineer` — not run by `developer` (no-delegation subagent context, no `Task` tool); `planner` owns this invocation, scoped to this story's diff/branch/PR
  - [ ] 6.16 Open PR against `main`, link `Closes #85`, obtain user approval, merge — draft PR opened against the integration branch per this run's base-branch override ([#97](https://github.com/llipe/memo-cli/pull/97)); final PR-to-`main`/merge is `planner`'s consolidated-PR step

- [ ] 7.0 Implement Story S2-07: `memo recall` — [#86](https://github.com/llipe/memo-cli/issues/86)

  > Note: depends on tasks 5.0 and 6.0. The headline Phase 2 feature (PRD goal 3). Per decision A14, this task writes no local snapshot and updates no retrieval counters — `recall` is read-only until Phase 3.
  - [x] 7.1 Write `tests/unit/lib/recall.test.ts` (pure `assembleRecall`): SELF complete and first; superseded `self` absent; SELF intact under a budget smaller than SELF alone; cross-section dedup; trimming order (`conflicts → last_session → mine → shared → policies`); single `query_id`; `bank=kb` omits SELF/MINE/LAST SESSION
  - [x] 7.2 Write `tests/unit/commands/recall.test.ts`: call-count/shape assertions on the mocked repo and embeddings adapter; assert zero `setPayload`/`batchSetPayload`/filesystem calls; `--scope` reaches only the SHARED filter; POLICIES filter shape
  - [x] 7.3 Write `tests/integration/commands/recall.test.ts`: seeded mock with two banks, one superseded `self`, one `policy` entry, a two-session episodic history — assert the full JSON bundle
  - [x] 7.4 Extract `rankCandidates()` from `src/commands/search.ts` (over-fetch, lexical union, `rankResults`, `detectStaleness`) with no behavior change — confirm Phase 1 and task 5.0 tests stay green after extraction
  - [x] 7.5 Create `src/lib/recall.ts` (`assembleRecall`, pure, per §8.5/§18.9 caps and trimming order)
  - [x] 7.6 Create `src/commands/recall.ts`: gather SELF/POLICIES/SHARED/MINE/LAST SESSION/CONFLICTS per the §18.9 table, one embed call, `query_id = randomUUID()`; register in `src/index.ts`
  - [x] 7.7 Implement the human-output renderer (section headers, `budget: used/max · truncated: …` footer) per spec §10
  - [x] 7.8 Verify AC1 (PRD AC-2.6): section order and SELF completeness/superseded-omission
  - [x] 7.9 Verify AC2–AC3: budget trimming behavior and honest over-budget reporting when SELF alone exceeds it
  - [x] 7.10 Verify AC4: cross-section dedup and single `query_id`
  - [x] 7.11 Verify AC5: section caps
  - [x] 7.12 Verify AC6: SHARED/MINE ranked identically to `memo search`; LAST SESSION seq-ordered; SELF unscored
  - [x] 7.13 Verify AC7: `bank=kb` omission
  - [x] 7.14 Verify AC8: exactly one embed call, zero write calls
  - [x] 7.15 Verify AC9: `--max-tokens` default from config, `--scope` scoping, envelope/output shape
  - [x] 7.16 Verify AC10: POLICIES population from `kb` `entry_type=policy` entries
  - [x] 7.17 Manual: on `memo_eval` after task 4.0's writes, run `memo recall "plan the next story" --bank <b>` human and `--json`, `--max-tokens 200`, `--bank kb`; measure and record wall time (`< 4s` target)
  - [x] 7.18 Edge cases: bank with no episodic history; `self` count above `soft_cap`; empty task string rejected; duplicate entry in SHARED and MINE candidates (dedup keeps SHARED); huge `--max-tokens` (`truncated: []`); embeddings failure surfaces `EMBEDDING_API_ERROR` with no partial bundle
  - [x] 7.19 Map every AC to its test in the PR body, including the recorded latency measurement
  - [x] 7.20 Migration: not required — read-only, no local state written; record opt-out rationale in the PR body
  - [x] 7.21 Update `README.md` (command + session protocol preview) and `docs/system-overview.md` (recall flow diagram)
  - [x] 7.22 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`
  - [ ] 7.23 Run `verifier` audit (mandatory, pre-PR-ready); route drift findings to `product-engineer` — **not run in this execution context** (no-delegation default, see closeout payload); caller (`planner`) invokes `verifier` directly
  - [ ] 7.24 Open PR against the integration branch (`integration/prd-004-phase-2-banks-kinds-sessions-recall`, per this run's base-branch override), link `Closes #86`, obtain approval, merge — PR [#100](https://github.com/llipe/memo-cli/pull/100) opened as draft; approval/merge pending

- [ ] 8.0 Implement Story S2-08: `memo bank init|list|show` and `inspect` banks facet — [#87](https://github.com/llipe/memo-cli/issues/87)

  > Note: depends on task 4.0 (`bank init` delegates to the S2-04 write path). Independent of task 9.0.
  - [x] 8.1 Write `tests/unit/commands/bank.test.ts`: id validation and `kb` rejection; idempotent `init`; `writeConfig` called only with `--set-default`; `list` folding of `bank`-absent points into `kb`; `show` ordering and state counts
  - [x] 8.2 Write `tests/unit/commands/inspect.test.ts` case: `banks` facet present
  - [x] 8.3 Write `tests/integration/commands/bank.test.ts`: init → list → show on a mocked repo with a v1 point present
  - [x] 8.4 Create `src/commands/bank.ts` with `init`, `list`, `show` subcommands; `init` delegates to the write handler with fixed flags per §18.10; `--set-default` gates the sole `writeConfig` call (decision A13)
  - [x] 8.5 Add a `banks` facet (counts only) to `src/commands/inspect.ts`
  - [x] 8.6 Register `bank` in `src/index.ts`
  - [x] 8.7 Verify AC1–AC3: init creation, idempotency, `--set-default` gating
  - [x] 8.8 Verify AC4: `list` folding and counts
  - [x] 8.9 Verify AC5: `show` ordering and state counts, unknown-bank zero-count response
  - [x] 8.10 Verify AC6: `inspect` `banks` facet
  - [x] 8.11 Manual: on `memo_eval`, `memo bank init --id smoke-bank` (twice), `memo bank list`, `memo bank show --id smoke-bank`, `memo inspect`
  - [x] 8.12 Edge cases: id as UUID; `--tags` with one tag rejected by the 2–5 schema rule; `--set-default` with no `memo.config.json` present; `show` on an all-archived bank
  - [x] 8.13 Map every AC to its test in the PR body
  - [x] 8.14 Migration: not required — writes go through the S2-04 path, no existing data changes; document the 1.2.x read-compatibility caveat (a `self` point looks like an ordinary entry to 1.2.x `memo list`) in the PR body
  - [x] 8.15 Update `README.md` command section and `docs/system-overview.md`
  - [x] 8.16 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`
  - [ ] 8.17 Run `verifier` audit (mandatory, pre-PR-ready); route drift findings to `product-engineer`
  - [ ] 8.18 Open PR against `main`, link `Closes #87`, obtain user approval, merge

- [x] 9.0 Implement Story S2-09: `memo migrate --to-v2` — [#88](https://github.com/llipe/memo-cli/issues/88)

  > Note: depends on tasks 1.0 and 2.0. Independent of task 8.0. **This is the one task in the plan with an active migration lifecycle — read the Migration subtasks before starting.**
  - [x] 9.1 Write `tests/unit/lib/migrate.test.ts`: rule 1 vs rule 2 fixtures; `story` → `session_id`, absent → `legacy`; `expires_at` arithmetic; v2 points skipped; every "all" field set correctly; custom rules file incl. each `when` operator (`tags_any`, `tags_all`, `entry_type_in`, `source_in`, `repo_in`); exhaustiveness rejection when no catch-all rule exists
  - [x] 9.2 Write `tests/unit/commands/migrate.test.ts`: dry-run issues zero write calls; page-loop call count; JSON envelope shape
  - [x] 9.3 Write `tests/integration/commands/migrate.test.ts`: three mocked pages of v1 points — dry-run (zero writes) → real run (one `batchSetPayload` per page) → second real run (`scanned: 0`); assert no `delete*` call ever; replay-identity check after migration
  - [x] 9.4 Create `src/lib/migrate.ts`: `planMigration` (pure), rules Zod schema with exhaustiveness validation
  - [x] 9.5 Create `src/commands/migrate.ts`: `scrollAll` over `is_empty schema_version` → plan → `batchSetPayload` per page; `--dry-run`, `--rules <file>`, `--json`; stderr progress unless `--json`; register in `src/index.ts`
  - [x] 9.6 Verify AC1: full planner rule table, including the "all" fields
  - [x] 9.7 Verify AC2 (PRD AC-2.7, dry-run half): zero write calls, correct printed counts
  - [x] 9.8 Verify AC3 (PRD AC-2.7, real-run half): one `batchSetPayload` per page; second run `scanned: 0`; no `delete*` call ever; no vector sent
  - [x] 9.9 Verify AC4: custom `--rules` file behavior and exhaustiveness rejection
  - [x] 9.10 Verify AC5: progress/exit-0 behavior
  - [x] 9.11 Verify AC6: replay identity holds across the rewrite (feeds task 5.0's AC-2.3 assertion with migrated payloads)
  - [x] 9.12 **Migration — create artifact:** `memo migrate --to-v2` itself, with `--dry-run` and `--rules`, is the migration artifact (already built in 9.4–9.5)
  - [x] 9.13 **Migration — rollback/impact notes:** document in the PR that this is payload-only (vectors untouched), that 1.2.x ignores the added fields, and that there is no automated rollback — the practical rollback is reinstalling memo-cli 1.2.x (per spec §15)
  - [x] 9.14 **Migration — dry-run against `memo_eval`:** `MEMO_COLLECTION=memo_eval pnpm exec node dist/index.js migrate --to-v2 --dry-run`; record the printed `by_rule` counts in the PR body
  - [x] 9.15 **Migration — request user confirmation before any real apply:** present the dry-run counts and ask the user to confirm before running the real migration against `memo_eval` (development/testing only — **never against `decisions` in this task**)
  - [x] 9.16 **Migration — apply (after confirmation, `memo_eval` only):** `MEMO_COLLECTION=memo_eval pnpm exec node dist/index.js migrate --to-v2`; run a second time to confirm `scanned: 0`
  - [x] 9.17 **Migration — verify applied state:** `pnpm run eval:relevance` against `memo_eval` unchanged at 96.4%; `memo bank list` shows all migrated points under `kb`
  - [x] 9.18 Edge cases: point with both `intent` and `outcome` tags (rule 1 applies once); `intent`-tagged point with no `story` (`legacy`); point with `bank` set but no `schema_version` (migrated, existing `bank` preserved); empty collection; non-array rules file; page boundary exactly at 256
  - [x] 9.19 Map every AC to its test in the PR body
  - [x] 9.20 Update `README.md` migration section (dry-run first, what changes, what does not — and that applying to `decisions` is a separate post-release step) and `docs/data-model.md`
  - [x] 9.21 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`
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
  - [x] 10.7 Copy the updated skill files into this repository's `.claude/skills/memo-cli-usage/` so both copies are byte-identical

    > Note: 10.7 was **not** completed within this story's own PR — the original delegation incorrectly assumed this repository's copy was already a placeholder and skipped the sync. It was completed as a follow-up under issue #89, sourced from `llipe/dev-tasks#240`'s `issue/89-memo-cli-usage-v13` branch content. See that PR for the fix. Note: after this repository's `prettier` markdown formatting pass (required by its own `format:check` gate), the two repos' copies are content-identical but not byte-identical — `dev-tasks` does not run the same prettier markdown-table normalization, so `diff -r` shows cosmetic-only differences (quote style, table column padding). See 10.13.
  - [ ] 10.8 Verify AC1: bank id declared and exported per agent
  - [ ] 10.9 Verify AC2 (PRD AC-2.9, recall half): single-call session start documented, fallback preserved
  - [ ] 10.10 Verify AC3 (PRD AC-2.9, write half): episodic-in-bank vs semantic-in-kb write examples correct
  - [ ] 10.11 Verify AC4: session-close documentation
  - [ ] 10.12 Verify AC5: skill/reference command examples all valid against the 1.3.0 build
  - [ ] 10.13 Verify AC6: `diff -r` between the two skill directories shows no difference — **partially verified by the 10.7 follow-up**: content is semantically identical (sourced from the same PR content), but a literal byte-for-byte `diff -r` shows cosmetic-only differences from `memo-cli`'s mandatory prettier markdown formatting pass, which `dev-tasks` does not apply identically; full AC6 sign-off remains owned by the S2-10 story
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
