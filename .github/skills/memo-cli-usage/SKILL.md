# memo-cli Usage Skill

Teach AI agents (and human developers) how to operate **memo-cli** — the agent-first CLI for capturing and querying architectural decisions stored in a shared Qdrant vector database.

Use this skill whenever an agent needs to **read**, **write**, **search**, or **manage** decision entries in a repository that has `memo-cli` installed.

> **Portability:** This skill is self-contained. Copy the `memo-cli-usage/` folder into any repository's `.github/skills/` directory and reference it from that repo's `AGENTS.md` or skill registry.

---

## When to Use

- Recording an architectural decision, integration point, or structural choice during implementation.
- Searching for prior decisions before making a new one (avoid contradictions / duplicates).
- Listing recent entries to build context at the start of a session.
- Onboarding a new agent or developer to the decision history of a repository.
- Cleaning up outdated or incorrect entries.
- Discovering which organizations, repositories, or domains exist in the shared knowledge base.

---

## Prerequisites

### Environment Variables

The following variables **MUST** be set before any `memo` command will work:

| Variable | Purpose | Example |
|----------|---------|---------|
| `QDRANT_URL` | Qdrant instance endpoint | `http://localhost:6333` |
| `QDRANT_API_KEY` | API key (empty for local) | `""` or a cloud key |
| `EMBEDDINGS_PROVIDER` | Embedding backend | `openai` |
| `EMBEDDINGS_API_KEY` | Provider secret key | `sk-...` |

> **Tip:** Store these in a `.env` file at the repository root. `memo-cli` loads it automatically via `dotenv`.

### Repository Configuration

A `memo.config.json` **MUST** exist at the repository root. Create one with:

```bash
memo setup init --repo <repo-name> --org <org-name> --domain <domain> [--relates-to repo1,repo2]
```

Verify it at any time:

```bash
memo setup validate   # exit 0 = valid
memo setup show       # print effective config
```

---

## Core Concepts

### Entry Types

| Type | When to use |
|------|-------------|
| `decision` | Architectural or design choices ("We chose Postgres over Mongo because…") |
| `integration_point` | Cross-service contracts, API boundaries, shared schemas |
| `structure` | Folder layout, module boundaries, naming conventions |

### Source

| Value | Meaning |
|-------|---------|
| `agent` | Written by an AI agent (default when `defaults.source` is set) |
| `manual` | Written by a human developer |

### Scoping

Every entry belongs to a **repo**, **org**, and **domain** (all kebab-case). Queries default to the current repo context from `memo.config.json`.

- `--scope repo` — Only entries for the current repository.
- `--scope related` — Current repository + all repos listed in `relates_to`.

---

## Command Reference

### `memo write` — Record a Decision

```bash
memo write \
  --rationale "Chose JWT over session cookies for stateless auth across services" \
  --tags "auth,jwt,stateless" \
  --entry-type decision \
  --source agent \
  --json
```

**Required flags:**
- `--rationale` — The decision text (1–5 000 chars).
- `--tags` — 2–5 comma-separated kebab-case tags.

**Optional flags:**
- `--entry-type` — `decision` (default) | `integration_point` | `structure`
- `--source` — `agent` | `manual` (falls back to config default)
- `--commit` — Git commit SHA for traceability
- `--story` — Story or task ID
- `--files` — Comma-separated file paths touched by the decision
- `--relates-to` — Related repo names
- `--on-duplicate` — `consolidate` | `update` | `replace` | `create-new`
- `--json` — Machine-readable output (**always use in agent mode**)

**Duplicate handling:**
When memo detects a duplicate (same `repo + commit + story + entry_type + source`), interactive mode prompts for resolution. In `--json` mode you **MUST** supply `--on-duplicate` or the command will fail.

---

### `memo search` — Semantic Search

```bash
memo search "rate limiting strategy" --limit 5 --json
```

Natural-language vector search over decision entries.

**Optional flags:**
- `--scope` — `repo` (default) | `related`
- `--tags` — Comma-separated filter (AND logic)
- `--entry-type` — Filter by type
- `--source` — Filter by source
- `--limit` — Max results (default 10)
- `--json` — Machine-readable output

---

### `memo list` — Chronological Browse

```bash
memo list --limit 20 --json
```

Most-recent-first listing with optional date range.

**Optional flags:**
- `--scope`, `--tags`, `--entry-type`, `--source` — Same as search
- `--from` / `--to` — ISO 8601 date boundaries
- `--limit` — Max results (default 20)
- `--json` — Machine-readable output

---

### `memo tags list` — Discover Tags

```bash
memo tags list --sort frequency --json
```

Shows all unique tags with entry counts.

**Optional flags:**
- `--scope` — `repo` | `related`
- `--sort` — `alpha` (default) | `frequency`
- `--json` — Machine-readable output

---

### `memo inspect` — Global Facet Discovery

```bash
memo inspect --json
```

Lists all organizations, repositories, and domains across the entire knowledge base (ignores repo scope). Useful for onboarding and cross-team exploration.

**Optional flags:**
- `--orgs` / `--repos` / `--domains` — Show only one facet
- `--json` — Machine-readable output

---

### `memo delete` — Remove Entries

**Single entry:**
```bash
memo delete --id <uuid> --json
```

**Bulk (interactive only — blocked in `--json` mode for safety):**
```bash
memo delete --all-by-repo <repo-name> --yes
memo delete --all-by-org <org-name> --yes
```

Exactly one of `--id`, `--all-by-repo`, or `--all-by-org` is required.

---

## Agent Workflows

### Starting a Session — Build Context

At the **beginning of every coding session**, an agent SHOULD run this sequence to understand the current decision landscape:

```bash
# 1. Verify config is valid
memo setup validate

# 2. See what's in the knowledge base
memo inspect --json

# 3. List recent decisions for this repo
memo list --limit 10 --json

# 4. Check the tag landscape
memo tags list --sort frequency --json

# 5. Search for anything relevant to the current task
memo search "<current task description>" --limit 5 --json
```

### During Implementation — Record Decisions

Whenever a non-trivial architectural or design choice is made:

```bash
memo write \
  --rationale "Describe the decision and the reasoning behind it" \
  --tags "relevant,tags,here" \
  --entry-type decision \
  --source agent \
  --commit "$(git rev-parse HEAD)" \
  --story "TASK-123" \
  --files "src/auth/jwt.ts,src/middleware/auth.ts" \
  --json
```

**What makes a good decision entry:**
- Captures the **why**, not just the **what**.
- Includes enough context that a different agent or developer can understand the rationale months later.
- Links to the commit and story/task for traceability.
- Uses precise, descriptive tags for discoverability.

### Before Making a Decision — Search First

Before committing to a design choice, **always search** for prior relevant decisions:

```bash
memo search "authentication middleware approach" --scope related --json
```

This prevents contradictions with existing decisions and surfaces patterns already established in related repositories.

### End of Session — Summarize

If significant decisions were made, consider writing a summary entry:

```bash
memo write \
  --rationale "Session summary: implemented rate-limiting with token-bucket algorithm, chose Redis for counter storage due to TTL support" \
  --tags "rate-limiting,redis,session-summary" \
  --entry-type decision \
  --source agent \
  --json
```

---

## Multi-Developer & Cross-Session Context

`memo-cli` is designed so that **every agent and developer shares the same decision history**. This is what makes it valuable in teams:

### Shared Knowledge Base

All entries are stored in a shared Qdrant instance. When Developer A records a decision, Developer B (or Agent B) can immediately find it via `memo search` or `memo list`. There is no per-user silo.

### Cross-Repository Visibility

Use `--scope related` alongside the `relates_to` configuration to query decisions from connected repositories. This is critical for:
- Microservice architectures where contracts span repos.
- Monorepo-adjacent setups where domain boundaries cross packages.

### Session Continuity for Agents

Agents are stateless between sessions. To maintain continuity:

1. **Start every session** with `memo list` and `memo search` to load prior context.
2. **End every session** by writing any significant decisions made.
3. **Tag consistently** — use the same tag vocabulary across sessions so future searches find related entries. Run `memo tags list` to see what tags already exist before inventing new ones.

### What to Record (Guidelines)

| Record | Skip |
|--------|------|
| Architectural choices and their rationale | Trivial implementation details |
| Technology selections with trade-off analysis | Routine bug fixes |
| API contracts and integration boundaries | Formatting or style preferences (use linters) |
| Data model decisions | Temporary workarounds (unless they become permanent) |
| Security-sensitive design choices | Build/CI configuration (use config files) |
| Performance trade-offs | Dependency version bumps |

---

## Memory Scopes (IDE / Agent Memory vs. memo-cli)

Many agent runtimes (e.g., VS Code Copilot) have a built-in memory system alongside `memo-cli`. Understanding when to use each is key:

| Scope | Path | Persistence | Use For |
|-------|------|-------------|---------|
| **User memory** | `/memories/` | Across all workspaces & sessions | Personal preferences, debugging patterns, general insights |
| **Session memory** | `/memories/session/` | Current conversation only | Task-specific scratch notes, in-progress state |
| **Repository memory** | `/memories/repo/` | Current workspace | Repo-specific facts: build commands, conventions, gotchas |
| **memo-cli** | Qdrant (shared) | Permanent, shared across all agents & developers | Architectural decisions, integration points, structural choices |

### Decision Tree: Where to Store Information

1. **Is it an architectural decision, design rationale, or integration contract?** → `memo write`
2. **Is it a repo-specific convention or gotcha that all agents should know?** → `/memories/repo/` AND consider `memo write` if it reflects an architectural choice
3. **Is it a personal preference or general pattern?** → `/memories/` (user memory)
4. **Is it temporary, in-progress context for this session only?** → `/memories/session/`

---

## Safe Operation Guardrails

### Non-Destructive Defaults

- `memo delete` requires confirmation by default. Use `--yes` to skip only when you are certain.
- Bulk delete (`--all-by-repo`, `--all-by-org`) is **blocked in `--json` mode** as a safety guard against accidental mass deletion by agents.
- `memo write` detects duplicates and prompts for resolution rather than silently overwriting.

### Agent Mode (`--json`)

Agents **SHOULD** always pass `--json` for predictable, parseable output. Key behaviors in JSON mode:
- All output is structured JSON on stdout.
- Errors produce JSON error objects to stderr.
- Interactive prompts are suppressed — flags must supply all decisions.
- `--on-duplicate` is required when a duplicate is detected.
- Bulk delete is prohibited.

### Validation Before Writing

Before `memo write`, agents SHOULD:
1. Verify `memo setup validate` passes.
2. Confirm tags are kebab-case (lowercase, hyphens only).
3. Ensure rationale is meaningful (not placeholder text).
4. Check for duplicates with `memo search` first.

### Error Handling

All `memo` commands exit with:
- **0** — Success
- **1** — Validation or user error (bad flags, invalid config)
- **2** — Unexpected/infrastructure error (Qdrant down, embedding API failure)

When a command fails:
1. Read the error code and message from stderr.
2. For exit code 1: fix the input and retry.
3. For exit code 2: check connectivity (`QDRANT_URL`) and API keys before retrying.

### Environment Variable Safety

- **Never** log or output `EMBEDDINGS_API_KEY` or `QDRANT_API_KEY`.
- Store credentials in `.env` (which should be in `.gitignore`).
- For CI/CD, use secrets management rather than plaintext config.

---

## Quick Reference Card

```
memo setup init --repo <r> --org <o> --domain <d>   # Initialize config
memo setup validate                                   # Verify config
memo setup show [--json]                              # Display config

memo write --rationale "..." --tags "a,b,c" [--json]  # Record decision
memo search "query" [--scope related] [--json]         # Semantic search
memo list [--from DATE] [--to DATE] [--json]           # Browse entries
memo tags list [--sort frequency] [--json]             # Discover tags
memo inspect [--json]                                  # Global facets
memo delete --id <uuid> [--json]                       # Delete entry
```

---

## Installation in Another Repository

1. **Copy** the `memo-cli-usage/` folder into `<your-repo>/.github/skills/`.
2. **Add** the skill to your agent/skill registry (e.g., `AGENTS.md`):
   ```markdown
   | memo-cli-usage | `.github/skills/memo-cli-usage/` | Agent guidance for memo-cli operations | Any agent |
   ```
3. **Install** `memo-cli` as a dev dependency:
   ```bash
   pnpm add -D memo-cli   # or npm install -D memo-cli
   ```
4. **Configure** the repository:
   ```bash
   npx memo setup init --repo <name> --org <org> --domain <domain>
   ```
5. **Set** environment variables (`.env` or CI secrets):
   ```
   QDRANT_URL=http://localhost:6333
   QDRANT_API_KEY=
   EMBEDDINGS_PROVIDER=openai
   EMBEDDINGS_API_KEY=sk-...
   ```
6. The skill is now active — any agent that loads it will know how to use `memo-cli`.
