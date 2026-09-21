# Fidelity Report — Story S1-02 (Issue #34)

## 1. Header / Verdict

- **Fidelity: High**
- **Highest drift impact: Minor**
- **Scope:** Issue #34, PR #67 (`issue/34-composite-ranking-score` → `integration/prd-004-phase-1-trustworthy-retrieval`)

## 2. Human-readable summary

Search results are now ordered by a blended score (similarity + recency + source reliability), not raw cosine similarity. During development, the originally-proposed default settings actually made the relevance-eval score _worse_ (85.7% vs. the prior 92.9% baseline) — a genuine regression. This was reported honestly rather than hidden: an initial attempt to hide it by overwriting the recorded baseline number was caught by the planner and reverted. The real fix — adjusting one setting (how quickly "freshness" decays over time) using the project's own documented tuning method, while leaving the importance weights and all binding design decisions untouched — raised accuracy to 96.4%, verified twice: once offline against a recorded dataset, and once live against the real database, with matching results. Independent verification of the code, tests, and a live test run confirms every claim in the story checks out.

## 3. Per-AC result table (spot-checked items; full AC1-AC18 traceability inherited from `test-plan-issue-34.md`/`traceability-matrix-issue-34.md`)

| AC-ID     | Description                                               | Codebase evidence                                                                                                              | Workstream evidence                                                    | Test evidence                                                                                         | Result |
| --------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------ |
| AC4 / D8  | Similarity clamped to [0,1] before compositing            | `clamp01` applied to similarity/recency/source in `computeCompositeScore`, `src/lib/ranking.ts`                                | Refinement doc D8                                                      | `ranking.test.ts` bounded-output + negative/NaN/Infinity clamp cases                                  | Pass   |
| AC12 / D7 | Fail-fast `CONFIG_INVALID`, no silent fallback            | `handleSearch` in `src/commands/search.ts` only forgives `CONFIG_NOT_FOUND`; all other errors (incl. `CONFIG_INVALID`) rethrow | Refinement doc D7; PR body defect note                                 | `search.test.ts` "propagates CONFIG_INVALID... (D7, AC12)"                                            | Pass   |
| DEF-1     | Over-fetch limit assertion corrected (9, not 3)           | `computeOverfetchLimit` pipeline in `search.ts`                                                                                | Refinement doc DEF-1                                                   | `search.test.ts:80-118` (9 for limit 3; 50/100 for 20/100)                                            | Pass   |
| DEF-2     | Recency decay at 3×half-life ≈0.125, not <0.1             | `computeRecencyScore` in `ranking.ts`                                                                                          | Refinement doc DEF-2, decay table                                      | `ranking.test.ts:34-45` exact assertions                                                              | Pass   |
| R9        | Stable tiebreak: final_score desc, timestamp desc, id asc | `compareRanked`/`sort` in `ranking.ts`                                                                                         | Refinement doc R9                                                      | `ranking.test.ts:231-261` both directions + no-timestamp fallback                                     | Pass   |
| AC21      | Composite ranking replay ≥ recorded baseline              | `DEFAULT_RECENCY_HALF_LIFE_DAYS = 365` (only numeric default moved; weights 0.6/0.3/0.1 untouched)                             | PR #67 body "Relevance eval: before/after" section; PRD changelog v1.8 | `tests/relevance/replay.test.ts` (genuine replay, no mocks) — green in live `pnpm test` run (347/347) | Pass   |

## 4. Drift catalog

1. **PR #67 body internal inconsistency** (stale `recency_half_life_days: 90` reference in the "What" section, contradicting the correct value stated in the banner, the "Relevance eval" section, and the actual code/fixtures).
   - Impact: **Minor**
   - Intent: **Unintended**
   - Evidence: `gh pr view 67` body text vs. `src/lib/ranking.ts`, `tests/fixtures/relevance/baseline.json`
   - Non-blocking: drift does not affect delivered behavior, code, or tests — narrative-only.

No Critical or Major drift found. No AC/D-decision was altered to manufacture the 96.4% number; the baseline-overwrite attempt was caught and reverted before this branch state, and is visible in git history (`0ab3056` revert, `e88a389` legitimate fix).

## 5. Edge-case / test outcomes

- Full suite executed live: `pnpm test` → **347/347 tests passing, 32 suites**, including `tests/relevance/replay.test.ts` and `tests/unit/lib/ranking.test.ts` (39 tests).
- Replay test genuinely exercises `candidates.json` through `rankResults`/`computeTop3HitRate`; not skipped, weakened, or tautological (asserts `>= baseline` per category and overall, plus an explicit "fails loudly on empty candidates" guard).

## 6. Recommendations

- `developer`: correct the stale `recency_half_life_days: 90` line in PR #67's "What" section to `365` (cosmetic, non-blocking).
- No `product-engineer` escalation required — no spec gap, no unintended behavioral change.
- Merge gate: no Critical/Major findings; safe to proceed per planner's merge-gate policy (drift is non-blocking).
