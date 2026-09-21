# Traceability Matrix — Issue #84 (Story S2-05)

Maps every acceptance criterion to at least one positive test and one negative/edge test, per `verifier`'s Design Mode mandate. `Observed-Result` and `Pass/Fail/Drift` columns are left blank pending implementation and are filled in during the Audit Mode pass against this scope.

> Changelog: 2026-09-21 — initial matrix for issue #84 (verifier Design Mode).

| AC-ID | Description (short)                                                                          | Test-Case-ID(s) — positive                                                         | Test-Case-ID(s) — negative/edge                                                                            | Skill source                                                          | Observed-Result | Pass/Fail/Drift |
| ----- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------- | --------------- |
| AC1   | Shared flags accepted; invalid `--kind`/`--as-of` fail; `read` restricted to include-* flags | E2E-9 (`tags list --bank` valid combo), EC-9 (valid `--session`+`--kind semantic`) | E2E-8, EC-1, EC-2, EC-3, EC-11, EC-12                                                                      | e2e-test-design, edge-case-refinement                                 | (pending)       | (pending)       |
| AC2   | Identical default results to v1.2.0 (**PRD AC-2.3**, regression gate)                        | E2E-1, §7 replay identity extension (set + order identity)                         | §7 point 1 (false-exclusion check), §7 point 2 (false-inclusion check), EC-13 (idempotent repeat run)      | e2e-test-design, contract-test-design (envelope), §7 dedicated design | (pending)       | (pending)       |
| AC3   | Two-bank isolation (**PRD AC-2.4**)                                                          | E2E-2, E2E-3                                                                       | CT-4 (provider filter-shape contract), RT-1 (randomized bank×kind fuzz)                                    | e2e-test-design, contract-test-design, random-test-tactics            | (pending)       | (pending)       |
| AC4   | Shared base filter across dense/lexical/staleness; `fetchByRepo` removed                     | CT-3 (structural filter-shape equality)                                            | CT-3 (compile-time `fetchByRepo` absence + 0-call runtime assertion), EC-13                                | contract-test-design                                                  | (pending)       | (pending)       |
| AC5   | `--kind self` unranked, newest-first, no `final_score`                                       | E2E-4                                                                              | RT-2 (randomized self/non-self exclusion fuzz)                                                             | e2e-test-design, random-test-tactics                                  | (pending)       | (pending)       |
| AC6   | Archived/superseded prefixes (human) and flags (JSON)                                        | E2E-5 (inclusion + prefix + JSON flag)                                             | E2E-5 (active entry has neither prefix/flag), CT-1 (no unrelated key mutation)                             | e2e-test-design, contract-test-design                                 | (pending)       | (pending)       |
| AC7   | `--as-of` semantics; implies `--include-superseded`                                          | E2E-6, EC-7, EC-15                                                                 | EC-5, EC-6, EC-8 (exclusive `valid_to` boundary), EC-16, RT-3 (randomized boundary fuzz)                   | e2e-test-design, edge-case-refinement, random-test-tactics            | (pending)       | (pending)       |
| AC8   | v2 JSON fields added; envelope `filters` additive; no existing key changes                   | CT-1 (additive-diff contract), CT-2 (`filters` shape)                              | CT-1 (type/value stability of pre-existing keys)                                                           | contract-test-design                                                  | (pending)       | (pending)       |
| AC9   | `read --id` v2 fields, one `scroll({ has_id })` call, `(deleted)` markers                    | E2E-7                                                                              | EC-10 (v1 point normalization), EC-14 (large provenance array, still one call), CT-5 (call-shape contract) | e2e-test-design, edge-case-refinement, contract-test-design           | (pending)       | (pending)       |

## Coverage Confirmation

- Every AC (AC1–AC9) has ≥1 positive and ≥1 negative/edge test mapped above. Coverage status: **covered** (design-level; execution pending implementation).
- All four required skills were invoked: `activity-e2e-test-design` (§3), `activity-contract-test-design` (§4), `activity-edge-case-refinement` (§5), `activity-random-test-tactics` (§6).
- AC2 and AC3 received the explicit extra weight required by the invocation instructions: AC2 as a dedicated before/after identity design (§7, not a fresh test), AC3 with explicit e2e + contract dual coverage plus a randomized backstop (§8).
- No migration-apply tests were designed, per instruction (this story is read-only; migration is out of scope per the story's own Migration Requirements section).

## Cross-Reference to Existing Test Files

| Existing/planned file                            | ACs it will carry evidence for    |
| ------------------------------------------------ | --------------------------------- |
| `tests/unit/lib/read-flags.test.ts` (new)        | AC1                               |
| `tests/relevance/replay.test.ts` (extended)      | AC2                               |
| `tests/unit/commands/search.test.ts`             | AC3, AC4, AC5, AC7, AC8           |
| `tests/unit/commands/list.test.ts`               | AC7, AC8                          |
| `tests/unit/commands/tags.test.ts`               | AC1, AC8                          |
| `tests/unit/commands/read.test.ts`               | AC1, AC9                          |
| `tests/integration/commands/search.test.ts`      | AC3                               |
| `tests/integration/commands/read.test.ts`        | AC9                               |
| Manual `memo_eval` runs (tracked, not automated) | AC2, AC3, AC9 (live confirmation) |
