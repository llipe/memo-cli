# Traceability Matrix — Issue #89 (Story S2-10)

**Mode:** Design Mode (verifier)
**Companion artifact:** `/workstream/test-plan-issue-89.md`

**Document changelog:**

| Date       | Change                    | Author   |
| ---------- | ------------------------- | -------- |
| 2026-09-21 | Initial traceability map. | verifier |

Legend for **Status**: `ready` = test scenario fully specified and executable once the 1.3.0 build exists; `blocked (dependency)` = cannot execute until S2-04/S2-07 merge (confirmed during intake: checked-out build is `memo --version` 1.2.0, `recall`/`timeline`/`bank`/`migrate` absent from `--help`).

| AC-ID | Description                                                                                                                                           | Positive test                                                                                          | Negative/edge test                                                                                                                                                            | Status                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| AC1   | Bank id `<agent>-memory` declared + exported per long-lived agent                                                                                     | E2E-1 (session start uses `$MEMO_BANK=developer-memory` successfully)                                  | Doc review: confirm `planner`, `product-engineer`, `technical-writer` definitions each declare their own `<agent>-memory` id (no shared/default id copy-pasted across agents) | blocked (dependency) for E2E-1's live half; doc-review half is `ready` once prompts are drafted |
| AC2   | Single `memo recall … --json` replaces four-command sequence; old sequence documented as `< 1.3.0` fallback                                           | E2E-1 (CV-1 for syntax)                                                                                | Edge case: memo-cli 1.2.x installed → fallback sequence used (§4 row 2)                                                                                                       | blocked (dependency)                                                                            |
| AC3   | Episodic writes `--kind episodic --session ISSUE-<n> --bank $MEMO_BANK`; ADR/decision writes `--kind semantic` in `kb` with `--provenance`/`--manual` | E2E-2 (episodic writes + timeline), E2E-3 (semantic ADR write in `kb`)                                 | Edge case: `kb` never receives an episodic entry (verified via `memo search --bank kb` in E2E-2); boundary case of implicit `--seq` auto-increment (§4 row 6)                 | blocked (dependency)                                                                            |
| AC4   | Session close documented as Phase-2 no-op                                                                                                             | E2E-4 (doc-read assertion)                                                                             | N/A — no failure mode for a documentation-only no-op statement                                                                                                                | ready (pure doc review, no CLI dependency)                                                      |
| AC5   | Skill docs cover banks/kinds/recall/timeline/bank/migrate/read-side flags/migration guidance; every example valid against 1.3.0 `--help`              | CV-1 through CV-8                                                                                      | Edge case: any doc example using a flag/value not present in `--help` output is a fail (caught by CV table diff)                                                              | blocked (dependency)                                                                            |
| AC6   | This repo's `.claude/skills/memo-cli-usage/` byte-identical to dev-tasks copy                                                                         | `diff -r .claude/skills/memo-cli-usage <dev-tasks>/.claude/skills/memo-cli-usage` (task 10.13/10.7)    | Negative: any non-empty diff output is a fail, including trailing-whitespace/line-ending drift                                                                                | ready (does not require the 1.3.0 build — only requires both repos' files to exist post-edit)   |
| AC7   | "Installed but unconfigured" / "not installed" behaviors unchanged                                                                                    | Doc diff review: confirm those two paragraphs are untouched (or semantically identical) in the PR diff | Edge case: not-installed path (§4 row 4) and installed-but-unconfigured path (§4 row 5) — re-read post-change text and confirm no behavioral wording changed                  | ready (diff review only, no CLI dependency)                                                     |

## Coverage Summary

- **7/7 ACs** have at least one positive and one negative/edge test mapped.
- **4/7 ACs (AC2, AC3, AC5, and the live half of AC1)** are `blocked (dependency)` pending S2-04/S2-07 merge and a local 1.3.0 build — this is a scheduling blocker, not a test-design gap; the scenarios are fully specified in `/workstream/test-plan-issue-89.md` and ready to execute the moment the dependency clears.
- **3/7 rows (AC4, AC6, AC7)** are executable today via documentation/diff review alone.
- Randomized tactics: explicitly opted out (see test plan §5) — no AC in this story maps to a property/fuzz scenario.
- Migration: explicitly opted out (see test plan §6) — no AC in this story requires a migration artifact.

## Blocking Note for `verifier` Audit Mode (future invocation)

When Audit Mode runs post-implementation for this issue, it MUST re-verify the build version first (`memo --version`) before treating any `blocked (dependency)` row above as pass/fail — do not report a false pass by testing against a 1.2.0 build that happens to accept superficially similar flags.
