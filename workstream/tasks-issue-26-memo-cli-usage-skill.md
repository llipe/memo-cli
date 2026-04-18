# Implementation Plan - Issue #26: Create memo-cli Usage Skill

## Relevant Files

- `.github/skills/memo-cli-usage/SKILL.md` - Main skill definition
- `AGENTS.md` - Agent/skill registry (update skill table)

## Tasks

- [ ] 1.0 Implement Issue #26 - https://github.com/llipe/memo-cli/issues/26: Create memo-cli usage skill for agents
  - [ ] 1.1 Create `.github/skills/memo-cli-usage/SKILL.md` with full skill definition
    - Skill purpose, scope, and when-to-use guidance
    - Complete command reference (setup, write, search, list, tags, inspect, delete)
    - Memory scope guidance (`/memories`, `/memories/session`, `/memories/repo`)
    - Safe operation guardrails (non-destructive defaults, validation, error handling)
    - Multi-developer / cross-session context sharing best practices
    - Installable design (self-contained, copy & paste into another repo)
  - [ ] 1.2 Update `AGENTS.md` to register the new skill in the Skills table
  - [ ] 1.3 Verify Acceptance Criterion: Skill definition exists with clear purpose, scope, and usage instructions
  - [ ] 1.4 Verify Acceptance Criterion: Skill documents common command examples for all flows
  - [ ] 1.5 Verify Acceptance Criterion: Skill includes guardrails for safe operations
  - [ ] 1.6 Verify Acceptance Criterion: Skill explains memory scopes
  - [ ] 1.7 Verify Acceptance Criterion: Skill is referenced in AGENTS.md
  - [ ] 1.8 Verify Acceptance Criterion: Skill instructions are actionable in this repository
