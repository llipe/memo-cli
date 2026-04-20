# Implementation Plan — Ranking & Retrieval Improvement

## Relevant Files

- `src/types/config.ts` — Add `RankingConfig`, `AskConfig` Zod schemas; extend `MemoConfig`
- `src/lib/ranking.ts` — **New** — composite scoring, confidence tiers, tag boost
- `src/lib/staleness.ts` — **New** — Jaccard overlap, staleness detection
- `src/lib/llm.ts` — **New** — LLM client adapter (`buildAskPrompt`, `parseAskResponse`)
- `src/lib/config.ts` — Load/validate `ranking` and `ask` blocks with defaults
- `src/lib/qdrant.ts` — Over-fetch, expose raw similarity, add `fetchByRepo`
- `src/lib/output.ts` — Human output: confidence tier prefix, stale warning
- `src/commands/search.ts` — Apply ranking, tiers, tag boost, staleness detection
- `src/commands/setup.ts` — Extend `validate` to check weights sum + threshold ordering
- `src/commands/ask.ts` — **New** — full `memo ask` command
- `src/adapters/openai-llm.ts` — **New** — OpenAI chat completion adapter
- `src/index.ts` — Register `ask` command
- `tests/unit/lib/ranking.test.ts` — **New** — ranking unit tests
- `tests/unit/lib/staleness.test.ts` — **New** — staleness unit tests
- `tests/unit/lib/llm.test.ts` — **New** — LLM unit tests
- `tests/unit/commands/ask.test.ts` — **New** — ask command unit tests

## Tasks

- [ ] 1.0 Implement Issue #34: Composite Ranking Score ([https://github.com/llipe/memo-cli/issues/34](https://github.com/llipe/memo-cli/issues/34))
  - [ ] 1.1 Add `RankingConfig` Zod schema and extend `MemoConfig` in `src/types/config.ts`
  - [ ] 1.2 Create `src/lib/ranking.ts` with `computeRecencyScore`, `computeSourceScore`, `computeCompositeScore`, `rankResults`
  - [ ] 1.3 Update `src/lib/qdrant.ts` to over-fetch `limit * 3` (capped at 50) and expose raw similarity + metadata
  - [ ] 1.4 Load and validate `ranking` block with defaults in `src/lib/config.ts`
  - [ ] 1.5 Extend `memo setup validate` in `src/commands/setup.ts` to check weights sum to 1.0
  - [ ] 1.6 Update `src/commands/search.ts` to call `rankResults` after fetch and slice to `--limit`
  - [ ] 1.7 Write unit tests in `tests/unit/lib/ranking.test.ts`
  - [ ] 1.8 Verify AC: composite ordering, JSON output shape (`final_score`, `similarity`, `recency_score`, `source_score`), config validation
  - [ ] 1.9 Run tests: `pnpm test -- --testPathPattern="ranking|search|setup"`

- [ ] 2.0 Implement Issue #36: Tag Overlap Boosting ([https://github.com/llipe/memo-cli/issues/36](https://github.com/llipe/memo-cli/issues/36))
  > Can be done in parallel with Task 1.0 — independent story.
  - [ ] 2.1 Add `tag_boost_factor` to `RankingConfig` in `src/types/config.ts`
  - [ ] 2.2 Add `computeTagBoost(query, entryTags, boostFactor)` to `src/lib/ranking.ts` (or create standalone if 1.0 not yet merged)
  - [ ] 2.3 Apply `computeTagBoost` in `rankResults`, cap at 1.0, attach `tag_boost` to result
  - [ ] 2.4 Update `src/commands/search.ts` to pass raw query string into `rankResults`
  - [ ] 2.5 Write/extend unit tests in `tests/unit/lib/ranking.test.ts`
  - [ ] 2.6 Verify AC: boost applied, case-insensitive whole-word matching, stopword exclusion, `tag_boost: 0` when factor is 0
  - [ ] 2.7 Run tests: `pnpm test -- --testPathPattern="ranking|search"`

- [ ] 3.0 Implement Issue #35: Dynamic Confidence Tiers ([https://github.com/llipe/memo-cli/issues/35](https://github.com/llipe/memo-cli/issues/35))
  > Requires Task 1.0 to be completed first.
  - [ ] 3.1 Add `confidence_thresholds` to `RankingConfig` in `src/types/config.ts`
  - [ ] 3.2 Add `computeConfidenceTier(finalScore, thresholds)` to `src/lib/ranking.ts`
  - [ ] 3.3 Extend `memo setup validate` to reject invalid threshold ordering (e.g., `exact` < `high`)
  - [ ] 3.4 Attach `confidence_tier` to each result in `src/commands/search.ts`
  - [ ] 3.5 Update `src/lib/output.ts` human output to display tier label prefix `[exact]`, `[high]`, etc.
  - [ ] 3.6 Remove static `confidence: "high"` field from output
  - [ ] 3.7 Write/extend unit tests in `tests/unit/lib/ranking.test.ts`
  - [ ] 3.8 Update existing search tests to expect `confidence_tier` instead of `confidence`
  - [ ] 3.9 Verify AC: correct tier per score range, custom thresholds, human output format
  - [ ] 3.10 Run tests: `pnpm test -- --testPathPattern="ranking|search"`

- [ ] 4.0 Implement Issue #38: Staleness Detection ([https://github.com/llipe/memo-cli/issues/38](https://github.com/llipe/memo-cli/issues/38))
  > Requires Task 1.0 to be completed first.
  - [ ] 4.1 Add staleness fields (`staleness_threshold_days`, `staleness_tag_overlap_threshold`) to `RankingConfig` in `src/types/config.ts`
  - [ ] 4.2 Create `src/lib/staleness.ts` with `computeJaccardOverlap` and `detectStaleness`
  - [ ] 4.3 Add `fetchByRepo(repo): EntryPayload[]` to `QdrantRepository` using Qdrant scroll
  - [ ] 4.4 Update `src/commands/search.ts` to call `fetchByRepo` once, then run `detectStaleness` per result
  - [ ] 4.5 Attach `stale` and `superseded_by` to result; omit `stale` key entirely when false in JSON output
  - [ ] 4.6 Update human output to show `⚠ STALE — superseded by <id>` inline when `stale: true`
  - [ ] 4.7 Write unit tests in `tests/unit/lib/staleness.test.ts`
  - [ ] 4.8 Verify AC: stale flagging, omit-when-false, one scroll per invocation, no effect on `final_score`
  - [ ] 4.9 Run tests: `pnpm test -- --testPathPattern="staleness|search"`

- [ ] 5.0 Implement Issue #37: `memo ask` Command ([https://github.com/llipe/memo-cli/issues/37](https://github.com/llipe/memo-cli/issues/37))
  > Requires Tasks 1.0 and 3.0 to be completed first.
  - [ ] 5.1 Add `AskConfig` Zod schema and extend `MemoConfig` in `src/types/config.ts`
  - [ ] 5.2 Create `src/adapters/openai-llm.ts` — OpenAI chat completion adapter
  - [ ] 5.3 Create `src/lib/llm.ts` with `buildAskPrompt`, `parseAskResponse`, and LLM client dispatcher
  - [ ] 5.4 Create `src/commands/ask.ts` — full `memo ask` command with `--scope`, `--limit`, `--json` flags
  - [ ] 5.5 Register `memo ask` in `src/index.ts`
  - [ ] 5.6 Implement low-confidence filter (exclude `confidence_tier: low` before LLM call)
  - [ ] 5.7 Implement exit code 1 for missing `memo.config.json`, exit code 2 for unreachable LLM API
  - [ ] 5.8 Write unit tests in `tests/unit/commands/ask.test.ts`
  - [ ] 5.9 Write unit tests in `tests/unit/lib/llm.test.ts`
  - [ ] 5.10 Verify AC: grounded/ungrounded answers, low-confidence filtering, JSON output shape, `grounded` field
  - [ ] 5.11 Run tests: `pnpm test -- --testPathPattern="ask|llm"`
