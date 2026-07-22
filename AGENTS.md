# AGENTS.md — Agent, Skill, Instruction, and Prompt Registry

Single source of truth for AI workflow primitives in this repository.

## Core Idea

This project uses structured AI-assisted delivery with clear handoffs:

- Scope and requirements are refined before coding.
- Work is converted into execution-ready tasks.
- Implementation runs one sub-task at a time with approval checkpoints.
- GitHub issues, branches, PRs, and checklists are the execution source of truth.
- Documentation and workflow artifacts remain synchronized in `/workstream` and `/docs`.

---

## Taxonomy: Agent vs Skill vs Instruction vs Prompt

| Concept | Purpose | Loaded When | Decision Rule |
| --- | --- | --- | --- |
| Agent | Autonomous role with ownership, workflow phases, and handoffs. | Invoked by name (`@agent`) | Use when a capability needs decision-making across multiple steps. |
| Skill | Reusable, on-demand procedure invoked by agents/prompts. | Loaded only when invoked | Use when a capability is optional and should not always consume context. |
| Instruction | Always-applied policy scoped with `applyTo`. | Auto-applied by runtime | Use when a rule must always be enforced in matching contexts. |
| Prompt | Entry point that configures an agent for a specific use case. | Invoked by prompt name | Use when you want consistent startup context for a recurring workflow. |

Key distinctions:

- Agent files define who owns a workflow.
- Skill files define how optional procedures are executed.
- Instruction files enforce non-optional, cross-cutting behavior.
- Prompt files provide standardized entry points for user intent.

---

## Agents

All custom agents are in `.github/agents/`.

| Agent | File | Purpose |
| --- | --- | --- |
| product-engineer | `.github/agents/product-engineer.agent.md` | Preparation agent for refinement, PRD/spec/story generation, and planning handoff. |
| developer | `.github/agents/developer.agent.md` | Execution agent for implementing from an existing task list with step-gated approval. |
| planner | `.github/agents/planner.agent.md` | Multi-story orchestrator with dependency-ordered execution and checkpoint/resume behavior. |
| github-ops | `.github/agents/github-ops.agent.md` | GitHub consistency operations for issues, branch naming, PRs, labels, milestones, and comments. |
| technical-writer | `.github/agents/technical-writer.agent.md` | Documentation maintenance and consistency after feature delivery. |
| housekeeping | `.github/agents/housekeeping.agent.md` | Lint/type/test wiring remediation without business-logic changes. |
| ux-engineer | `.github/agents/ux-engineer.agent.md` | UX mockups and gap analysis from requirements/specs. |

---

## Skills

Skills are in `.github/skills/` and are loaded only on demand.

### Activity Skills

| Skill | Directory | Purpose | Primary Consumer |
| --- | --- | --- | --- |
| activity-init | `.github/skills/activity-init/` | Establish product context and technical guidelines. | product-engineer |
| activity-refine | `.github/skills/activity-refine/` | Clarify scope in issue mode or PRD mode. | product-engineer |
| activity-generate-spec | `.github/skills/activity-generate-spec/` | Transform PRD into technical specification. | product-engineer |
| activity-generate-stories | `.github/skills/activity-generate-stories/` | Convert spec into user stories with coverage checks. | product-engineer |
| activity-publish-github | `.github/skills/activity-publish-github/` | Publish stories as GitHub issues with consistent structure. | product-engineer |

### Operational Skills

| Skill | Directory | Purpose | Primary Consumer |
| --- | --- | --- | --- |
| git-ops | `.github/skills/git-ops/` | Branch creation, sync/rebase workflow, merge/conflict handling, and recovery. | developer, planner |
| memo-cli-usage | `.github/skills/memo-cli-usage/` | Agent guidance for memo-cli operations: command reference, workflows, memory scopes, and safe-operation guardrails. | Any agent |
| webapp-mockup | `.github/skills/webapp-mockup/` | Build mockups for UX validation loops. | ux-engineer |

---

## Instructions (Always-Loaded)

Instructions are in `.github/instructions/` and applied via `applyTo`.

| Instruction | File | Scope | Purpose |
| --- | --- | --- | --- |
| plan | `.github/instructions/plan.instructions.md` | `**` | Convert selected stories or refined issues into execution-ready task lists. |
| implement | `.github/instructions/implement.instructions.md` | `**` | Execute task lists with strict sequencing, PR workflow, and approval gates. |
| nextjs-pages-components | `.github/instructions/domain/nextjs-pages-components.instructions.md` | `apps/management-hub/src/**/*.tsx` | Next.js/React conventions for the management-hub domain. |

---

## Prompts

Prompts are in `.github/prompts/` and act as reusable agent entry points.

| Prompt | File | Agent | Purpose |
| --- | --- | --- | --- |
| product-engineer-init | `.github/prompts/product-engineer-init.prompt.md` | product-engineer | Initialize product foundation documents and baseline constraints. |
| product-engineer-feature | `.github/prompts/product-engineer-feature.prompt.md` | product-engineer | Drive full feature preparation from scope to plan. |
| product-engineer-issue | `.github/prompts/product-engineer-issue.prompt.md` | product-engineer | Refine and plan a single GitHub issue. |
| developer-execute | `.github/prompts/developer-execute.prompt.md` | developer | Execute an existing task list with sub-task approval gating. |
| planner | `.github/prompts/planner.prompt.md` | planner | Start dependency-ordered, multi-story orchestration. |
| planner-resume | `.github/prompts/planner-resume.prompt.md` | planner | Resume interrupted orchestration from a checkpoint. |
| github-ops | `.github/prompts/github-ops.prompt.md` | github-ops | Run GitHub consistency operations. |
| technical-writer | `.github/prompts/technical-writer.prompt.md` | technical-writer | Update architecture and user-facing documentation. |
| housekeeping | `.github/prompts/housekeeping.prompt.md` | housekeeping | Repair lint/type/test wiring issues quickly and safely. |
| ux-engineer | `.github/prompts/ux-engineer.prompt.md` | ux-engineer | Generate UX mockups and capture UX gaps/questions. |

---

## Workflow Chains

### Full Feature (PRD-Driven)

```
product-engineer: refine -> generate-spec -> generate-stories -> publish-github -> plan
																			  |
																			  v
developer: implement
```

### Single GitHub Issue

```
product-engineer: refine -> plan
							|
							v
developer: implement
```

### Multi-Story Orchestration

```
product-engineer: refine -> generate-spec -> generate-stories -> publish-github -> plan
																			  |
																			  v
planner: orchestrate -> developer: implement (sequential per story)
```

### UX Validation Loop

```
product-engineer: refine -> generate-spec
							   |
							   v
ux-engineer: mockups -> gap analysis -> refinement handoff
										  |
										  v
product-engineer: update spec/stories
```

### Quick Fix (Task List Already Exists)

```
developer: implement
```

---

## Commands

All commands use `pnpm`. Node.js ≥ 24 and pnpm ≥ 9 are required.

### Build

| Command | Description |
| --- | --- |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm build:watch` | Compile in watch mode |
| `pnpm typecheck` | Type-check without emitting files |

### Code Quality

| Command | Description |
| --- | --- |
| `pnpm lint` | Run ESLint (flat config, v9) |
| `pnpm lint:fix` | Run ESLint and auto-fix |
| `pnpm format` | Format all files with Prettier |
| `pnpm format:check` | Check formatting without writing |

### Testing

| Command | Description |
| --- | --- |
| `pnpm test` | Run all tests via `scripts/run-jest.mjs` |
| `pnpm test:watch` | Run Jest in watch mode |
| `pnpm test:coverage` | Run Jest and generate coverage report |

### Release

| Command | Description |
| --- | --- |
| `pnpm prepublishOnly` | Runs `build` automatically before `npm publish` |

---

## General Agent Guidelines

All agents working in this repository MUST:

- Use non-default branches for implementation work.
- Use Conventional Commits (`feat`, `fix`, `chore`, `docs`, etc.).
- Open PRs for review instead of self-merging to `main`.
- Require user approval for PRs targeting `main`.
- Treat GitHub as source of truth for checklist/progress state.
- Keep local task files in `/workstream/` synchronized with issue checklists.
- Follow testing, linting, and documentation rules from `docs/technical-guidelines.md`.
- Update generated artifacts and related docs when scope or behavior changes.
