# Issue Refinement: 34 - feat: composite ranking score for search results

## Changelog

| Version | Date       | Summary            | Author           |
| ------- | ---------- | ------------------ | ---------------- |
| 1.0     | 2026-08-25 | Initial refinement | product-engineer |

## Summary

- **Goal:** Replace pure cosine-similarity ordering in `memo search` with a configurable composite score that blends semantic similarity, entry recency, and source reliability, so the most actionable and trustworthy decisions surface first.
- **Primary user impact:** AI agents consuming `memo search --json` receive results ordered by `final_score` with all component scores exposed for transparency. Human output shows the composite percentage instead of raw similarity.
- **Non-goals:**
  - Confidence tiers (`exact`/`high`/`medium`/`low`) — Story 2, issue #35.
  - Tag overlap boosting — Story 3, issue #36.
  - Staleness detection — Story 4, issue #38.
  - `memo ask` LLM re-ranking — Story 5, issue #37.
  - Re-ranking of `memo list` (chronological by design — unchanged).
  - Server-side/Qdrant-native scoring. Ranking is strictly post-retrieval, in-process.
  - Using the existing payload `confidence` field as a ranking signal.

## Resolved Decisions

These items were ambiguous in the original issue body and are now settled.

| #   | Question                            | Decision                                                                                                                                                                             |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Age reference field                 | Use **`timestamp_utc`** (ISO-8601 UTC string), confirmed present in stored payloads. The issue body's `created_at` does not exist in the schema and is a typo.                        |
| D2  | Over-fetch formula                  | `max(limit, min(limit * 3, 50))`. The outer `max` prevents under-fetching when `--limit > 50`.                                                                                        |
| D3  | Breaking-change posture             | Additive, minor version. `similarity` is **retained** alongside the new `final_score`; only the **ordering** and the human-output percentage change. No opt-out flag (YAGNI).         |
| D4  | Missing/unparseable `timestamp_utc` | `recency_score = 0`. The entry is still returned and still ranked — it is not dropped or errored.                                                                                     |
| D5  | Unknown `source` value              | Default to `0.5` (the lowest known tier). Missing `source` also maps to `0.5`. Never throw.                                                                                           |
| D6  | Human output position               | Unchanged layout (`repo  score  rationale`). Only the value changes from `similarity` to `final_score`. The issue's "prefix" wording is imprecise; position is after the repo label.  |
| D7  | Weight validation at search time    | **Fail fast.** Invalid `ranking` weights raise `CONFIG_INVALID` from `loadConfig`, so `memo search` errors rather than silently falling back to defaults. Enforced in the Zod schema. |
| D8  | Similarity clamping                 | Clamp `similarity` into `[0, 1]` before compositing. Cosine distance can theoretically return negative values, which would otherwise break the bounded-output guarantee.              |
| D9  | Recency semantics on update         | `timestamp_utc` is refreshed by the dedupe-update path, so recency reflects **last write**, not first creation. This is intended: a re-affirmed decision is legitimately fresher.      |

## Defects Found in the Original Issue

Two items in the issue body are incorrect as written and **MUST** be corrected during implementation.

### DEF-1 — Contradictory acceptance criterion (blocking)

The issue states:

> - [ ] All existing search tests pass without modification.

This is **unsatisfiable**. `tests/unit/commands/search.test.ts` currently asserts the exact Qdrant call limit:

```ts
expect(mockQdrant.search).toHaveBeenCalledWith(expect.any(Array), { ... }, 3);
```

With `--limit 3` and the over-fetch strategy, `search` will be invoked with `9`. The assertion must be updated.

**Correction:** restate the AC as _"All existing search tests pass, with modifications limited to the over-fetch limit assertion and result-ordering expectations. No existing test may be deleted or have its intent weakened."_

### DEF-2 — Incorrect test expectation for recency decay

The issue's test spec states:

> `✓ returns < 0.1 for entry older than 3x half_life`

At exactly 3× half-life (270 days), `recency_score = 0.125`, which is **not** `< 0.1`. The decay table:

| Age (days) | Multiple of half-life | `recency_score` |
| ---------- | --------------------- | --------------- |
| 0          | 0×                    | 1.0000          |
| 45         | 0.5×                  | 0.7071          |
| 90         | 1×                    | 0.5000          |
| 180        | 2×                    | 0.2500          |
| 270        | 3×                    | 0.1250          |
| 360        | 4×                    | 0.0625          |

**Correction:** assert `≈ 0.125` at 3× half-life, and use `< 0.1` only at **4× or more**.

## Acceptance Criteria

Ordering and scoring:

- [ ] **AC1** — Given stored entries, when `memo search` runs, then results are ordered by `final_score` descending, not by raw `similarity`.
- [ ] **AC2** — Given result A (`similarity 0.90`, 180 days old, `source: agent`) and result B (`similarity 0.82`, 5 days old, `source: agent`) under default config, then B outranks A. Verified: `final_score` A = `0.7150`, B = `0.8807`.
- [ ] **AC3** — Given two results with identical similarity and recency, when one has `source: scan` and the other `source: agent`, then the `agent` result scores exactly `0.05` higher under default weights.
- [ ] **AC4** — `final_score` is always within `[0, 1]` inclusive, including when Qdrant returns a negative similarity (see D8).

Output contract:

- [ ] **AC5** — `--json` output includes `final_score`, `similarity`, `recency_score`, and `source_score` on every result, in addition to all existing payload fields.
- [ ] **AC6** — Human output displays `final_score` as the percentage, in the existing position after the repo label.
- [ ] **AC7** — Existing `--json` response envelope keys (`query`, `filters`, `results`, `count`, `message`) are unchanged in name, type, and position.

Configuration:

- [ ] **AC8** — A `memo.config.json` containing a valid `ranking` block passes `memo setup validate` with exit code `0`.
- [ ] **AC9** — A `ranking` block whose weights do not sum to `1.0` (±0.001) fails `memo setup validate` with exit code `1` and an error message naming the offending field path and the actual sum.
- [ ] **AC10** — A config with no `ranking` block resolves all defaults (`0.6 / 0.3 / 0.1 / 90`) and produces no warning or error.
- [ ] **AC11** — A partial `ranking` block (e.g. only `w_similarity`) is rejected by weight-sum validation rather than silently mixing a partial override with defaults.
- [ ] **AC12** — `memo search` with structurally invalid `ranking` weights fails with `CONFIG_INVALID` (exit `1`), not a silent default fallback (see D7).

Retrieval:

- [ ] **AC13** — Qdrant is queried with `max(limit, min(limit * 3, 50))` candidates; the returned array is sliced to exactly `--limit` (or fewer if the corpus is smaller).
- [ ] **AC14** — Given `--limit 100`, then Qdrant is queried with `100`, never `50`.

Quality:

- [ ] **AC15** — All existing search tests pass, modified only per DEF-1.
- [ ] **AC16** — New unit tests cover `computeRecencyScore` at 0/45/90/180/360 days, `computeSourceScore` for all three sources plus unknown, `computeCompositeScore` with custom weights, and `rankResults` ordering plus empty input.
- [ ] **AC17** — Overall coverage stays ≥ 80%; `src/lib/` stays ≥ 85% per technical guidelines.
- [ ] **AC18** — `pnpm run lint`, `pnpm run format:check`, `pnpm run typecheck`, `pnpm test`, and `pnpm run audit` all pass.

## Constraints

- **Architecture:** `src/lib/ranking.ts` **MUST** be pure and side-effect free — no I/O, no clock reads inside the scoring functions. `now` **MUST** be an injected parameter (defaulting to `Date.now()`) so tests are deterministic without fake timers.
- **Repository boundary:** `QdrantRepository` **MUST NOT** know about ranking policy. The over-fetch limit is computed in `src/commands/search.ts` and passed as the existing `limit` argument. This avoids changing the `QdrantRepository.search` signature entirely.
- **Strict TypeScript:** `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are enabled. Conditional payload spreads must follow the existing `...(x ? { x } : {})` idiom.
- **No `console.log`:** all output goes through `src/lib/output.ts` (ESLint `no-console: error`).
- **Zod version:** schema must match the existing v3 style in `src/types/config.ts` (`.passthrough()`, `.superRefine()`, `.default()`).
- **Schema evolution:** the `ranking` block is additive and optional; v1 configs without it remain valid. No payload/collection schema change, therefore **no data migration** (see Migration Assessment).
- **Performance:** composite scoring is O(n) over at most 50 candidates — negligible. The `memo write` <3s and search <500ms targets are unaffected. No additional network round-trips.
- **Backward compatibility:** `similarity` retained in output; existing flags unchanged.

## Migration Assessment

**No migration artifact required — documented opt-out.**

Rationale: this change adds an optional block to the local `memo.config.json` file and introduces no change to the Qdrant `decisions` collection, its vector configuration, its payload indexes, or the `EntryPayload` schema. Recency is derived from `timestamp_utc`, which is already indexed as `datetime` and already present on stored entries. No backfill, reindex, or rewrite of existing points is needed. Configs lacking a `ranking` block continue to load unchanged (AC10).

## Risks and Edge Cases

| ID  | Risk / Edge case                                                                         | Mitigation                                                                                                |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| R1  | Recency weight buries a genuinely correct older decision                                 | Weights are configurable; `similarity` stays visible in output so agents can inspect the tradeoff.         |
| R2  | Over-fetch changes which candidates Qdrant returns, altering results even before scoring  | Documented as intended. Covered by AC13/AC14.                                                             |
| R3  | Floating-point weight sums (`0.6 + 0.3 + 0.1 !== 1.0` exactly in IEEE 754)                | Compare with ±0.001 tolerance, exactly as the issue specifies. Do not use `===`.                          |
| R4  | Future `timestamp_utc` (clock skew) yields `recency_score > 1`                            | Clamp negative age to `0`, so score clamps to `1.0`.                                                      |
| R5  | Malformed `timestamp_utc` string produces `NaN`, poisoning the sort                       | Guard with `Number.isFinite`; fall back to `recency_score = 0` per D4. Explicit test required.             |
| R6  | Negative cosine similarity breaks the `[0,1]` bound                                       | Clamp per D8. Explicit test required.                                                                     |
| R7  | Empty result set                                                                          | `rankResults([])` returns `[]`; existing empty-state output path must remain reachable (covered by test).  |
| R8  | Name collision between existing payload `confidence` and Story 2's `confidence_tier`       | Out of scope here, but the distinct field name is deliberate — flagged forward to #35.                     |
| R9  | Ties in `final_score` produce nondeterministic ordering across runs                        | Use a stable sort with a documented tiebreak: `final_score` desc, then `timestamp_utc` desc, then `id` asc. |
| R10 | Half-life of `0` or negative causes division by zero / `Infinity`                          | Zod constraint: `recency_half_life_days` must be a positive number (`.positive()`).                        |
| R11 | Weights individually outside `[0,1]` (e.g. `2.0` and `-1.0`) still sum to `1.0`            | Zod constraint: each weight `.min(0).max(1)` in addition to the sum check.                                 |

## Dependencies

- **Upstream:** none. This is the foundation story of the Ranking & Retrieval set.
- **Downstream (blocked by this issue):** #35 (confidence tiers), #38 (staleness detection), #37 (`memo ask`). All three consume `final_score`.
- **Parallel-safe:** #36 (tag overlap boosting) is independent but touches the same `src/lib/ranking.ts` file — expect a merge conflict if both are in flight. Sequencing #34 before #36 is recommended.
- **Source documents:** `workstream/user-stories-ranking-retrieval.md`, `workstream/tasks-ranking-retrieval-plan.md`.

## Definition of Done

- All ACs above verified.
- `ranking` block documented in `README.md` config reference with the default values and the weight-sum rule.
- Quality gates green: `test`, `lint`, `format:check`, `typecheck`, `audit`.
- Coverage thresholds held.
- PR opened against `main`, reviewed and approved by the user, then merged.

## Testing Notes

**Unit tests — `tests/unit/lib/ranking.test.ts` (new)**

- `computeRecencyScore`: day 0 → `1.0`; day 45 → `≈0.7071`; day 90 → `≈0.5`; day 180 → `≈0.25`; day 360 → `<0.1`; day 270 → `≈0.125` (per DEF-2); future timestamp → clamped `1.0`; missing → `0`; malformed → `0`.
- `computeSourceScore`: `agent` → `1.0`; `manual` → `0.8`; `scan` → `0.5`; unknown → `0.5`; undefined → `0.5`.
- `computeCompositeScore`: default weights; custom weights; bounded in `[0,1]`; negative similarity clamped.
- `rankResults`: descending order; the AC2 newer-beats-older scenario; documented tiebreak (R9); empty input → `[]`; single input.

**Unit tests — `tests/unit/lib/config.test.ts` (extend)**

- Valid `ranking` block loads with values preserved.
- Absent `ranking` block yields full defaults.
- Weights summing to `0.9` / `1.1` rejected with a path-qualified message.
- `recency_half_life_days: 0` and negative rejected (R10).
- Individual weight out of `[0,1]` rejected (R11).

**Unit tests — `tests/unit/commands/search.test.ts` (extend)**

- Qdrant called with the over-fetch limit: `--limit 3` → `9`; `--limit 20` → `50`; `--limit 100` → `100`.
- Results sliced to `--limit` after ranking.
- `--json` result objects carry all four score fields.
- Empty-result path still renders the existing empty-state message.

**Unit tests — `tests/unit/commands/setup.test.ts` (new or extend)**

- `memo setup validate` exit `0` on a valid `ranking` block.
- Exit `1` with descriptive error on an invalid weight sum.

**Manual verification**

```bash
pnpm build
memo search "auth roles" --limit 5            # human: composite %
memo search "auth roles" --limit 5 --json     # four score fields, descending final_score
memo setup validate                            # exit 0 with no ranking block
# then inject w_similarity: 0.5 and re-run:
memo setup validate; echo "exit=$?"           # exit 1, clear message
```

**Acceptance-criteria-to-test mapping**

| AC         | Validation                                                                       |
| ---------- | -------------------------------------------------------------------------------- |
| AC1        | `ranking.test.ts` → `rankResults` ordering; `search.test.ts` ordering             |
| AC2        | `ranking.test.ts` → newer-beats-older case                                       |
| AC3        | `ranking.test.ts` → `computeSourceScore` + composite delta                       |
| AC4        | `ranking.test.ts` → bounded output + negative-similarity clamp                   |
| AC5, AC7   | `search.test.ts` → `--json` shape assertions                                     |
| AC6        | `output.test.ts` → `searchResults` percentage source                              |
| AC8–AC11   | `config.test.ts` + `setup.test.ts`                                               |
| AC12       | `search.test.ts` → invalid-config propagation                                    |
| AC13, AC14 | `search.test.ts` → over-fetch limit assertions                                   |
| AC15       | full `pnpm test` run                                                             |
| AC16       | `ranking.test.ts` suite completeness                                             |
| AC17       | `pnpm run test:coverage`                                                          |
| AC18       | `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm run audit` |

## Open Questions

None blocking. Two items deferred by design:

- Should `confidence` (already on every payload) become a fourth ranking signal? Deferred — would require a fourth weight and re-balancing. Revisit after #35 lands.
- Should `recency_half_life_days` be overridable per-invocation via a CLI flag? Deferred as YAGNI; config-level control is sufficient for now.
