# GitHub Publication Report: PRD-001 MVP Core Loop

## Target Repository

- **Repo:** llipe/memo-cli
- **Date:** 2026-04-17
- **Milestone:** MVP — PRD-001 Core Loop (#1)

## Created Issues

| Story ID | Story Title                                                      | Issue URL                                   | Labels              | Milestone               |
| -------- | ---------------------------------------------------------------- | ------------------------------------------- | ------------------- | ----------------------- |
| S-001    | Project Setup & Development Environment                          | https://github.com/llipe/memo-cli/issues/1  | story, mvp, setup   | MVP — PRD-001 Core Loop |
| S-002    | `memo setup` — Repository Initialization and Config Management   | https://github.com/llipe/memo-cli/issues/2  | story, mvp          | MVP — PRD-001 Core Loop |
| S-003    | Foundation Libraries — Errors, Output, Qdrant, Embeddings        | https://github.com/llipe/memo-cli/issues/3  | story, mvp, infra   | MVP — PRD-001 Core Loop |
| S-004    | `memo write` — Decision Capture with Duplicate Detection         | https://github.com/llipe/memo-cli/issues/4  | story, mvp          | MVP — PRD-001 Core Loop |
| S-005    | `memo search` — Semantic Search with Pre-filters                 | https://github.com/llipe/memo-cli/issues/5  | story, mvp          | MVP — PRD-001 Core Loop |
| S-006    | `memo list` — Chronological Entry Listing                        | https://github.com/llipe/memo-cli/issues/6  | story, mvp          | MVP — PRD-001 Core Loop |
| S-007    | Bootstrap Prompt Documentation & Validation Workflow             | https://github.com/llipe/memo-cli/issues/7  | story, mvp          | MVP — PRD-001 Core Loop |
| S-008    | First Release — Package Build, Publish, and Install Verification | https://github.com/llipe/memo-cli/issues/8  | story, mvp, release | MVP — PRD-001 Core Loop |
| S-009    | Automated Registry Deployment Workflow (npm)                     | https://github.com/llipe/memo-cli/issues/21 | story, mvp, release | MVP — PRD-001 Core Loop |
| S-010    | `memo get` — Read a Specific Entry by ID                         | https://github.com/llipe/memo-cli/issues/32 | story, mvp          | MVP — PRD-001 Core Loop |

## Labels Created

| Label     | Color     | Description                 |
| --------- | --------- | --------------------------- |
| `story`   | `#0075ca` | User story                  |
| `mvp`     | `#e4e669` | MVP milestone scope         |
| `setup`   | `#5319e7` | Setup / scaffolding         |
| `infra`   | `#c5def5` | Infrastructure / foundation |
| `release` | `#f9d0c4` | Release / publish           |

## Dependency Order

```
S-001 (no deps)
├── S-002 (depends on #1)
└── S-003 (depends on #1)
    ├── S-004 (depends on #2, #3)
    │   ├── S-005 (depends on #3, #4)
    │   ├── S-006 (depends on #3, #4)
    │   └── S-007 (depends on #4)
    └── S-008 (depends on all prior stories)
```

## Notes

- Initial publication (S-001 to S-008) completed on 2026-04-10 under milestone **MVP — PRD-001 Core Loop** (#1)
- Sync update on 2026-04-17 created S-009: https://github.com/llipe/memo-cli/issues/21
- Sync update on 2026-04-18 created S-010: https://github.com/llipe/memo-cli/issues/32
- No stories skipped — full PRD-001 coverage (see coverage report in `user-stories-prd-001-mvp.md`)
- GitHub is now the source of truth for execution tracking
- Suggested next step: run the **plan** activity to create task lists from selected stories
