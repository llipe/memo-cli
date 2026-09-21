# GitHub Publication Report — PRD-004 Phase 2

## Target Repository

- **Repo:** `llipe/memo-cli`
- **Date:** 2026-09-21
- **Execution method:** `gh-cli`
- **Source:** `workstream/user-stories-prd-004-phase-2.md` v1.0
- **Milestone:** [`PRD-004 Phase 2`](https://github.com/llipe/memo-cli/milestone/3)

## Created Issues

| Story ID | Story Title                                                                   | Issue URL                                   | Labels                                   | Milestone       | Assignee |
| -------- | ----------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------- | --------------- | -------- |
| S2-02    | `QdrantRepository` extensions and v2 payload indexes                          | https://github.com/llipe/memo-cli/issues/81 | `story`, `memory-model`, `schema`        | PRD-004 Phase 2 | —        |
| S2-03    | Bank resolution, base filter, and dedupe v2                                   | https://github.com/llipe/memo-cli/issues/82 | `story`, `memory-model`                  | PRD-004 Phase 2 | —        |
| S2-04    | `memo write` v2 — banks, kinds, sessions, supersede                           | https://github.com/llipe/memo-cli/issues/83 | `story`, `memory-model`, `schema`, `cli` | PRD-004 Phase 2 | —        |
| S2-05    | Read-side flags on `search`, `list`, `tags`, `read`, and bank-aware staleness | https://github.com/llipe/memo-cli/issues/84 | `story`, `memory-model`, `cli`           | PRD-004 Phase 2 | —        |
| S2-06    | `memo timeline`                                                               | https://github.com/llipe/memo-cli/issues/85 | `story`, `memory-model`, `cli`           | PRD-004 Phase 2 | —        |
| S2-07    | `memo recall`                                                                 | https://github.com/llipe/memo-cli/issues/86 | `story`, `memory-model`, `cli`           | PRD-004 Phase 2 | —        |
| S2-08    | `memo bank init\|list\|show` and `inspect` banks facet                        | https://github.com/llipe/memo-cli/issues/87 | `story`, `memory-model`, `cli`           | PRD-004 Phase 2 | —        |
| S2-09    | `memo migrate --to-v2`                                                        | https://github.com/llipe/memo-cli/issues/88 | `story`, `memory-model`, `schema`, `cli` | PRD-004 Phase 2 | —        |
| S2-10    | dev-tasks consumer — `MEMO_BANK`, `memo recall`, episodic writes              | https://github.com/llipe/memo-cli/issues/89 | `story`, `memory-model`, `cli`           | PRD-004 Phase 2 | —        |
| S2-11    | Phase 2 exit gate — measure, document, release notes                          | https://github.com/llipe/memo-cli/issues/90 | `story`, `memory-model`                  | PRD-004 Phase 2 | —        |

## Reused Issues

One existing issue carries a Phase 2 story. It received a `📌 Decision:` comment recording its Refined Scope rather than a rewritten body, following the Phase 1 precedent on #34/#36/#35/#38 — the original refinement text stays intact and auditable.

| Story ID | Issue                                              | Title                                        | Comment                                                                           | Change to scope                                                                                                                                                                  |
| -------- | -------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S2-01    | [#53](https://github.com/llipe/memo-cli/issues/53) | Separate episodic and semantic memory stores | [5765826574](https://github.com/llipe/memo-cli/issues/53#issuecomment-5765826574) | **Reconciled.** One collection with a `kind` field (`self \| episodic \| semantic`) per PRD-004 §2.5, not separate stores; scope now points at spec §18.1–§18.3 and story S2-01. |

## Deferred / Untouched Issues

| Issue                                              | Title                            | Disposition                                                          |
| -------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------- |
| [#54](https://github.com/llipe/memo-cli/issues/54) | Stability-based decay            | Phase 3 (FR-3.2/3.3). Left untouched — no comment posted this round. |
| [#55](https://github.com/llipe/memo-cli/issues/55) | Track retrieval vs. actual use   | Phase 3 (FR-3.1). Left untouched.                                    |
| [#56](https://github.com/llipe/memo-cli/issues/56) | Link-aware relevance             | Phase 5 (FR-5.1). Left untouched.                                    |
| [#57](https://github.com/llipe/memo-cli/issues/57) | Consolidation job                | Phase 4 (FR-4.1–4.5). Left untouched.                                |
| [#58](https://github.com/llipe/memo-cli/issues/58) | Event-sourced storage (optional) | Phase 5, optional (FR-5.3). Left untouched.                          |

## Notes

- **No stories were skipped.** All 11 Phase 2 stories are tracked: 10 new issues and 1 reused.
- **Milestone created via `gh` CLI** (`gh-cli` was available this round, unlike the Phase 1 publication which had no MCP milestone tool and no `gh` access) — `PRD-004 Phase 2` (#3), all 11 issues assigned to it.
- **Assignees were not set.** No assignee was specified. Manual follow-up if the work is delegated.
- **`docs` label does not exist** in this repository; the closest existing label is `documentation`, which was intentionally **not** applied since it's scoped to end-user/API docs in prior usage, not story tracking. S2-10 and S2-11 (the two heaviest documentation-scope stories) carry `story`/`memory-model` only. Optional follow-up: apply `documentation` to #89 and #90 if the team wants doc-heavy stories filterable that way.
- **S2-01 (#53) also received the `schema` label**, since config/payload schema v2 (spec §18.2–§18.3) is squarely in scope for that story, beyond the label set already on the issue.
- **S2-10 spans two repositories** (`llipe/memo-cli` and `llipe/dev-tasks`) per the RF-63 cross-repo partition in the spec (§18.12). Per this PRD's existing tracking convention (all PRD-004 issues live in `memo-cli`), it is filed as a single issue in `memo-cli` (#89), with the story body's explicit repo-scoping language (which files live in which repo, one PR per repository) preserved verbatim in the issue.
- **Issue body of the reused issue (#53) was not rewritten.** Refined Scope was delivered as a comment so the original issue content stays intact.
- **Assisted-by value** to use on PR creation and issue closure during implementation: `Assisted-by: Claude Code (Sonnet 5)`.

## Source of Truth

GitHub is now the source of truth for Phase 2 execution status. Once a task list is generated (`activity-plan` / `/planner`), it **MUST** be kept synchronized with these issue checklists as work proceeds.

## Traceability

| Story | Issue | Spec section | PRD requirement                        |
| ----- | ----- | ------------ | -------------------------------------- |
| S2-01 | #53   | §18.1–§18.3  | FR-2.1, AC-2.1 (schema half)           |
| S2-02 | #81   | §18.4        | FR-2.1 (indexes)                       |
| S2-03 | #82   | §18.5        | FR-2.3, AC-2.4 (filter half)           |
| S2-04 | #83   | §18.6        | FR-2.2, FR-2.3, AC-2.1, AC-2.2, AC-2.8 |
| S2-05 | #84   | §18.7        | FR-2.4, FR-2.9, AC-2.3, AC-2.4         |
| S2-06 | #85   | §18.8        | FR-2.5, AC-2.5                         |
| S2-07 | #86   | §18.9        | FR-2.6, AC-2.6                         |
| S2-08 | #87   | §18.10       | FR-2.7                                 |
| S2-09 | #88   | §18.11       | FR-2.8, AC-2.7                         |
| S2-10 | #89   | §18.12       | FR-2.10, AC-2.9                        |
| S2-11 | #90   | §14, §15     | AC-0.1, AC-0.2                         |
