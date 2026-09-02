# Implementation Plan - Issue #34: Composite Ranking Score for Search Results

## Changelog

| Version | Date       | Summary            | Author           |
| ------- | ---------- | ------------------ | ---------------- |
| 1.0     | 2026-08-25 | Initial task list  | product-engineer |

## Source Documents

- Refinement: `workstream/issue-34-composite-ranking-score-refinement.md`
- Story set: `workstream/user-stories-ranking-retrieval.md`
- GitHub Issue: [#34](https://github.com/llipe/memo-cli/issues/34)

## Scope Corrections Applied

Two deviations from the issue's "Files to Create/Modify" table, both discovered during planning:

| Finding | Detail |
| ------- | ------ |
| **`src/lib/output.ts` was missing from the issue's file table** | AC6 (human output shows `final_score`) cannot be satisfied without it. `output.searchResults()` reads `result.similarity` at `src/lib/output.ts:143`. Added to scope along with `tests/unit/lib/output.test.ts`. |
| **`src/commands/setup.ts` likely needs no change** | `handleValidate` → `validateConfig` → `MemoConfigSchema.safeParse`, and errors are already rendered with their `path`. A `superRefine` issue on the `ranking` block surfaces automatically. Task 1.10 **verifies** this rather than assuming a code change; only if propagation fails does `setup.ts` get touched. |

Additional deviation from the issue body, carried over from refinement: over-fetch is computed in `src/commands/search.ts`, **not** `src/lib/qdrant.ts`, to keep `QdrantRepository` free of ranking policy. `QdrantRepository.search`'s signature is unchanged, so `src/lib/qdrant.ts` is **not** modified by this issue.

## Migration Assessment

**No migration artifact required — documented opt-out.** This change adds an optional block to the local `memo.config.json` and alters nothing about the Qdrant `decisions` collection, its vector configuration, its payload indexes, or the `EntryPayload` schema. Recency derives from `timestamp_utc`, already indexed as `datetime` and already present on stored entries. No backfill, reindex, or point rewrite is needed. Configs without a `ranking` block continue to load unchanged (AC10). No seed data required — this feature reads existing entries only.

## Toolchain Notes

- Package manager is **pnpm**.
- `pnpm test` forwards args through `scripts/run-jest.mjs`, so `pnpm test -- --testPathPattern="ranking"` works.
- **There is no `audit` script.** AC18 references `pnpm run audit`, which does not exist in `package.json`. Use `pnpm audit --audit-level=high` directly (matching the CI step in `docs/technical-guidelines.md` §13).
- **Coverage is global-only.** `jest.config.ts` enforces `lines/functions/statements 80`, `branches 75`. There is **no** per-directory 85% gate for `src/lib/`. AC17's `src/lib ≥ 85%` is a guideline target to be confirmed by report inspection, not an enforced failure. Do not add a new threshold under this issue.

## Relevant Files

- `src/types/config.ts` - Add `RankingConfigSchema` with weight-sum `superRefine`; extend `MemoConfigSchema` with an optional `ranking` block.
- `src/lib/ranking.ts` - **New.** Pure scoring functions: `computeRecencyScore`, `computeSourceScore`, `computeCompositeScore`, `rankResults`. No I/O, injected `now`.
- `src/lib/config.ts` - Expose resolved ranking defaults; confirm `CONFIG_INVALID` propagation for bad weights.
- `src/commands/search.ts` - Compute over-fetch limit, call `rankResults`, slice to `--limit`, emit four score fields in JSON.
- `src/lib/output.ts` - Add `final_score` to `SearchHumanResult`; render it as the percentage. **(Not in the issue's file table.)**
- `src/commands/setup.ts` - Verify only; change only if weight-sum errors do not already propagate through `validate`.
- `tests/unit/lib/ranking.test.ts` - **New.** Unit tests for all four scoring functions.
- `tests/unit/lib/config.test.ts` - Extend with `ranking` block load/default/rejection cases.
- `tests/unit/commands/search.test.ts` - Extend with over-fetch, slicing, and JSON-shape cases; fix the DEF-1 limit assertion.
- `tests/unit/commands/setup.test.ts` - **New.** `validate` exit codes for valid/invalid `ranking` blocks.
- `tests/unit/lib/output.test.ts` - Extend with `final_score` rendering.
- `README.md` - Document the `ranking` block (§"Example `memo.config.json`") and the new score fields (§"Reading search results").

## Tasks

- [ ] 1.0 Implement Issue [#34](https://github.com/llipe/memo-cli/issues/34): feat: composite ranking score for search results

  > Note: Foundation story of the Ranking & Retrieval set. Blocks #35, #38, #37. #36 edits the same `src/lib/ranking.ts` — land this first to avoid a merge conflict.
  > Ranking is post-retrieval and in-process. `similarity` is retained alongside `final_score`; only ordering and the human-output percentage change.

  **Configuration schema**

  - [ ] 1.1 Add `RankingConfigSchema` to `src/types/config.ts` with `w_similarity` (default `0.6`), `w_recency` (default `0.3`), `w_source` (default `0.1`), each `.min(0).max(1)` (R11), and `recency_half_life_days` (default `90`, `.positive()`, R10). Add a `superRefine` asserting the three weights sum to `1.0` within ±0.001 (R3 — tolerance comparison, never `===`), emitting an issue whose `path` is `['ranking']` and whose message states the actual sum (AC9).
  - [ ] 1.2 Extend `MemoConfigSchema` with an optional `ranking` block that defaults to the full default object when absent (AC10), preserving the existing `.passthrough()` and top-level `superRefine` behavior. Confirm a v1 config with no `ranking` key still parses (schema evolution constraint).
  - [ ] 1.3 In `src/lib/config.ts`, confirm `loadConfig` surfaces weight-sum failures as `CONFIG_INVALID` (D7/AC12) with no silent default fallback, and export a resolved-ranking accessor if `search.ts` needs one. Avoid duplicating validation logic already in the Zod schema.

  **Scoring library**

  - [ ] 1.4 Create `src/lib/ranking.ts` with `computeRecencyScore(timestampUtc, halfLifeDays, now)`: exponential decay `exp(-ln(2)/halfLife * ageDays)`; clamp negative age to `0` so future timestamps yield `1.0` (R4); return `0` for missing, non-string, or unparseable timestamps guarded by `Number.isFinite` (D4/R5). `now` **MUST** be an injected parameter defaulting to `Date.now()` — no internal clock read.
  - [ ] 1.5 Add `computeSourceScore(source)` mapping `agent`→`1.0`, `manual`→`0.8`, `scan`→`0.5`, with unknown and `undefined` both falling to `0.5` and never throwing (D5).
  - [ ] 1.6 Add `computeCompositeScore({ similarity, recencyScore, sourceScore }, weights)` applying the weighted sum. Clamp `similarity` into `[0,1]` before compositing (D8/R6) so a negative cosine value cannot break the bounded-output guarantee (AC4).
  - [ ] 1.7 Add `rankResults(results, config, now)` returning each result augmented with `final_score`, `similarity`, `recency_score`, and `source_score`, sorted `final_score` descending using a **stable** sort with the documented tiebreak `final_score` desc → `timestamp_utc` desc → `id` asc (R9). Empty input returns `[]` (R7). Keep the module free of imports from `commands/` or `qdrant.ts`.

  **Command wiring**

  - [ ] 1.8 In `src/commands/search.ts`, add an over-fetch helper computing `max(limit, min(limit * 3, 50))` (D2) and pass it as the `limit` argument to `qdrant.search`. Do **not** modify `src/lib/qdrant.ts` or `QdrantRepository.search`'s signature.
  - [ ] 1.9 In `src/commands/search.ts`, call `rankResults` on the fetched candidates, slice to the user's `--limit` (AC13), and update `toJsonResult` to emit `final_score`, `similarity`, `recency_score`, and `source_score` alongside all payload fields (AC5) while leaving the envelope keys `query`/`filters`/`results`/`count`/`message` unchanged in name, type, and position (AC7). Preserve the `...(x ? { x } : {})` spread idiom for `exactOptionalPropertyTypes`.
  - [ ] 1.10 Verify weight-sum errors already propagate through `memo setup validate` via `validateConfig` → `MemoConfigSchema.safeParse` and render with their field path. Modify `src/commands/setup.ts` **only** if propagation or message quality fails AC9.
  - [ ] 1.11 In `src/lib/output.ts`, add `final_score` to `SearchHumanResult` and render it as the percentage in the existing position after the repo label (AC6/D6 — layout unchanged, value swapped). Keep all output routed through `output.ts`; no `console.log`.

  **Tests**

  - [ ] 1.12 Create `tests/unit/lib/ranking.test.ts` covering `computeRecencyScore` at 0d→`1.0`, 45d→`≈0.7071`, 90d→`≈0.5`, 180d→`≈0.25`, 270d→`≈0.125` (per DEF-2, **not** `<0.1`), 360d→`<0.1`, plus future timestamp→`1.0`, missing→`0`, and malformed→`0`.
  - [ ] 1.13 Extend `tests/unit/lib/ranking.test.ts` with `computeSourceScore` for `agent`/`manual`/`scan`/unknown/`undefined`; `computeCompositeScore` for default weights, custom weights, `[0,1]` bounds, and negative-similarity clamping; and `rankResults` for descending order, the documented tiebreak, single input, and empty input.
  - [ ] 1.14 Extend `tests/unit/lib/config.test.ts`: valid `ranking` block preserves values; absent block yields full defaults; sums of `0.9` and `1.1` rejected with a path-qualified message; `recency_half_life_days` of `0` and negative rejected (R10); an individual weight outside `[0,1]` rejected (R11); a partial block rejected by weight-sum rather than silently mixed (AC11).
  - [ ] 1.15 Extend `tests/unit/commands/search.test.ts`, fixing the DEF-1 assertion: `--limit 3` now calls `qdrant.search` with `9`, `--limit 20` with `50`, `--limit 100` with `100` (AC14). Modifications are limited to the over-fetch limit and ordering expectations — no existing test may be deleted or have its intent weakened (AC15).
  - [ ] 1.16 Extend `tests/unit/commands/search.test.ts` with: results sliced to `--limit` after ranking; `--json` results carrying all four score fields; ordering by `final_score` not `similarity` (AC1); invalid-weight config propagating `CONFIG_INVALID` (AC12); and the empty-result path still rendering the existing empty-state message (R7).
  - [ ] 1.17 Create `tests/unit/commands/setup.test.ts` asserting `memo setup validate` exits `0` on a valid `ranking` block and exits `1` with a descriptive, path-qualified message on an invalid weight sum (AC8/AC9).
  - [ ] 1.18 Extend `tests/unit/lib/output.test.ts` asserting `searchResults` renders the percentage from `final_score` rather than `similarity` (AC6).

  **Documentation**

  - [ ] 1.19 Update `README.md` §"Example `memo.config.json`" with the `ranking` block, its four defaults, and the weight-sum rule; update §"Reading search results" to document `final_score`, `similarity`, `recency_score`, and `source_score`, noting that ordering now uses `final_score` while `similarity` is retained (D3).

  **Acceptance criteria verification**

  - [ ] 1.20 Verify AC1 + AC2: results order by `final_score` descending, and A (`sim 0.90`, 180d, `agent`) = `0.7150` ranks below B (`sim 0.82`, 5d, `agent`) = `0.8807` under defaults.
  - [ ] 1.21 Verify AC3 + AC4: `agent` scores exactly `0.05` above `scan` at equal similarity and recency; `final_score` stays within `[0,1]` including for negative input similarity.
  - [ ] 1.22 Verify AC5 + AC6 + AC7: JSON carries all four score fields plus every payload field; human output shows the composite percentage; envelope keys unchanged.
  - [ ] 1.23 Verify AC8 through AC12: valid block passes `validate`; bad sum fails with field path and actual sum; absent block uses defaults silently; partial block rejected; `memo search` fails `CONFIG_INVALID` on bad weights.
  - [ ] 1.24 Verify AC13 + AC14: over-fetch is `max(limit, min(limit*3, 50))` and output is sliced to `--limit`; `--limit 100` queries `100`.
  - [ ] 1.25 Manual verification against a live store: `pnpm build`, then `memo search "auth roles" --limit 5` (human percentage), `memo search "auth roles" --limit 5 --json` (four fields, descending `final_score`), `memo setup validate` (exit 0 with no `ranking` block), then inject `w_similarity: 0.5` and re-run `memo setup validate; echo "exit=$?"` (exit 1, clear message).

  **Quality gates**

  - [ ] 1.26 Run tests: `pnpm test -- --testPathPattern="ranking|search|setup|config|output"`, then the full `pnpm test` suite (AC15).
  - [ ] 1.27 Run `pnpm run test:coverage` and confirm the global gate holds (lines/functions/statements ≥ 80, branches ≥ 75); inspect the report to confirm `src/lib/` reaches ≥ 85% per the guideline target (AC17). Do not add a new threshold config under this issue.
  - [ ] 1.28 Run `pnpm run lint`, `pnpm run format:check`, `pnpm run typecheck`, and `pnpm audit --audit-level=high` (AC18 — note there is no `audit` npm script).
  - [ ] 1.29 Confirm the acceptance-criteria-to-test mapping table in the refinement doc is fully satisfied, with every AC traced to at least one automated test or the manual path in 1.25.

## Notes

- Branch: `issue/34-composite-ranking-score` (per `github-ops` conventions).
- Work currently sits on `main` with the refinement doc untracked — a feature branch **MUST** be created before any implementation begins.
- PR targets `main`, requires user approval, and must not be self-merged.
