# Compliance Test Plan — Issue #90: Story S2-11 "Phase 2 exit gate — measure, document, release notes"

> Produced by **`verifier`** (Design Mode) on 2026-09-21. Pre-implementation. Black-box: all assertions derive from observable CLI/command behavior and artifact contents, not internal code structure. This is a **phase-level rollup gate**, not a new-feature story — it mostly re-verifies work already delivered by S2-01…S2-10, mirroring Phase 1's S1-08/#64 exit gate.

## Changelog

| Version | Date       | Summary           | Author   |
| ------- | ---------- | ----------------- | -------- |
| 1.0     | 2026-09-21 | Initial test plan | verifier |

## Source Input Summary

| Field               | Value                                                                                                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Repository**      | `llipe/memo-cli`                                                                                                                                                                                                                                                                                           |
| **GitHub Issue**    | [#90](https://github.com/llipe/memo-cli/issues/90)                                                                                                                                                                                                                                                         |
| **Input type**      | `story`                                                                                                                                                                                                                                                                                                    |
| **Source artifact** | `workstream/user-stories-prd-004-phase-2.md` § Story S2-11                                                                                                                                                                                                                                                 |
| **Supporting refs** | `workstream/specification-prd-004-long-lived-agent-memory.md` §14 (Testing Strategy), §15 (Deployment & Rollout); `docs/requirements/prd-004-long-lived-agent-memory.md` §7 R6, §13 AC-0.1/AC-0.2; precedent: `workstream/fidelity-report-prd-004-phase-1-rollup.md` (Phase 1 exit-gate rollup, S1-08/#64) |
| **Task list**       | `workstream/tasks-prd-004-phase-2-plan.md` task 11.0 (subtasks 11.1–11.21)                                                                                                                                                                                                                                 |
| **ACs extracted**   | 8 (AC1 … AC8)                                                                                                                                                                                                                                                                                              |
| **Traceability**    | `workstream/traceability-matrix-issue-90.md`                                                                                                                                                                                                                                                               |

Observable surfaces available to black-box testing:

1. `MEMO_COLLECTION=memo_eval pnpm run eval:relevance` — stdout (per-category + overall numbers).
2. `pnpm test` (`tests/relevance/replay.test.ts` specifically) — pass/fail, assertion output.
3. `pnpm run validate`, `pnpm run test:coverage` — exit codes, coverage report per-file thresholds.
4. `memo write|search|list|read|timeline|recall|bank list|bank show|migrate` against `memo_eval` — stdout (human), stdout (`--json`), stderr, exit code.
5. Documentation files (`README.md`, `docs/data-model.md`, `docs/system-overview.md`, `docs/technical-guidelines.md`, `/TESTING.md`, `.claude/skills/memo-cli-usage/*`) — content diff against shipped commands/flags/config keys/indexes.
6. `docs/adr/*` — new ADR file; a memo `kb` semantic entry referencing it.
7. `docs/requirements/prd-004-long-lived-agent-memory.md` — changelog row, §13 checkbox state.
8. `CHANGELOG.md`/release-notes file — 1.3.0 draft entry.
9. The PR body itself — AC-to-evidence mapping, drift sweep list.

This story is **not** black-box in the pure sense used for a fresh feature: because it verifies the combined output of ten prior stories, the test plan is deliberately weighted toward re-running the same observable commands those stories already exercised individually, at the merged-integration-branch scope, plus artifact/document inspection. No application code is expected to change as a result of this story (only docs, ADR, PRD, and release-notes files, per the Files to Create/Modify list).

---

## Pre-Design Findings

### F-1 — AC1's gate is asymmetric with the Phase 1 precedent, and that asymmetry is intentional (Informational)

Phase 1's AC-1.5 allowed "≥80% or ≥baseline+15, never below baseline." Phase 2's AC1 drops the OR-clause entirely: it is a **pure floor test** against the recorded 96.4% baseline, with no absolute-percentage alternative. This is consistent with PRD R6 ("a phase that lowers top-3 hit rate does not close") and with the Technical Notes' explicit tuning constraint (only the S1-02 sweep methodology on `recency_half_life_days` is allowed if AC1 fails; any weight change reopens PRD §8.2). Test design treats "96.4% floor, no OR-clause" as the literal contract — SC-1 and CT-1 assert `overall ≥ 96.4%` with no fallback branch.

### F-2 — "Un-migrated `memo_eval` must also pass" is an edge case with a subtle scope boundary (Design concern, flagged for `product-engineer`)

The story's own Edge-Case Matrix says: "eval on an un-migrated `memo_eval` (must also pass — v1 points still rank identically)." Read literally, this means: before running `memo migrate --to-v2` on `memo_eval` (or on a config left at `schema_version: '1'`), the **same eval fixture set** must still produce results that rank identically to the v2-migrated state, because Phase 2's read paths treat v1 payloads as defaulted-v2 via `normalizeEntry` (task 1.0) rather than requiring migration for search to function. This is a regression guard, not a claim that AC1's 96.4% number itself must be re-hit pre-migration (AC1's own text requires eval to run **after** `memo migrate --to-v2` on `memo_eval`). EC-1 in this plan tests the narrower, defensible claim: v1-shaped points rank identically under Phase 2 code with or without migration having run, using the replay fixtures (deterministic, no live Qdrant needed for the comparison). The live floor check (AC1) itself is only asserted post-migration, per the AC's literal text.

### F-3 — AC1's per-category breakdown format is not specified beyond "recorded" (Design concern)

Neither the story nor the spec pins down which categories must appear (Phase 1 used `concept`/`identifier`/`cross-repo`/`recency`). Phase 2 presumably inherits the same fixture categories since the eval set/harness is unchanged (spec §14 references the same `tests/fixtures/relevance/` mechanism), but if any Phase 2 story added new eval queries or categories, the per-category table in AC1's evidence must be complete for whatever set actually ran. Test design assumes the same four categories persist and flags a drift item if the live run reveals a changed category set.

---

## Acceptance Criteria Extraction

| ID   | Criterion (condensed)                                                                                                                                                                                               | Source AC |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| AC-1 | Live eval on migrated `memo_eval`, every Phase 2 feature in place, measures overall top-3 ≥ 96.4% floor; per-category numbers recorded in PRD changelog; below-floor blocks phase close (R6)                        | AC1       |
| AC-2 | `tests/relevance/replay.test.ts` passes unweakened, including the S2-05 AC-2.3 identity assertion                                                                                                                   | AC2       |
| AC-3 | `pnpm run validate` passes; `pnpm run test:coverage` recorded; `coverage_gate` recorded PASS/FAIL with numbers; `write.ts`/`setup.ts` no longer below threshold                                                     | AC3       |
| AC-4 | All six named docs/skill artifacts describe every Phase 2 command/flag/config-key/index/file; drift sweep lists each fixed gap in the PR                                                                            | AC4       |
| AC-5 | One ADR in `docs/adr/` for "one collection, `bank`+`kind` payload isolation" (A1/A2/A10), written by `technical-writer`; one memo `kb` semantic entry per ADR                                                       | AC5       |
| AC-6 | Manual smoke against `memo_eval`: write (3 kinds), search/list/read with/without new flags, timeline, recall (private + kb), bank list/show, migrate second-run `scanned: 0`; no regression in default human output | AC6       |
| AC-7 | PRD changelog row for Phase 2 exit; PRD §13 boxes AC-2.1…AC-2.9 ticked with proving story; release notes drafted for 1.3.0 with migration instruction (`--dry-run` first)                                           | AC7       |
| AC-8 | `verifier` audit (PRD-level rollup) requested; drift findings routed to `product-engineer`                                                                                                                          | AC8       |

**Non-goals** (must remain untouched — negative-space assertions): no new schema migration in this story (opt-out documented; `memo_eval` migration already exercised in S2-09); no new application code behavior change — this story only touches docs/ADR/PRD/release-notes/CHANGELOG; `memo restore --id` and `memo forget --bank --purge` stay out of scope (Phase 3); 1.3.0 tag/publish is a separate human-run step (`scripts/release.sh`), not part of this story's Definition of Done.

**Coverage note:** AC2, AC3, AC7, and AC8 are largely process/artifact criteria verified by command execution and file/diff inspection rather than interactive CLI scenarios. They receive E2E/contract coverage where an observable command exists (AC2, AC3) and are otherwise covered via the Execution Checklist and traceability matrix as process criteria, consistent with the AC-15…AC-18 treatment in the issue-34 precedent plan.

---

## E2E Black-Box Scenarios

Because this story's job is to re-verify prior stories' delivered behavior at merged scope, the "E2E scenarios" below constitute the **full manual smoke script** demanded by AC6, run end-to-end against `memo_eval` in one continuous session, plus the live-eval scenario for AC1.

### SC-1: Live relevance eval on migrated `memo_eval` meets the 96.4% floor

| Field               | Value                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-1                                                                                                                                                                                                                                              |
| **Type**            | happy-path                                                                                                                                                                                                                                        |
| **Severity**        | critical                                                                                                                                                                                                                                          |
| **Preconditions**   | `memo_eval` has been migrated to v2 (`memo migrate --to-v2` run to completion, verified `scanned: 0` on second run per SC-9). Every Phase 2 command/flag is merged and available.                                                                 |
| **Steps**           | 1. Run `MEMO_COLLECTION=memo_eval pnpm run eval:relevance`. 2. Capture per-category and overall numbers from stdout.                                                                                                                              |
| **Expected Result** | Overall top-3 hit rate ≥ 96.4%. Per-category numbers are present for every category in the fixture set (expected: `concept`, `identifier`, `cross-repo`, `recency`, matching Phase 1's categories unless a Phase 2 story added new eval queries). |
| **Pass Criteria**   | `overall ≥ 96.4` (no OR-clause fallback per **F-1**). All per-category numbers recorded verbatim in the PRD changelog row (AC-7 dependency). If below 96.4%, phase does not close (R6) — this is a **hard gate**, not advisory.                   |

### SC-2: `write` across all three kinds on `memo_eval`

| Field               | Value                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-6                                                                                                                                                                               |
| **Type**            | happy-path                                                                                                                                                                         |
| **Severity**        | critical                                                                                                                                                                           |
| **Preconditions**   | `memo_eval` migrated; `MEMO_COLLECTION=memo_eval` set for the session.                                                                                                             |
| **Steps**           | 1. `memo write --kind self "..."` (private bank). 2. `memo write --kind episodic --session <id> "..."`. 3. `memo write --kind semantic "..."` (kb, with provenance or `--manual`). |
| **Expected Result** | Each write succeeds with the expected default bank/kind resolution; no crash; each shows expected v2 payload fields on subsequent `read`.                                          |
| **Pass Criteria**   | Exit `0` for all three. `--kind self` in `kb` still fails per K1 (spot-checked as a negative sub-step). No soft-cap warning misfires below the 50-entry threshold.                 |

### SC-3: `search`/`list`/`read` with and without new flags

| Field               | Value                                                                                                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-6                                                                                                                                                                                                                                                                         |
| **Type**            | happy-path                                                                                                                                                                                                                                                                   |
| **Severity**        | critical                                                                                                                                                                                                                                                                     |
| **Preconditions**   | `memo_eval` populated from SC-2 and pre-existing eval fixtures.                                                                                                                                                                                                              |
| **Steps**           | 1. `memo search "<query>"` (defaults, no new flags). 2. `memo search "<query>" --bank private --kind episodic --include-superseded`. 3. `memo list` (defaults) and `memo list --bank kb --kind semantic`. 4. `memo read --id <id>` (default) and with `--as-of <timestamp>`. |
| **Expected Result** | Default-flag invocations produce output byte-identical in shape/ordering to pre-Phase-2 default behavior (AC-2.3 identity). New-flag invocations correctly filter/scope by bank/kind/session/include-flags/as-of.                                                            |
| **Pass Criteria**   | No regression in default human output (explicit AC6 requirement). New-flag paths return the expected filtered/scoped subset with no crash.                                                                                                                                   |

### SC-4: `timeline` ordering

| Field               | Value                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC-6                                                                                             |
| **Type**            | happy-path                                                                                       |
| **Severity**        | major                                                                                            |
| **Preconditions**   | At least 3 episodic entries with distinct `session_id`/`seq` values in `memo_eval`.              |
| **Steps**           | 1. `memo timeline --session <id>`.                                                               |
| **Expected Result** | Entries ordered per S2-06's documented ordering rule (chronological/`seq` order within session). |
| **Pass Criteria**   | Output order matches the documented contract; exit `0`.                                          |

### SC-5: `recall` for private and `kb` banks

| Field               | Value                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC-6                                                                                                                                                         |
| **Type**            | happy-path                                                                                                                                                   |
| **Severity**        | critical                                                                                                                                                     |
| **Preconditions**   | `memo_eval` has both a private bank and `kb` entries, including at least one `self` entry.                                                                   |
| **Steps**           | 1. `memo recall --bank <private-bank>`. 2. `memo recall --bank kb`.                                                                                          |
| **Expected Result** | SELF section complete for the private bank; sections trimmed/deduped/budgeted per S2-07's contract; `query_id` present; live latency < 4s (spec §14 metric). |
| **Pass Criteria**   | Both calls exit `0`, budget/caps respected, no counters written (Phase 3 non-goal), latency observed < 4s.                                                   |

### SC-6: `bank list`/`bank show`

| Field               | Value                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| **AC(s)**           | AC-6                                                                              |
| **Type**            | happy-path                                                                        |
| **Severity**        | major                                                                             |
| **Preconditions**   | At least two banks exist in `memo_eval` (kb + one private).                       |
| **Steps**           | 1. `memo bank list`. 2. `memo bank show <bank-id>`.                               |
| **Expected Result** | Both banks listed; `show` returns policy/counts consistent with S2-08's contract. |
| **Pass Criteria**   | Exit `0`; superseded entries correctly hidden per AC-2.8 where applicable.        |

### SC-7: `bank init` idempotency (regression spot-check)

| Field               | Value                                                                           |
| ------------------- | ------------------------------------------------------------------------------- |
| **AC(s)**           | AC-6                                                                            |
| **Type**            | happy-path                                                                      |
| **Severity**        | minor                                                                           |
| **Preconditions**   | Bank already initialized from SC-6.                                             |
| **Steps**           | 1. Re-run `memo bank init <same-bank>`.                                         |
| **Expected Result** | No duplicate bank record created; consistent with idempotent-init expectations. |
| **Pass Criteria**   | Exit `0`; `bank list` shows no duplicate.                                       |

### SC-8: `migrate --to-v2` second run reports `scanned: 0`

| Field               | Value                                                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-6, AC-1 (precondition)                                                                                                                                                                          |
| **Type**            | happy-path (idempotency)                                                                                                                                                                           |
| **Severity**        | critical                                                                                                                                                                                           |
| **Preconditions**   | `memo_eval` already migrated once (task 9.0's dry-run/real run, or fresh run per task 11.1).                                                                                                       |
| **Steps**           | 1. Run `memo migrate --to-v2` against `memo_eval` a second time.                                                                                                                                   |
| **Expected Result** | `scanned: 0` — no remaining v1-shaped points to migrate.                                                                                                                                           |
| **Pass Criteria**   | Output reports `scanned: 0`; exit `0`; this is the explicit precondition-verification step called out in the story ("11.1 Confirm `memo_eval` is fully migrated ... if not, run ... and confirm"). |

### SC-9: Default human output has no regression across the smoke session

| Field               | Value                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-6, AC-2                                                                                                                                                                              |
| **Type**            | negative-path (regression)                                                                                                                                                              |
| **Severity**        | critical                                                                                                                                                                                |
| **Preconditions**   | The full SC-2…SC-8 sequence has run.                                                                                                                                                    |
| **Steps**           | Compare default-flag human-readable output of `write`/`search`/`list`/`read`/`timeline` captured during the smoke against Phase 1's documented output shapes.                           |
| **Expected Result** | No unannounced format changes; identical layout/field order for default invocations, consistent with the AC-2.3 identity assertion carried into `tests/relevance/replay.test.ts` (AC2). |
| **Pass Criteria**   | Manual diff shows zero unexplained differences; any intentional difference is documented in the AC4 doc sweep.                                                                          |

---

## Contract Validation Scenarios

Contracts under test — this rollup's contract testing is narrower than a fresh-feature story because the contracts themselves were established by S2-01…S2-10; here the concern is that the **combined, merged** implementation still honors them and that the regression harness itself is trustworthy.

| Boundary                                                | Type            | Consumer                             | Provider                                            |
| ------------------------------------------------------- | --------------- | ------------------------------------ | --------------------------------------------------- |
| `tests/relevance/replay.test.ts` (deterministic replay) | schema-compat   | CI / `pnpm test`                     | `rankResults` + fixture corpus                      |
| `eval:relevance` live script output                     | provider-driven | `product-engineer`/tech lead (human) | eval harness                                        |
| `pnpm run validate` (aggregate quality gate)            | provider-driven | CI / developer                       | lint/format/typecheck/test/audit scripts            |
| `pnpm run test:coverage` report                         | provider-driven | `qa-engineer`/developer              | Jest coverage reporter, `jest.config.ts` thresholds |
| PRD §13 checklist state                                 | consumer-driven | `product-engineer`                   | PRD document                                        |

### CT-1: Replay test asserts the recorded baseline, unweakened

| Field               | Value                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-2                                                                                                                                                                                  |
| **Contract type**   | schema-compat                                                                                                                                                                         |
| **Boundary**        | `tests/relevance/replay.test.ts`                                                                                                                                                      |
| **Direction**       | response (assertion against recorded `candidates.json`/`baseline.json`)                                                                                                               |
| **Input**           | `pnpm test -- --testPathPattern="relevance"`                                                                                                                                          |
| **Expected Result** | Test passes; the recorded top-3 hit-rate assertion has **not** been loosened (e.g., threshold not lowered, category not silently dropped) relative to the Phase 1 baseline mechanism. |
| **Pass Criteria**   | Exit `0`. Diff of `replay.test.ts` against its pre-Phase-2 version shows only additive assertions (new AC-2.3 identity check), no threshold weakening, no deleted assertions.         |

### CT-2: AC-2.3 identity assertion present and passing

| Field               | Value                                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-2                                                                                                                                                                                         |
| **Contract type**   | schema-compat                                                                                                                                                                                |
| **Boundary**        | `tests/relevance/replay.test.ts`                                                                                                                                                             |
| **Direction**       | response                                                                                                                                                                                     |
| **Input**           | The S2-05 AC-2.3 identity assertion specifically (default-flag search results identical pre/post Phase 2 read-flag changes).                                                                 |
| **Expected Result** | Assertion exists in the test file and passes.                                                                                                                                                |
| **Pass Criteria**   | Grep/inspect `replay.test.ts` for the AC-2.3 case; confirm it runs and passes as part of the full-suite green run (not skipped, not `.only`'d elsewhere in a way that would hide a failure). |

### CT-3: Eval-harness regression contract — overall floor never regresses below 96.4%

| Field               | Value                                                                                                                                                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-1                                                                                                                                                                                                                                                                                                             |
| **Contract type**   | provider-driven                                                                                                                                                                                                                                                                                                  |
| **Boundary**        | `eval:relevance` live script output                                                                                                                                                                                                                                                                              |
| **Direction**       | response                                                                                                                                                                                                                                                                                                         |
| **Input**           | `MEMO_COLLECTION=memo_eval pnpm run eval:relevance` on the fully merged Phase 2 integration branch, post-migration.                                                                                                                                                                                              |
| **Expected Result** | `overall ≥ 96.4` exactly as recorded at Phase 1 exit — no silent baseline re-recording (`--record` flag) used to paper over a regression.                                                                                                                                                                        |
| **Pass Criteria**   | Numeric overall ≥ 96.4. The run command used is the plain (non-`--record`) invocation. If `--record` was used anywhere in this story's evidence trail, that is itself a drift flag (baseline should only move up, and only with an explicit, reasoned changelog entry — never as a way to launder a regression). |

### CT-4: `coverage_gate` reporting contract

| Field               | Value                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-3                                                                                                                                                                                                                                                          |
| **Contract type**   | provider-driven                                                                                                                                                                                                                                               |
| **Boundary**        | `pnpm run test:coverage` report + PR body's `coverage_gate` field                                                                                                                                                                                             |
| **Direction**       | response                                                                                                                                                                                                                                                      |
| **Input**           | `pnpm run test:coverage` on merged Phase 2 scope.                                                                                                                                                                                                             |
| **Expected Result** | `write.ts` and `setup.ts` per-file branch/function coverage at or above `jest.config.ts` thresholds (Phase 1 recorded them as debt). `coverage_gate` recorded as `PASS` or `FAIL(<reason>)` — never omitted, per AGENTS.md/CLAUDE.md's non-empty-reason rule. |
| **Pass Criteria**   | `write.ts`/`setup.ts` no longer flagged below threshold. `coverage_gate` field present with a value in `{PASS, FAIL(<reason>)}`; omission is treated as incomplete per CLAUDE.md.                                                                             |

### CT-5: PRD §13 checkbox contract — every AC-2.x ticked with a proving story cited

| Field               | Value                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-7                                                                                                                                                                 |
| **Contract type**   | consumer-driven                                                                                                                                                      |
| **Boundary**        | `docs/requirements/prd-004-long-lived-agent-memory.md` §13                                                                                                           |
| **Direction**       | request (this story writes the PRD)                                                                                                                                  |
| **Input**           | The PRD diff produced by this story.                                                                                                                                 |
| **Expected Result** | Every one of AC-2.1…AC-2.9 is ticked, each with the specific story ID that proved it (per the user-stories coverage table already mapping AC-2.1→S2-01/S2-04, etc.). |
| **Pass Criteria**   | No AC-2.x left unticked or ticked without a cited story. A new changelog row documents the Phase 2 exit with the 96.4%(or higher) figure.                            |

---

## Edge-Case Catalog

Per the assignment, weighted to the two edge cases the story explicitly calls out, plus process-level edge cases specific to a rollup gate. `activity-random-test-tactics` is **explicitly out of scope for this rollup layer — see the dedicated section below.**

### 1. Input Domain — N/A

No new user-facing input surface is introduced by this story (docs/ADR/PRD/release-notes only). Input-domain edge cases were the responsibility of S2-01…S2-10's own Design Mode plans.

### EC-1: Eval on an un-migrated `memo_eval` state must also pass (v1 points rank identically)

| Field               | Value                                                                                                                                                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-1 (regression guard, not the AC1 floor itself — see **F-2**)                                                                                                                                                                                                                                                                     |
| **Category**        | State Transitions, API Versioning                                                                                                                                                                                                                                                                                                   |
| **Input / Setup**   | The relevance replay fixture set with entries deliberately left in v1 payload shape (no `bank`/`kind`/v2 fields), run through Phase 2's `rankResults` via `normalizeEntry`'s v1-defaulting path.                                                                                                                                    |
| **Expected Result** | Rankings for these v1-shaped points are identical to their Phase 1 rankings — Phase 2's read-path changes must not silently alter scoring for entries that were never migrated.                                                                                                                                                     |
| **Risk if Missed**  | A user who delays running `memo migrate --to-v2` on their production `decisions` collection (explicitly a separate, human-run post-release step per this story's Migration Requirements) would see silently different search results before they choose to migrate — violating the additive-only compatibility promise in spec §15. |

### EC-2: A private bank's entries never leak into eval results

| Field               | Value                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-1, AC-6                                                                                                                                                                                                              |
| **Category**        | Auth & Permissions (bank isolation, B4 "no cross-bank search"), Data Boundaries                                                                                                                                         |
| **Input / Setup**   | Write at least one private-bank entry into `memo_eval` (as SC-2 already does) whose text would otherwise be a strong lexical/semantic match for one or more eval queries. Re-run the live eval.                         |
| **Expected Result** | The private-bank entry never appears among eval results and never contributes to (or inflates) the measured top-3 hit rate for any `kb`-scoped eval query.                                                              |
| **Risk if Missed**  | A leaked private entry could either falsely inflate the 96.4% figure (masking a real regression) or falsely appear as an unexpected/incorrect top-3 result, corrupting the phase-exit measurement that PRD R6 gates on. |

### EC-3: `memo migrate --to-v2` re-run on an already-migrated `memo_eval` is a true no-op

| Field               | Value                                                                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-6 (this is SC-8's underlying edge case, restated as a data-integrity check)                                                                                                                                                |
| **Category**        | Idempotency                                                                                                                                                                                                                   |
| **Input / Setup**   | Run `migrate --to-v2` on `memo_eval` a third time after SC-8's second confirming run.                                                                                                                                         |
| **Expected Result** | Still `scanned: 0`; no payload field is touched, timestamped, or re-written on points already at v2 (K5 — kind never changes in place, extended here to "already-migrated points are untouched on re-migration").             |
| **Risk if Missed**  | A migrate command that isn't truly idempotent could silently perturb `stability_since`-style anchors or timestamps on every CI run that happens to invoke it, corrupting downstream retention/staleness math in later phases. |

### 5. Failure Modes

### EC-4: AC1 failure path — the phase does not close, and only the sanctioned tuning knob is available

| Field               | Value                                                                                                                                                                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-1                                                                                                                                                                                                                                                                                                                              |
| **Category**        | Failure Modes                                                                                                                                                                                                                                                                                                                     |
| **Input / Setup**   | Hypothetical: live eval measures below 96.4%.                                                                                                                                                                                                                                                                                     |
| **Expected Result** | Per the story's Technical Notes, the **only** tuning allowed is re-running the S1-02 sweep methodology on `recency_half_life_days`; any weight change requires reopening PRD §8.2 with a new changelog row. The phase must not be marked closed.                                                                                  |
| **Pass Criteria**   | This is a process assertion verified by inspecting the actual PR/changelog trail if AC1 ever fails during execution — not independently testable pre-implementation beyond confirming the rule is stated correctly here. Flagged for `developer`/`product-engineer` awareness, not a pass/fail scenario in this design-time plan. |

### EC-5: `coverage_gate` recorded without a reason on `FAIL`

| Field               | Value                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC-3                                                                                                                                                   |
| **Category**        | Failure Modes                                                                                                                                          |
| **Input / Setup**   | Hypothetical: `test:coverage` fails to clear thresholds somewhere outside `write.ts`/`setup.ts`.                                                       |
| **Expected Result** | Per CLAUDE.md, `coverage_gate: FAIL` requires a non-empty reason; omitting the field is treated as incomplete, not `PASS`.                             |
| **Pass Criteria**   | The PR body's `coverage_gate` line is checked at audit time for `PASS` or `FAIL(<non-empty reason>)`; a bare `FAIL` or missing field fails this check. |

### 9. API Versioning

### EC-6: Doc/skill drift sweep catches a genuinely new command surface

| Field               | Value                                                                                                                                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC-4                                                                                                                                                                                                                                                                                                                           |
| **Category**        | API Versioning                                                                                                                                                                                                                                                                                                                 |
| **Input / Setup**   | Cross-reference every command/flag/config-key/index/file listed in the task-list "Relevant Files" section (timeline, recall, bank, migrate commands; `--bank/--kind/--session/--seq/--context/--provenance/--manual/--supersedes/--pin/--expires-in` flags; 12 new payload indexes) against the six named doc/skill artifacts. |
| **Expected Result** | Every item has a description in at least one of the six artifacts; any gap found is listed explicitly in the PR body's drift sweep, and the doc is fixed in the same PR (per AC-0.2 — docs ship in the same PR as the behavior they describe).                                                                                 |
| **Pass Criteria**   | Zero unlisted gaps at merge time. If a gap was found and fixed mid-story, the drift-sweep list in the PR still names it (transparency, not silent fixing).                                                                                                                                                                     |

### Categories declared N/A

- **Timing & Concurrency** — no new concurrent behavior introduced by this story.
- **Resource Exhaustion** — no new resource-bound operation introduced; the eval script's cost profile is unchanged from Phase 1.

---

## Randomized Tactics and Seed Policy

**`activity-random-test-tactics` does not add value at this rollup layer** — this story introduces no new application-code logic (only docs/ADR/PRD/release-notes changes) and no new input surface to fuzz; property-based/randomized testing belongs to the individual feature stories (S2-01…S2-10) that actually implemented the ranking, filtering, and migration logic under test, each of which received or should have received its own Design Mode plan with randomized tactics at implementation time.

---

## Execution Checklist

Pre-verification (confirm before running the gate):

- [ ] Confirm `memo_eval` migration state via SC-8 (`scanned: 0`); if not fully migrated, run `memo migrate --to-v2` against `memo_eval` and re-confirm (task 11.1).
- [ ] Confirm the Phase 2 integration branch is fully merged (all of S2-01…S2-10) before running any of the below — this rollup measures the combined result, not any single story.

During execution:

- [ ] SC-1 … SC-9 (manual smoke + live eval) pass; transcript captured for the PR (AC6 evidence).
- [ ] CT-1 … CT-5 pass.
- [ ] EC-1 … EC-6 pass; EC-4 and EC-5 are process assertions to be honored only if their triggering condition occurs.
- [ ] Doc/skill drift sweep (EC-6) complete; gaps listed and fixed in the PR.
- [ ] ADR written by `technical-writer`; one memo `kb` semantic entry created referencing it (AC5).
- [ ] PRD changelog row added; §13 AC-2.1…AC-2.9 boxes ticked with proving story cited (AC7, CT-5).
- [ ] Release notes drafted for 1.3.0 with the `--dry-run`-first migration instruction; `decisions` migration explicitly stated as a separate human step (AC7).

Quality gates (AC-2, AC-3):

- [ ] `pnpm test` — full suite green, including `tests/relevance/replay.test.ts` unweakened (CT-1, CT-2).
- [ ] `pnpm run validate` — passes.
- [ ] `pnpm run test:coverage` — recorded; `write.ts`/`setup.ts` at or above threshold; `coverage_gate: PASS | FAIL(<reason>)` recorded (CT-4, EC-5).
- [ ] `pnpm run lint`, `pnpm run format:check`, `pnpm run typecheck`, `pnpm audit`.

Rollup-specific gate (AC8):

- [ ] Request `verifier` PRD-level rollup audit (Audit Mode) after all of the above; route its drift findings to `product-engineer` via `activity-drift-reconciliation`.

Negative-space checks (non-goals stay untouched):

- [ ] No schema migration artifact produced by this story itself (opt-out documented; S2-09 already exercised the migration).
- [ ] No application-code behavior change attributable to this story alone — diff scope limited to docs/ADR/PRD/release-notes/CHANGELOG.
- [ ] 1.3.0 tag/publish not performed by this story — left as the explicit human-run `scripts/release.sh` step.
- [ ] `memo restore --id` and `memo forget --bank --purge` remain unimplemented (Phase 3 scope) — not accidentally exercised or claimed as working in the smoke transcript.

---

## Recommendations

| #   | Finding                                                                                 | Owner                          | Recommended action                                                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **F-2** — "un-migrated `memo_eval` must also pass" edge case has two plausible readings | `product-engineer`             | Confirm this plan's reading (v1-shaped points rank identically under Phase 2 code, independent of migration state) is the intended scope of the edge case, distinct from AC1's post-migration floor requirement. |
| 2   | **F-3** — per-category breakdown format/category set not pinned down beyond "recorded"  | `product-engineer`/`developer` | If Phase 2 added new eval queries/categories, confirm the AC1 evidence table reflects the actual current category set rather than assuming Phase 1's four categories carry over unchanged.                       |
| 3   | Randomized tactics explicitly opted out at this layer                                   | n/a                            | No action needed — recorded as a deliberate scope decision, not a gap; randomized coverage is owned by the individual Phase 2 feature stories.                                                                   |

---

## Output Contract

| Field                  | Value                                                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mode**               | Design                                                                                                                                                                                  |
| **Phase**              | 4 — Reporting & Publication (complete)                                                                                                                                                  |
| **Source artifact**    | `workstream/user-stories-prd-004-phase-2.md` § Story S2-11                                                                                                                              |
| **Artifacts produced** | `workstream/test-plan-issue-90.md`, `workstream/traceability-matrix-issue-90.md`                                                                                                        |
| **GitHub issue**       | [#90](https://github.com/llipe/memo-cli/issues/90)                                                                                                                                      |
| **AC coverage**        | 8/8 addressed. AC-1, AC-4, AC-5, AC-6 covered by E2E scenarios; AC-1 also by contract; AC-2, AC-3, AC-7 covered by contract + process; AC-8 by process checklist.                       |
| **Scenario counts**    | 9 E2E, 5 contract, 6 edge-case, 0 randomized (explicitly opted out — see rationale above)                                                                                               |
| **Blocking gaps**      | None for design. Two items flagged for `product-engineer` confirmation before execution: **F-2** (un-migrated-state edge-case scope) and **F-3** (per-category breakdown completeness). |
