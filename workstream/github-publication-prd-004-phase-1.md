# GitHub Publication Report — PRD-004 Phase 1

## Target Repository

- **Repo:** `llipe/memo-cli`
- **Date:** 2026-09-19
- **Execution method:** `github-mcp`
- **Source:** `workstream/user-stories-prd-004-phase-1.md` v1.0

## Created Issues

| Story ID | Story Title                                        | Issue URL                                   | Labels                      | Milestone | Assignee |
| -------- | -------------------------------------------------- | ------------------------------------------- | --------------------------- | --------- | -------- |
| S1-01    | Relevance evaluation harness and recorded baseline | https://github.com/llipe/memo-cli/issues/61 | `story`, `retrieval`        | —         | —        |
| S1-06    | Lexical identifier matching in search              | https://github.com/llipe/memo-cli/issues/62 | `story`, `retrieval`, `cli` | —         | —        |
| S1-07    | `query_id` and `--explain` in search output        | https://github.com/llipe/memo-cli/issues/63 | `story`, `retrieval`, `cli` | —         | —        |
| S1-08    | Phase 1 exit gate — tune, measure, document        | https://github.com/llipe/memo-cli/issues/64 | `story`, `retrieval`        | —         | —        |

## Reused Issues

Four existing issues carry Phase 1 stories. Each received a `📌 Decision:` comment recording its Refined Scope rather than a rewritten body, so the original refinement text stays intact and auditable.

| Story ID | Issue                                              | Title                    | Comment                                                                           | Change to scope                                   |
| -------- | -------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| S1-02    | [#34](https://github.com/llipe/memo-cli/issues/34) | Composite ranking score  | [5743981026](https://github.com/llipe/memo-cli/issues/34#issuecomment-5743981026) | Reused as-is; three acceptance criteria added.    |
| S1-03    | [#36](https://github.com/llipe/memo-cli/issues/36) | Tag overlap boosting     | [5743981860](https://github.com/llipe/memo-cli/issues/36#issuecomment-5743981860) | Reused as-is; composes with a second boost.       |
| S1-04    | [#35](https://github.com/llipe/memo-cli/issues/35) | Dynamic confidence tiers | [5743982588](https://github.com/llipe/memo-cli/issues/35#issuecomment-5743982588) | Reused unchanged; removal boundary made explicit. |
| S1-05    | [#38](https://github.com/llipe/memo-cli/issues/38) | Staleness detection      | [5743983947](https://github.com/llipe/memo-cli/issues/38#issuecomment-5743983947) | **Corrected:** output field renamed `stale_by`.   |

## Deferred Issues

| Issue                                              | Title      | Comment                                                                           | Disposition                                                          |
| -------------------------------------------------- | ---------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [#37](https://github.com/llipe/memo-cli/issues/37) | `memo ask` | [5743985076](https://github.com/llipe/memo-cli/issues/37#issuecomment-5743985076) | Moved to PRD-004 Phase 5 (FR-5.2), optional. Left open, unscheduled. |

## Notes

- **No stories were skipped.** All eight Phase 1 stories are tracked: four new issues and four reused.
- **Milestones were not created.** The GitHub MCP server exposes no milestone tool, and the `gh` CLI is unavailable in this environment. **Manual follow-up:** create a `PRD-004 Phase 1` milestone and assign issues #61, #34, #36, #35, #38, #62, #63, #64 to it.
- **Assignees were not set.** No assignee was specified. Manual follow-up if the work is delegated.
- **Label `testing` does not exist** in this repository, so `story`, `retrieval`, and `cli` were used. Creating a `testing` label and applying it to #61 and #64 is optional follow-up.
- **Issue bodies of reused issues were not rewritten.** Refined Scope was delivered as a comment because those bodies carry a reviewed contract (notably #34's refinement, which remains binding in full). Rewriting them by machine would risk losing content for no tracking benefit.
- **Task checklists** from `workstream/tasks-prd-004-phase-1-plan.md` were posted as a comment on each of the eight issues.
- **Assisted-by value** to use on PR creation and issue closure during implementation: `Assisted-by: Claude Code (Opus 5)`.

## Source of Truth

GitHub is now the source of truth for Phase 1 execution status. The local task list at `workstream/tasks-prd-004-phase-1-plan.md` **MUST** be kept synchronized with the issue checklists as work proceeds.

## Traceability

| Story | Issue | Task in plan | Spec section    | PRD requirement        |
| ----- | ----- | ------------ | --------------- | ---------------------- |
| S1-01 | #61   | 1.0          | §14             | FR-1.1, AC-1.1         |
| S1-02 | #34   | 2.0          | §8.2            | FR-1.2, AC-1.2         |
| S1-03 | #36   | 3.0          | §8.2            | FR-1.2                 |
| S1-04 | #35   | 4.0          | §8.2            | FR-1.2                 |
| S1-05 | #38   | 5.0          | §8.2            | FR-1.2                 |
| S1-06 | #62   | 6.0          | §5.3, §8.2 (A4) | FR-1.3, AC-1.3         |
| S1-07 | #63   | 7.0          | §6.1, §6.2, §10 | FR-1.4, FR-1.5, AC-1.4 |
| S1-08 | #64   | 8.0          | §14, §15        | AC-1.5, AC-0.1, AC-0.2 |
