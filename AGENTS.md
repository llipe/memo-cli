# AGENTS.md — Agent & Instruction Registry

> Single source of truth for all agent customizations and activity-based instructions in the memo-cli project.

---

## Activity-Based Instructions

Activities define structured workflows that agents follow. Each instruction file applies globally (`applyTo: "**"`).

| Activity             | File                                                    | Purpose                                                                              |
| -------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **init**             | `.github/instructions/init.instructions.md`             | Initialize project foundation docs (`product-context.md`, `technical-guidelines.md`) |
| **refine**           | `.github/instructions/refine.instructions.md`           | Refine scope — issue refinement (lightweight) or PRD creation (full)                 |
| **generate-spec**    | `.github/instructions/generate-spec.instructions.md`    | Generate technical specification from PRD + technical guidelines                     |
| **generate-stories** | `.github/instructions/generate-stories.instructions.md` | Generate user stories from specification with coverage validation                    |
| **publish-github**   | `.github/instructions/publish-github.instructions.md`   | Publish user stories as GitHub Issues                                                |
| **plan**             | `.github/instructions/plan.instructions.md`             | Convert stories/issues into execution-ready task lists                               |
| **implement**        | `.github/instructions/implement.instructions.md`        | Step-by-step task execution with branching, PRs, and approval gates                  |

---

## Agents

| Agent                | File                                       | Purpose                                                                                                                     |
| -------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| **developer**        | `.github/agents/developer.agent.md`        | Unified implementation agent — handles single GitHub Issues and full PRD-driven feature delivery with step-gated execution  |
| **github-ops**       | `.github/agents/github-ops.agent.md`       | GitHub consistency and organization — standardizes issues, PRs, branches, labels, milestones, and comments                  |
| **planner**          | `.github/agents/planner.agent.md`          | Orchestration agent for multi-story execution from `/workstream` or milestone, with dependency-ordered sequential execution |
| **technical-writer** | `.github/agents/technical-writer.agent.md` | Autonomous documentation maintenance — keeps system and end-user documentation current and accurate                         |
| **housekeeping**     | `.github/agents/housekeeping.agent.md`     | Fixes lint errors, type errors, and broken test wiring without changing business logic                                      |

---

## Workflow Chains

### Full Feature Delivery (PRD → Production)

```
init → refine (PRD mode) → generate-spec → generate-stories → publish-github → plan → implement
```

### Single Issue Fix

```
refine (issue mode) → plan → implement
```

### Documentation Update

```
technical-writer (autonomous scan of /workstream and code changes)
```

---

## General Agent Guidelines

- All agents follow RFC 2119 keyword conventions.
- GitHub is the source of truth for execution status (issues, PRs, checklists).
- Agents delegate GitHub operations to `github-ops` whenever possible.
- Implementation follows step-gated execution: one sub-task at a time, with user approval.
- Documentation updates are triggered after every feature or milestone completion.
- All workstream artifacts live in `/workstream/`.
- Foundation docs live in `/docs/`.
