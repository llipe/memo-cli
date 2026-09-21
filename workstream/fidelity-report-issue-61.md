## verifier — Fidelity Audit (Audit Mode)

**Fidelity: High** | **Highest drift impact: None** (advisory-only Minor notes below) | Scope: Story S1-01, issue #61, PR #66, `issue/61-relevance-eval-harness` vs. `integration/prd-004-phase-1-trustworthy-retrieval`

### What changed and why (plain language)

This story built a tool that measures how good memo-cli's search is, using a fixed, known set of test data (44 memory entries, 28 queries) instead of trusting anecdotes. Round 1 recorded a placeholder score because real cloud credentials weren't available yet. Round 2 fixed a genuine bug in how the tool ran TypeScript (an incompatible interop check unrelated to credentials) and then recorded the real result against the live database: the tool finds the right memory in the top 3 results 92.9% of the time overall — perfectly for concept, identifier, and recency-based queries, and 66.7% for queries that span multiple repos (the known weak spot this whole PRD phase exists to fix). The evaluation tool cannot accidentally pollute production data: it refuses to run its seeding step unless pointed at a separate, clearly-named test collection.

### Per-AC result summary (AC1–AC9, task 1.0 / sub-tasks 1.1–1.26)

All 9 ACs: **Pass**. Verified directly:

- `tests/fixtures/relevance/baseline.json` recorded_at 2026-09-20T20:45:12Z, overall_top3 0.9286, by_category {concept 1, identifier 1, cross-repo 0.667, recency 1} — matches PRD changelog row 1.6 and PR claims exactly (not a placeholder).
- `pnpm test`: 31/31 suites, 275/275 tests pass, including `tests/relevance/replay.test.ts` (asserts against baseline, no network) and `tests/unit/scripts/eval-relevance.test.ts`.
- `pnpm run typecheck`: clean, zero errors.
- `pnpm run format:check`: fails repo-wide, but only on pre-existing files this PR never touched (agent/skill docs, DESIGN.md) — task 1.24's "unrelated drift" claim confirmed accurate.
- `MEMO_COLLECTION` guard (exit 1 on unset/empty for `--seed`) and `QDRANT_UNREACHABLE` exit-2 path both present in `scripts/eval-relevance.ts` and documented in README, matching AC7/AC9 intent.
- Task checklist 1.1–1.24 all checked; 1.25 (this audit) and 1.26 (merge) correctly left open pending this report and user merge approval.

### `TS_NODE_TRANSPILE_ONLY` workaround — scrutinized, found sound

- Scope: only `eval:relevance` npm script (`package.json` line 41); no other script or config sets it.
- `pnpm run typecheck` (`tsc --noEmit` against `tsconfig.json`, `include: ["src/**/*"]`) never included `scripts/**` in the first place — this workaround changes nothing about `src/**`'s type-checking, which remains full and unaffected.
- `scripts/eval-relevance.ts` itself is not left type-check-free in practice: `tests/unit/scripts/eval-relevance.test.ts` imports its named exports directly, and Jest's `ts-jest` transform (no `isolatedModules` set) type-checks on every test run. So type safety for the script is provided by the test suite rather than by `tsc --noEmit`, but it is provided.

### Drift catalog

| #   | Item                                                                                                                                                                                                                      | Impact | Intent                                                           | Note                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `scripts/` directory has never been in `tsconfig.json`'s `include`, independent of this PR                                                                                                                                | Minor  | Unintended (pre-existing)                                        | Not introduced by this story; the PR's commit message slightly overstates the fix's precision by implying typecheck coverage was the boundary at risk, when in fact `scripts/` was already outside it. No functional effect. |
| 2   | Traceability matrix (`workstream/traceability-matrix-issue-61.md`) still shows `_pending_` for all Observed-Result cells                                                                                                  | Minor  | Intended (design-time artifact, not updated post-implementation) | Non-blocking; this audit supplies the missing evidence.                                                                                                                                                                      |
| 3   | Live-Qdrant claims (zero overlap with `decisions`, exactly 44 points in `memo_eval` after two `--seed` runs) are self-reported in commit/PRD text, not independently reproducible from this sandbox (no credentials here) | Minor  | Undetermined                                                     | Recommend spot-check by a maintainer with live credentials before/soon after merge; not a merge blocker per policy.                                                                                                          |

All items are non-blocking to this merge gate.

### Recommendations

1. No action needed for AC1–AC9 — implementation, tests, and docs are faithful to spec intent.
2. Optional (`developer`, low priority): note in a future PR that `scripts/**` is intentionally outside `tsc --noEmit`'s `include` and is covered instead via `ts-jest` in its test file, so this isn't re-litigated as a gap later.
3. Optional (maintainer with live credentials): spot-check the `decisions`/`memo_eval` isolation claim once, opportunistically.

— `verifier`, Audit Mode
