# Implementation Plan — PRD-004 Phase 1: Trustworthy Retrieval

> **Scope:** all eight Phase 1 stories (S1-01 … S1-08), one pull request per parent task, executed in the listed order. Stories 2 through 6 all touch `src/lib/ranking.ts` or `src/commands/search.ts`; running them in parallel will conflict.
>
> **Source artifacts:** PRD `docs/requirements/prd-004-long-lived-agent-memory.md` v1.4 · Spec `workstream/specification-prd-004-long-lived-agent-memory.md` v1.1 · Stories `workstream/user-stories-prd-004-phase-1.md` v1.0 · Binding refinement `workstream/issue-34-composite-ranking-score-refinement.md`
>
> **Execution rule:** this is an existing codebase, so there is no Task 0. Every parent task ends with the quality gate and a merged PR before the next one starts.

## GitHub Issues

| Task | Story | Issue                                              | Status                                                                |
| ---- | ----- | -------------------------------------------------- | --------------------------------------------------------------------- |
| 1.0  | S1-01 | [#61](https://github.com/llipe/memo-cli/issues/61) | In review (PR [#66](https://github.com/llipe/memo-cli/pull/66) draft) |
| 2.0  | S1-02 | [#34](https://github.com/llipe/memo-cli/issues/34) | In review (PR [#67](https://github.com/llipe/memo-cli/pull/67) draft) |
| 3.0  | S1-03 | [#36](https://github.com/llipe/memo-cli/issues/36) | Open                                                                  |
| 4.0  | S1-04 | [#35](https://github.com/llipe/memo-cli/issues/35) | Open                                                                  |
| 5.0  | S1-05 | [#38](https://github.com/llipe/memo-cli/issues/38) | Open                                                                  |
| 6.0  | S1-06 | [#62](https://github.com/llipe/memo-cli/issues/62) | Open                                                                  |
| 7.0  | S1-07 | [#63](https://github.com/llipe/memo-cli/issues/63) | Open                                                                  |
| 8.0  | S1-08 | [#64](https://github.com/llipe/memo-cli/issues/64) | Open                                                                  |

## Relevant Files

**New**

- `src/lib/ranking.ts` — composite score, tag boost, tiers, factor bag (pure, `now` injected)
- `src/lib/staleness.ts` — Jaccard overlap and staleness detection (pure)
- `src/lib/lexical.ts` — identifier extraction, tokenizer parity, cosine, lexical boost (pure)
- `src/lib/eval.ts` — top-3 hit-rate computation and report shaping (pure)
- `scripts/eval-relevance.ts` — seed / run / record CLI for the relevance harness
- `tests/fixtures/relevance/entries.json` — ≥ 40 seed entries with relative ages
- `tests/fixtures/relevance/queries.json` — 20–30 labeled queries across four categories
- `tests/fixtures/relevance/candidates.json` — recorded dense and lexical candidates per query
- `tests/fixtures/relevance/baseline.json` — recorded hit rates and the config that produced them
- `tests/relevance/replay.test.ts` — offline replay guarding the baseline
- `tests/unit/lib/{ranking,staleness,lexical,eval}.test.ts` — unit suites

**Modified**

- `src/types/config.ts` — `RankingConfig` (weights, half-life, boosts, thresholds, staleness, lexical)
- `src/lib/config.ts` — load and validate the `ranking` block, fail fast
- `src/lib/qdrant.ts` — `MEMO_COLLECTION`, `ensureIndexes`, text indexes, `scroll` with vectors, `fetchByRepo`
- `src/commands/search.ts` — over-fetch, candidate union, ranking, annotations, `query_id`, `--explain`, `--lexical`
- `src/commands/setup.ts` — validate weights, threshold ordering
- `src/lib/output.ts` — `final_score` percentage, `[tier]` prefix, stale warning, factor table
- `tests/unit/commands/search.test.ts`, `tests/unit/lib/{config,output,qdrant}.test.ts`, `tests/unit/commands/setup.test.ts`, `tests/unit/commands/read.test.ts`, `tests/integration/lib/qdrant.test.ts`
- `package.json` — `eval:relevance` script
- `README.md`, `docs/data-model.md`, `docs/system-overview.md`, `docs/technical-guidelines.md`, `docs/requirements/prd-004-long-lived-agent-memory.md`, `/TESTING.md`

## Migration Posture (applies to every task)

Phase 1 writes **no payload data**. Migration artifacts are **not required**; the opt-out rationale is recorded per task. The only durable change is two additive Qdrant payload indexes created by `ensureIndexes` in task 6.0, which reconcile automatically and require no confirmation gate because nothing is destructive.

## Tasks

- [x] 1.0 Implement Story S1-01: Relevance evaluation harness and recorded baseline — [#61](https://github.com/llipe/memo-cli/issues/61) — PR [#66](https://github.com/llipe/memo-cli/pull/66) (draft, against integration branch)

  > Note: nothing else in Phase 1 may start until the baseline exists. This task changes no ranking behavior.
  > Update (2026-09-20): live Qdrant Cloud + OpenAI credentials became available on this branch; also fixed a real `--seed`/`--record` execution bug (ts-node/esm type-check false positive on the `openai` import, unrelated to credentials — see 1.12 and PR #66). The real baseline is now recorded (PRD changelog row 1.6). Only 1.26 (merge) remains open.
  - [x] 1.1 Add `MEMO_COLLECTION` resolution to `src/lib/qdrant.ts` (default `decisions`), read once at construction
  - [x] 1.2 Write `tests/unit/lib/qdrant.test.ts` cases for collection-name resolution (set, unset, empty string)
  - [x] 1.3 Define the fixture Zod schemas (entry seed, query) in `scripts/eval-relevance.ts`
  - [x] 1.4 Author `tests/fixtures/relevance/entries.json`: ≥ 40 entries, stable UUIDs, relative `age_days`, `source` spread across `agent`/`manual`/`scan`, ≥ 2 repos, several naming files in `files_modified`
  - [x] 1.5 Author `tests/fixtures/relevance/queries.json`: 20–30 queries across `concept`, `identifier` (≥ 6), `cross-repo`, `recency`
  - [x] 1.6 Implement `computeTop3HitRate` and report shaping in `src/lib/eval.ts` (pure)
  - [x] 1.7 Implement `--seed` mode: resolve relative ages to timestamps, embed, upsert with fixed ids, idempotent
  - [x] 1.8 Implement default run mode: per-category and overall hit rate to stdout, always exit 0
  - [x] 1.9 Implement `--record` mode: write `candidates.json` and `baseline.json`
  - [x] 1.10 Guard: refuse `--seed` when `MEMO_COLLECTION` is unset, exit 1 with a clear message
  - [x] 1.11 Add `eval:relevance` to `package.json` scripts
  - [x] 1.12 Run `MEMO_COLLECTION=memo_eval pnpm run eval:relevance --seed` then `--record` against live Qdrant Cloud; commit both artifacts. Fixed a real bug found first: `eval:relevance`'s `node --loader ts-node/esm` invocation raised fatal spurious `TS2709`/`TS2351`/`TS18046` diagnostics on the `openai` default import (ts-node/esm's own type-check pass mis-applies `esModuleInterop`, independent of credentials/network) — fixed by scoping `TS_NODE_TRANSPILE_ONLY=true` to the `eval:relevance` script only; `pnpm run typecheck` (`tsc --noEmit`) already covers `src/**` correctly and is unaffected
  - [x] 1.13 Write `tests/relevance/replay.test.ts` asserting hit rate ≥ `baseline.json.overall_top3`, no network
  - [x] 1.14 Write `tests/unit/lib/eval.test.ts`: all hits, no hits, partial, duplicate expected ids, empty `expected_ids`
  - [x] 1.15 Edge cases: empty `candidates.json`; expected entry missing from fixture (must fail loudly); Qdrant unreachable → exit 2 `QDRANT_UNREACHABLE`
  - [x] 1.16 Verify AC1–AC2: fixture counts, categories, and schema validation pass
  - [x] 1.17 Verify AC3–AC5: manual run of all three modes, artifacts written — real live run of default/`--seed`/`--record` against Qdrant Cloud, overall 92.9% (concept 100%, identifier 100%, cross-repo 66.7%, recency 100%)
  - [x] 1.18 Verify AC6, AC9: `pnpm test` green with the replay test, no credentials required
  - [x] 1.19 Verify AC7: `memo inspect`-equivalent check before/after a seed run shows `decisions` untouched — `decisions` (170 production points) has zero overlap with the 44 fixture ids; `memo_eval` holds exactly 44 points after two `--seed` runs (idempotency confirmed)
  - [x] 1.20 Verify AC8: record overall and per-category baseline as a PRD changelog row — real numbers recorded in row 1.6, superseding the 1.5 placeholder
  - [x] 1.21 Document the eval workflow and `MEMO_COLLECTION` under Development in `README.md`
  - [x] 1.22 Map every AC to its test or evidence in the PR body
  - [x] 1.23 Migration: record the not-required opt-out rationale in the PR body
  - [x] 1.24 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit` (`format:check` clean on this diff; repo-wide fails on pre-existing unrelated drift — see PR #66)
  - [ ] 1.25 Run `verifier` audit (mandatory, pre-PR-ready); route drift findings to `product-engineer` — **not run**: `developer` has no `Task` tool in this delegation context; caller (`planner`) owns invoking `verifier` directly per the operating contract
  - [ ] 1.26 Open PR against `main`, link `Closes #61`, obtain user approval, merge — PR [#66](https://github.com/llipe/memo-cli/pull/66) opened as **draft** against `integration/prd-004-phase-1-trustworthy-retrieval` (base-branch override per orchestrated-run instructions), not yet merged

- [ ] 2.0 Implement Story S1-02: Composite ranking score — [#34](https://github.com/llipe/memo-cli/issues/34)

  > Note: the refinement doc `workstream/issue-34-composite-ranking-score-refinement.md` is binding in full, including decisions D1–D9, defects DEF-1 and DEF-2, and criteria AC1–AC18.
  - [x] 2.1 Add `RankingConfig` to `src/types/config.ts`: `w_similarity`, `w_recency`, `w_source`, `recency_half_life_days`; `superRefine` for weight sum `1.0 ± 0.001`, each weight in `[0,1]`, half-life `.positive()`
  - [x] 2.2 Wire `ranking` into `MemoConfigSchema` as optional with full defaults `0.6 / 0.3 / 0.1 / 90` (partial blocks rejected, AC11)
  - [x] 2.3 Create `src/lib/ranking.ts`: `computeRecencyScore`, `computeSourceScore`, `computeCompositeScore`, `rankResults`; `now` injected, no I/O
  - [x] 2.4 Implement the neutral factor bag so unimplemented factors return 1.0 or 0 per PRD §8.2
  - [x] 2.5 Implement clamps: similarity into `[0,1]` (D8), negative age to 0 (R4), malformed or missing `timestamp_utc` → `recency_score` 0 (D4, R5), unknown or missing `source` → 0.5 (D5)
  - [x] 2.6 Implement the stable tiebreak: `final_score` desc, `timestamp_utc` desc, `id` asc (R9)
  - [x] 2.7 Load and validate `ranking` in `src/lib/config.ts` so invalid weights raise `CONFIG_INVALID` at load (D7) — fixed via `src/commands/search.ts`'s catch, which previously swallowed `CONFIG_INVALID` the same as `CONFIG_NOT_FOUND` (a real defect against AC12/D7)
  - [x] 2.8 Extend `memo setup validate` to report weight-sum failures with the offending path and actual sum — satisfied by the Zod `superRefine` message; no separate `setup.ts` code change needed
  - [x] 2.9 Compute the over-fetch limit `max(limit, min(limit * 3, 50))` in `src/commands/search.ts`; keep `QdrantRepository.search` signature unchanged
  - [x] 2.10 Call `rankResults` after fetch, slice to `--limit`, attach `final_score`, `similarity`, `recency_score`, `source_score` to JSON results
  - [x] 2.11 Point `output.searchResults` at `final_score` for the percentage, position unchanged (D6)
  - [x] 2.12 Write `tests/unit/lib/ranking.test.ts`: recency at 0/45/90/180/270/360 days (270 ≈ 0.125 per DEF-2, `< 0.1` only at 4×), future, missing, malformed; source for all values plus unknown and undefined; composite with default and custom weights, bounded, negative similarity; `rankResults` ordering, the AC2 scenario, tiebreak, empty, single — 39 tests, 98.3% stmts / 97.77% branch / 100% funcs / 100% lines on `ranking.ts`
  - [x] 2.13 Extend `tests/unit/lib/config.test.ts`: valid block, absent block defaults, sums 0.9 and 1.1 rejected, half-life 0 and negative rejected (R10), weight outside `[0,1]` rejected (R11), partial block rejected
  - [x] 2.14 Extend `tests/unit/commands/setup.test.ts` — added to `tests/integration/commands/setup.test.ts` instead (existing `handleValidate` suite lives there with real fs I/O, no separate unit file existed): `validate` exit 0 on valid, exit 1 with descriptive error naming `ranking` and the actual sum on invalid sum, exit 0 with no block, exit 1 on a partial block that breaks the sum
  - [x] 2.15 Update `tests/unit/commands/search.test.ts` per DEF-1: over-fetch assertions `--limit 3` → 9, `--limit 20` → 50, `--limit 100` → 100; slicing after ranking; JSON shape; empty-result path preserved. Also updated `tests/integration/commands/search.test.ts`'s pre-existing over-fetch (10→30) and percentage (91%→65%) assertions, which the same DEF-1/D6 changes broke
  - [x] 2.16 Verify AC1–AC4: ordering by `final_score`, the newer-beats-older scenario, the 0.05 source delta, bounded output
  - [x] 2.17 Verify AC5–AC7: four score fields present, human percentage sourced from `final_score`, envelope keys unchanged in name, type, and position
  - [x] 2.18 Verify AC8–AC12: config validation behavior end to end, including fail-fast on `memo search`
  - [x] 2.19 Verify AC13–AC14: over-fetch formula including `--limit 100` → 100
  - [x] 2.20 Verify AC19–AC21 (added by the GitHub issue's refined-scope comment): AC19 (factor bag) and AC20 (purity) PASS. **AC21 initially FAILED at spec defaults (85.7% vs the 92.9% S1-01 floor), then resolved by applying the task 8.0 tuning-sweep methodology to this story per explicit user decision:** a one-factor sweep over `recency_half_life_days` (weights held at 0.6/0.3/0.1) found a robust 96.4% plateau from ~260-700+ days; `365` was chosen and re-recorded live as the new legitimate floor. AC21 now genuinely PASSES — see 2.22 and the PR body for the full sweep grid and numbers
  - [x] 2.21 Manual: `memo search "auth roles" --limit 5`, then `--json`, then `memo setup validate` with a valid and an injected invalid weight sum — run against live Qdrant Cloud (`MEMO_COLLECTION=memo_eval`); see PR body for output
  - [x] 2.22 Run `pnpm run eval:relevance`; state before and after hit rates in the PR body — required updating `scripts/eval-relevance.ts`'s live-run `toQueryResults` and `tests/relevance/replay.test.ts`'s offline replay to rank candidates through `rankResults` before slicing top-3 (they previously used raw Qdrant/similarity order and so were structurally incapable of measuring any ranking-affecting story, defeating PRD §8.2 R6's "re-validated at the end of every phase"). Timeline: (1) composite ranking at spec defaults (half-life 90) measured **85.7%**, below the S1-01 floor (**92.9%**) — a genuine AC21 failure, reported honestly and left failing rather than papered over. (2) Per explicit user decision, applied task 8.0's tuning-sweep methodology to this story: swept `recency_half_life_days` at the unchanged spec weights (0.6/0.3/0.1) over an 11-point grid; found a robust plateau of **96.4%** from ~260 to 700+ days. Chose `365` as the simplest value inside it, updated the default in `src/lib/ranking.ts`/`src/types/config.ts`, and re-recorded `tests/fixtures/relevance/baseline.json`/`candidates.json` for real against live Qdrant Cloud (`MEMO_COLLECTION=memo_eval`) at that new default — this is now the legitimate 96.4% floor (concept 100%, identifier 100%, cross-repo 83.3%, recency 100%), not a downgrade. `replay.test.ts` now genuinely passes. See PR body for the full sweep grid
  - [x] 2.23 Document the `ranking` block with defaults and the weight-sum rule in `README.md`; update `docs/data-model.md` and `docs/system-overview.md` search flow
  - [x] 2.24 Map every AC to its test per the refinement's AC-to-test table in the PR body
  - [x] 2.25 Migration: record the not-required opt-out (refinement Migration Assessment) in the PR body
  - [x] 2.26 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit` — lint/typecheck/audit green; `format:check` clean on every file this story touches (repo-wide fails on pre-existing drift). `pnpm test`: **347/347 pass** (after the task 8.0 sweep re-recorded the relevance floor — see 2.20/2.22 — `replay.test.ts`'s AC21 gate genuinely passes, not weakened). Repo-wide `test:coverage` still fails on a pre-existing shortfall that predates this story (see PR body)
  - [ ] 2.27 Run `verifier` audit; route drift findings to `product-engineer` — **not run**: `developer` has no `Task` tool in this delegation context; caller (`planner`) owns invoking `verifier` directly per the operating contract
  - [ ] 2.28 Open PR against `main`, link `Closes #34`, obtain user approval, merge — PR [#67](https://github.com/llipe/memo-cli/pull/67) opened as **draft** against `integration/prd-004-phase-1-trustworthy-retrieval` (base-branch override per orchestrated-run instructions), not `main`; not yet merged

- [ ] 3.0 Implement Story S1-03: Tag overlap boosting — [#36](https://github.com/llipe/memo-cli/issues/36)

  > Note: `tag_boost` is one of two additive boosts; `lexical_boost` (task 6.0) is the other. Both apply before the 1.0 cap.
  - [x] 3.1 Add `tag_boost_factor` (default `0.05`, `0` disables) to `RankingConfig`
  - [x] 3.2 Implement `computeTagBoost(query, tags, factor)` in `src/lib/ranking.ts` with the fixed stopword list (`a, the, is, for, of, in, to, with`)
  - [x] 3.3 Normalize the query once per invocation, not per candidate
  - [x] 3.4 Apply the boost in `rankResults` as `min(1, base + tag_boost)`, composing with a sibling boost slot
  - [x] 3.5 Pass the raw query string into `rankResults` from `src/commands/search.ts`; attach `tag_boost` to every result
  - [x] 3.6 Extend `tests/unit/lib/ranking.test.ts`: single match, multiple, none, stopword-only query, mixed case, punctuation, hyphenated tag, factor 0, cap at 1.0, empty tags
  - [x] 3.7 Extend `tests/unit/commands/search.test.ts`: `tag_boost` present on results; tag-matching entry outranks an equal-similarity non-matching one
  - [x] 3.8 Edge cases: one-term query, 50-term query, 5-tag maximum, unicode in query
  - [x] 3.9 Verify AC1–AC3: formula, disable at 0, whole-word and case-insensitive matching with stopwords excluded
  - [x] 3.10 Verify AC4–AC6: `tag_boost` in JSON, human output unchanged, cap respected, no division by zero
  - [x] 3.11 Verify AC7: replay hit rate ≥ baseline; numbers in the PR body — **96.4% before, 96.4% after** (tag_boost is neutral on this fixture set at the default factor; see PR body for the before/after breakdown)
  - [x] 3.12 Manual: `memo search "rate limiting strategy" --json | jq '.results[].tag_boost'` — ran live against Qdrant Cloud, field present (`0` for this repo's current entries, no tag overlap)
  - [x] 3.13 Document `tag_boost_factor` in `README.md`
  - [x] 3.14 Map every AC to its test in the PR body
  - [x] 3.15 Migration: record the not-required opt-out in the PR body
  - [x] 3.16 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit` — lint/typecheck/audit green; `format:check` clean on every file this story touches (repo-wide fails on pre-existing drift, same precedent as task 2.26); `pnpm test`: **379/379 pass**
  - [ ] 3.17 Run `verifier` audit; route drift findings to `product-engineer` — **not run**: `developer` has no `Task` tool in this delegation context; caller (`planner`) owns invoking `verifier` directly per the operating contract
  - [ ] 3.18 Open PR against `main`, link `Closes #36`, obtain user approval, merge — PR opened as **draft** against `integration/prd-004-phase-1-trustworthy-retrieval` (base-branch override per orchestrated-run instructions), not `main`; not yet merged

- [ ] 4.0 Implement Story S1-04: Dynamic confidence tiers — [#35](https://github.com/llipe/memo-cli/issues/35)

  > Note: this is the only output removal in Phase 1. The payload `confidence` field stays in storage, `memo write`, and `memo read`; only `memo search` output drops it.
  - [ ] 4.1 Add `confidence_thresholds` (`exact` 0.88, `high` 0.75, `medium` 0.60) to `RankingConfig` with a strict descending-order `superRefine`
  - [ ] 4.2 Implement `computeConfidenceTier(finalScore, thresholds)` in `src/lib/ranking.ts`
  - [ ] 4.3 Attach `confidence_tier` to each result in `rankResults`
  - [ ] 4.4 Remove `confidence` from the search result projection in `src/commands/search.ts`
  - [ ] 4.5 Extend `memo setup validate` to reject invalid threshold ordering with the offending path
  - [ ] 4.6 Add the `[tier]` prefix in `src/lib/output.ts` with the semantic color policy and an always-present text label
  - [ ] 4.7 Extend `tests/unit/lib/ranking.test.ts`: each band, all three exact boundaries, custom thresholds, score 0 and 1
  - [ ] 4.8 Extend `tests/unit/lib/config.test.ts` and `setup.test.ts`: valid, equal, and inverted threshold ordering
  - [ ] 4.9 Update `tests/unit/commands/search.test.ts` to assert `confidence_tier` present and `confidence` absent
  - [ ] 4.10 Add `tests/unit/commands/read.test.ts` assertion that `confidence` is still present in `memo read`
  - [ ] 4.11 Extend `tests/unit/lib/output.test.ts` for the `[tier]` prefix
  - [ ] 4.12 Edge cases: missing thresholds object (defaults), partial thresholds, `NO_COLOR` set, non-TTY output
  - [ ] 4.13 Verify AC1, AC6: tier per band and at every boundary exactly
  - [ ] 4.14 Verify AC2: invalid ordering fails `memo setup validate` and `loadConfig`
  - [ ] 4.15 Verify AC3–AC5: `confidence_tier` in JSON, `confidence` removed from search only, `[tier]` in human output
  - [ ] 4.16 Verify AC7: replay hit rate ≥ baseline and unchanged (tiers annotate, they do not reorder)
  - [ ] 4.17 Manual: `memo search "auth" --limit 5`; `memo setup validate` with `exact: 0.5, high: 0.8` exits 1
  - [ ] 4.18 Document the tier contract and the `confidence` removal in `README.md`; update `docs/system-overview.md`
  - [ ] 4.19 Map every AC to its test in the PR body; call out the output removal explicitly
  - [ ] 4.20 Migration: record the not-required opt-out; note the consumer impact of the `confidence` removal
  - [ ] 4.21 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`
  - [ ] 4.22 Run `verifier` audit; route drift findings to `product-engineer`
  - [ ] 4.23 Open PR against `main`, link `Closes #35`, obtain user approval, merge

- [ ] 5.0 Implement Story S1-05: Staleness detection — [#38](https://github.com/llipe/memo-cli/issues/38)

  > Note: the output field is `stale_by`, not `superseded_by` (decision D-1), so it never collides with the Phase 2 stored payload field of that name.
  - [ ] 5.1 Add `staleness_threshold_days` (120) and `staleness_tag_overlap_threshold` (0.5) to `RankingConfig`
  - [ ] 5.2 Create `src/lib/staleness.ts` with `computeJaccardOverlap` and `detectStaleness(candidates, corpus, config, now)` (pure, `now` injected)
  - [ ] 5.3 Add `fetchByRepo(repos, limit)` to `QdrantRepository`, built on `scroll`, ordered by `timestamp_utc` desc, bounded at 1,000 with the bound documented in code
  - [ ] 5.4 Call `fetchByRepo` once per `memo search` invocation in `src/commands/search.ts`, cache for the command duration, annotate after ranking
  - [ ] 5.5 Emit `stale: true` and `stale_by` only when flagged; omit both keys entirely when not stale
  - [ ] 5.6 Render `⚠ STALE — superseded by <id>` inline in `src/lib/output.ts`
  - [ ] 5.7 Write `tests/unit/lib/staleness.test.ts`: Jaccard identical, disjoint, partial, empty on one side, empty on both; detection for older-with-overlapping-newer, older-with-non-overlapping-newer, newest entry, overlap exactly at threshold, age exactly at threshold, multiple superseders (newest wins), same-timestamp tie
  - [ ] 5.8 Extend `tests/unit/commands/search.test.ts`: exactly one scroll call regardless of result count; keys omitted when not stale; ordering identical with staleness on and off
  - [ ] 5.9 Extend `tests/unit/lib/qdrant.test.ts` for `fetchByRepo` filter shape and ordering
  - [ ] 5.10 Edge cases: empty corpus; corpus at the fetch bound; malformed `timestamp_utc` (never stale, never throws); `--scope related` corpus covers the resolved repo set; zero results
  - [ ] 5.11 Verify AC1–AC3: threshold plus overlap rule, `stale_by` id, omit-when-false
  - [ ] 5.12 Verify AC4: `final_score` and ordering unaffected
  - [ ] 5.13 Verify AC5–AC6: one `scroll` (not `search`) per invocation, cached, repo-scoped
  - [ ] 5.14 Verify AC7: human warning renders inline under the flagged result
  - [ ] 5.15 Verify AC8: measure `memo search` latency on a 1,000-entry repo against the 2.5 s target; state it in the PR body
  - [ ] 5.16 Verify AC9: Jaccard boundary values and the no-tags rule
  - [ ] 5.17 Manual: seed an old entry and a newer overlapping one in the eval collection; confirm the warning and the JSON field
  - [ ] 5.18 Document staleness config and output in `README.md`; update `docs/system-overview.md` search flow
  - [ ] 5.19 Map every AC to its test in the PR body
  - [ ] 5.20 Migration: record the not-required opt-out (derived annotation, no payload write)
  - [ ] 5.21 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`
  - [ ] 5.22 Run `verifier` audit; route drift findings to `product-engineer`
  - [ ] 5.23 Open PR against `main`, link `Closes #38`, obtain user approval, merge

- [ ] 6.0 Implement Story S1-06: Lexical identifier matching — [#62](https://github.com/llipe/memo-cli/issues/62)

  > Note: largest task in the phase and the one most likely to move the hit rate. Decision A4 applies: this is an additive boost over a unioned candidate set, not reciprocal rank fusion.
  - [ ] 6.1 Verify on the target Qdrant version that a `text` index on the array field `files_modified` tokenizes each element; if not, index `rationale` only and record the limitation in the PR and `docs/data-model.md`
  - [ ] 6.2 Split `ensureCollection` into collection creation and `ensureIndexes`
  - [ ] 6.3 Implement `ensureIndexes` to read `getCollection().payload_schema` and create only missing indexes from `PAYLOAD_INDEXES`; idempotent
  - [ ] 6.4 Extend `PAYLOAD_INDEXES` with text indexes on `rationale` and `files_modified` (`word` tokenizer, lowercase, min 2, max 20)
  - [ ] 6.5 Add a `withVector` option to `QdrantRepository.scroll` without changing existing call-site behavior
  - [ ] 6.6 Implement `extractIdentifierTokens(query)` in `src/lib/lexical.ts`
  - [ ] 6.7 Implement word-tokenizer parity (lowercase, split on non-alphanumerics, drop tokens shorter than 2)
  - [ ] 6.8 Implement `cosine(a, b)` with defensive normalization
  - [ ] 6.9 Implement `computeLexicalBoost(identifiers, rationale, files, factor)` with all-or-nothing per-identifier matching
  - [ ] 6.10 Add `lexical` (bool, default true) and `lexical_boost_factor` (default 0.15) to `RankingConfig`
  - [ ] 6.11 Add `--lexical <on|off>` to `memo search`
  - [ ] 6.12 Build the lexical scroll in `src/commands/search.ts`: one call, `should` per identifier over both fields, `min_should: 1`, same pre-filters, `limit 50`, `with_vector: true`
  - [ ] 6.13 Compute local cosine for lexical-only candidates; keep Qdrant scores for dense candidates; union and dedupe by id
  - [ ] 6.14 Add `lexical_boost` into the composite alongside `tag_boost` before the 1.0 cap
  - [ ] 6.15 Wrap the lexical scroll so failure degrades to dense-only results, logged under `MEMO_DEBUG`, exit code unchanged
  - [ ] 6.16 Write `tests/unit/lib/lexical.test.ts`: identifier extraction for file paths, dotted names, kebab, snake, `#123`, `PROJ-45`, `--flag`, CamelCase, prose-only, empty, punctuation-heavy; tokenizer parity; boost for full, partial, none, multiple, factor 0; cosine for identical, orthogonal, opposite, zero-length
  - [ ] 6.17 Extend `tests/unit/commands/search.test.ts`: scroll call count 1 with identifiers, 0 without; union dedupe; `--lexical off`; graceful degradation on scroll failure
  - [ ] 6.18 Extend `tests/unit/lib/qdrant.test.ts` and `tests/integration/lib/qdrant.test.ts`: `ensureIndexes` creates only missing indexes and is idempotent
  - [ ] 6.19 Edge cases: identifier in 100+ entries (limit 50 respected); all-identifier query; identifier below `min_token_len`; empty `files_modified`; missing collection
  - [ ] 6.20 Verify AC1–AC2: index reconciliation and text index options
  - [ ] 6.21 Verify AC3, AC5–AC6: extraction, cosine assignment, union dedupe, boost formula
  - [ ] 6.22 Verify AC4, AC7–AC8: exactly one extra scroll when applicable, none when disabled or when no identifiers exist
  - [ ] 6.23 Verify AC9: an `identifier` eval query returns its expected entry in the top 3 with lexical on
  - [ ] 6.24 Verify AC10: overall replay ≥ baseline and ≥ task 5.0's number; `memo search` under 2.5 s with both extra scrolls active
  - [ ] 6.25 Verify AC11: run `ensureIndexes` against a collection created by v1.1.x and confirm existing points match
  - [ ] 6.26 Run `pnpm run eval:relevance` with lexical on and off; record per-category numbers in the PR body
  - [ ] 6.27 Document `--lexical`, both config keys, and the index table in `README.md`, `docs/data-model.md`, `docs/system-overview.md`
  - [ ] 6.28 Map every AC to its test in the PR body
  - [ ] 6.29 Migration: record the artifact-not-required rationale, the automatic apply path, the verification step (`getCollection` shows both text indexes), and that rollback leaves two harmless unused indexes
  - [ ] 6.30 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`
  - [ ] 6.31 Run `verifier` audit; route drift findings to `product-engineer`
  - [ ] 6.32 Open PR against `main`, link `Closes #62`, obtain user approval, merge

- [ ] 7.0 Implement Story S1-07: `query_id` and `--explain` — [#63](https://github.com/llipe/memo-cli/issues/63)

  > Note: `query_id` is deliberately inert in Phase 1. It establishes the contract so Phase 3 adds behavior without another output change.
  - [ ] 7.1 Generate a `query_id` per invocation with `randomUUID` in `src/commands/search.ts`
  - [ ] 7.2 Add `query_id` to the JSON envelope without moving existing keys
  - [ ] 7.3 Add the `--explain` flag to `memo search`
  - [ ] 7.4 Project the factor bag into each result as `factors` when `--explain` is set
  - [ ] 7.5 Ensure neutral factors are explicit: `retention` 1.0, `use_ratio` 0, `link_factor` 1.0
  - [ ] 7.6 Render the aligned factor table in `src/lib/output.ts` and the `query_id` footer line under `--explain`
  - [ ] 7.7 Extend `tests/unit/commands/search.test.ts`: `query_id` present, unique across two invocations, envelope key order preserved, no write or file calls, factor completeness, no extra client calls under `--explain`
  - [ ] 7.8 Extend `tests/unit/lib/output.test.ts` for factor-table formatting with long and short values
  - [ ] 7.9 Edge cases: zero results with `--explain` (empty state unchanged, `query_id` still present in JSON); `--explain` with `--lexical off` shows `lexical_boost: 0.0` rather than omitting it
  - [ ] 7.10 Verify AC1–AC4: id presence, uniqueness, nothing persisted, envelope stability
  - [ ] 7.11 Verify AC5–AC8: factor object completeness, human table, no extra calls, neutral values explicit
  - [ ] 7.12 Manual: `memo search "caching" --explain` and `--explain --json | jq '.results[0].factors'`
  - [ ] 7.13 Document `--explain` and the `query_id` contract in `README.md`
  - [ ] 7.14 Map every AC to its test in the PR body
  - [ ] 7.15 Migration: record the not-required opt-out in the PR body
  - [ ] 7.16 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`
  - [ ] 7.17 Run `verifier` audit; route drift findings to `product-engineer`
  - [ ] 7.18 Open PR against `main`, link `Closes #63`, obtain user approval, merge

- [ ] 8.0 Implement Story S1-08: Phase 1 exit gate — [#64](https://github.com/llipe/memo-cli/issues/64)

  > Note: a gate, not a feature. A failing gate is tuned and re-measured inside this task; it is never deferred to Phase 2. The formula is fixed by the PRD — only defaults are tunable here.
  - [ ] 8.1 Seed the eval collection and run `pnpm run eval:relevance` with every Phase 1 feature enabled; record overall and per-category numbers
  - [ ] 8.2 Compare against the gate: overall ≥ 80% or ≥ baseline + 15 points, whichever is lower, never below baseline
  - [ ] 8.3 If the gate is not met, sweep one factor at a time over a small grid keeping weights summing to 1.0; re-measure after each change
  - [ ] 8.4 Prefer the simplest configuration within 2 points of the best result; update defaults in `src/types/config.ts`
  - [ ] 8.5 Re-record `candidates.json` and `baseline.json` so the replay test guards the new floor
  - [ ] 8.6 Record per-category divergence (for example `identifier` high, `recency` low) as input to PRD §18 Q3
  - [ ] 8.7 Sweep `README.md` for drift: search flags, config block, JSON contract, output examples
  - [ ] 8.8 Sweep `docs/data-model.md`: index table, output field list
  - [ ] 8.9 Sweep `docs/system-overview.md`: search flow, library inventory
  - [ ] 8.10 Sweep `docs/technical-guidelines.md`: architecture tree, config surface, any new error codes
  - [ ] 8.11 Confirm no doc references a Phase 1 field that does not exist and no shipped field is undocumented
  - [ ] 8.12 Invoke `qa-engineer`; fill `/TESTING.md` (layers, boundaries, packages, runner, environment, runtime parity, coverage tooling)
  - [ ] 8.13 Record `coverage_gate: PASS | FAIL | SKIPPED(<reason>)` in the PR
  - [ ] 8.14 Run `pnpm run test:coverage`; verify overall ≥ 80% and `src/lib/` ≥ 85%
  - [ ] 8.15 Invoke `verifier` audit mode against the full Phase 1 delivery; route findings to `product-engineer` (non-blocking)
  - [ ] 8.16 Manual smoke: `memo search`, `memo list`, `memo read`, `memo write` confirm no regression in default human output
  - [ ] 8.17 Edge cases: eval run against an empty collection reports 0% and exits 0; config with all defaults absent resolves every default
  - [ ] 8.18 Verify AC1–AC4: live run executed, gate met, any default change justified with before and after numbers, artifacts re-recorded
  - [ ] 8.19 Verify AC5–AC6: docs synchronized, `/TESTING.md` filled, `coverage_gate` recorded
  - [ ] 8.20 Verify AC7–AC9: verifier run and routed, PRD changelog updated with exit numbers, Phase 1 criteria checked off, coverage thresholds held
  - [ ] 8.21 Update the PRD changelog and tick the Phase 1 acceptance criteria
  - [ ] 8.22 Migration: record the not-required opt-out (docs, fixtures, and default values only)
  - [ ] 8.23 Run quality gate: `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm audit`
  - [ ] 8.24 Open PR against `main`, link `Closes #64`, obtain user approval, merge
  - [ ] 8.25 Tag and publish release `v1.2.0` per the manual release checklist in `README.md`

## Execution Notes

- **Branch naming:** `issue/<number>-<short-description>` per the technical guidelines, one branch per parent task.
- **Commits:** Conventional Commits; reference the issue number in the body.
- **Never merge into `main` without user approval.** Every PR in this plan targets `main` and requires the user to approve and merge.
- **Approval gate:** `/developer` pauses after each sub-task. For autonomous runs, `/planner` gates at the parent-task boundary.
- **The `verifier` audit before PR-ready is mandatory and non-skippable** for every parent task; drift findings are non-blocking and route to `product-engineer`'s drift-reconciliation skill.
- **If the gate in task 8.0 fails and tuning cannot close it**, stop and escalate: the formula is fixed by the PRD, so closing the gap requires a PRD revision, not a code change.
