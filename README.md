# memo-cli

> Agent-first CLI for capturing and querying development decisions via a Qdrant vector store.

`@memo-ai/cli` lets AI agents and developers record architectural decisions, integration points, and structural choices during development — then retrieve them semantically at any time.

---

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Getting Started](#getting-started)
- [Usage Guide](#usage-guide)
  - [Step 1: Initialize a Repository](#step-1-initialize-a-repository)
  - [Step 2: Write Your First Decision](#step-2-write-your-first-decision)
  - [Step 3: Search Decisions](#step-3-search-decisions)
  - [Step 4: List Decisions](#step-4-list-decisions)
  - [Step 5: Manage Config](#step-5-manage-config)
- [Command Reference](#command-reference)
- [Agent Integration](#agent-integration)
- [Bootstrap Workflow](#bootstrap-workflow)
- [Development](#development)
- [Project Structure](#project-structure)
- [License](#license)

---

## Requirements

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 24 LTS | Required for native ESM support |
| Qdrant | ≥ 1.7 | [Local Docker](https://qdrant.tech/documentation/quick-start/) or [Qdrant Cloud](https://cloud.qdrant.io/) (free tier) |
| OpenAI API key | — | For text embeddings (`text-embedding-3-small`) |

---

## Installation

### From npm (recommended)

```bash
npm install -g @memo-ai/cli
memo --version
```

### From source

```bash
git clone https://github.com/llipe/memo-cli.git
cd memo-cli
pnpm install
pnpm run build
./dist/index.js --help
```

---

## Getting Started

### 1. Start Qdrant

Run Qdrant locally with Docker:

```bash
docker run -p 6333:6333 qdrant/qdrant
```

Or use [Qdrant Cloud](https://cloud.qdrant.io/) (free tier available).

### 2. Set environment variables

Create a `.env` file in your project root (or export the vars in your shell):

```dotenv
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=                   # leave empty for local unauthenticated Qdrant
EMBEDDINGS_PROVIDER=openai
EMBEDDINGS_API_KEY=sk-...         # your OpenAI API key
```

### 3. Initialize your repository

```bash
memo setup init
```

This launches an interactive wizard that creates a `memo.config.json` in the current directory, establishing the repository's identity (repo name, organization, domain).

### 4. Write a decision

```bash
memo write \
  --rationale "Chose Qdrant over Pinecone for self-hosting flexibility and payload filtering." \
  --tags "architecture,storage,qdrant" \
  --entry-type decision \
  --source agent
```

### 5. Retrieve it later

```bash
memo search "why did we choose the vector database"
```

That's it — the core loop is **write decisions → search them later**.

---

## Usage Guide

### Step 1: Initialize a Repository

Every repository using memo needs a `memo.config.json` file. The `setup` command creates it.

#### Interactive mode (recommended)

```bash
memo setup init
```

The wizard will prompt for:
- **Repository name** — auto-detected from git remote if available
- **Organization** — your team or company identifier
- **Domain** — product area (e.g., `payments`, `auth`, `frontend`)
- **Related repos** — other repositories this repo integrates with (optional)

#### Non-interactive mode (for CI/agents)

```bash
memo setup init \
  --repo my-service \
  --org my-company \
  --domain backend \
  --relates-to "auth-service,api-gateway"
```

#### Verify your config

```bash
memo setup show        # display effective config
memo setup validate    # check config validity (exit 0 = valid)
```

#### Example `memo.config.json`

```json
{
  "schema_version": "1",
  "repo": "my-service",
  "org": "my-company",
  "domain": "backend",
  "relates_to": ["auth-service", "api-gateway"],
  "defaults": {}
}
```

---

### Step 2: Write Your First Decision

The `write` command captures a decision and stores it in Qdrant with a vector embedding for semantic retrieval.

#### Basic write

```bash
memo write \
  --rationale "Adopted JWT with RS256 for service-to-service auth. Short-lived tokens (15 min) with refresh rotation." \
  --tags "auth,jwt,security" \
  --entry-type decision \
  --source agent
```

#### All write flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--rationale` | Yes | — | Decision text (1–5000 chars) |
| `--tags` | Yes | — | Comma-separated tags (2–5, kebab-case) |
| `--entry-type` | No | `decision` | `decision` \| `integration_point` \| `structure` |
| `--source` | No | from config | `agent` \| `scan` \| `manual` |
| `--commit` | No | — | Associated git commit SHA |
| `--story` | No | — | Associated story/task identifier |
| `--files-modified` | No | — | Comma-separated file paths |
| `--relates-to` | No | — | Comma-separated related repos |
| `--on-duplicate` | No | — | Duplicate action: `consolidate` \| `update` \| `replace` \| `create-new` |
| `--json` | No | `false` | Output as JSON |

#### Duplicate detection

If you write an entry with the same repo + commit + story + entry_type + source combination, memo detects the duplicate:

- **Interactive (TTY):** prompts you to choose an action (consolidate, update, replace, create new)
- **Agent/JSON mode:** requires `--on-duplicate` flag to resolve programmatically

```bash
# Agent mode: automatically merge duplicates
memo write \
  --rationale "Updated JWT decision to include ECDSA as fallback." \
  --tags "auth,jwt,security,ecdsa" \
  --entry-type decision \
  --source agent \
  --commit abc1234 \
  --on-duplicate consolidate \
  --json
```

#### Entry types explained

| Type | When to use |
|------|-------------|
| `decision` | Architectural or technical decisions made during a task |
| `integration_point` | How another system, service, or module is integrated |
| `structure` | Module-level or architectural structure (typically from bootstrap) |

---

### Step 3: Search Decisions

Find decisions using natural language queries. Memo embeds your query and performs semantic vector search against all stored entries.

#### Basic search

```bash
memo search "how do we handle authentication"
```

#### Search with filters

```bash
# Only search within this repo (default)
memo search "database connection pooling" --scope repo

# Include related repos defined in config
memo search "how does the auth service validate tokens" --scope related

# Require specific tags (AND semantics)
memo search "API rate limiting" --tags "api,rate-limit"

# Filter by entry type
memo search "module boundaries" --entry-type structure

# Limit results
memo search "caching strategy" --limit 5

# Combine filters
memo search "event publishing" \
  --scope related \
  --tags "events,kafka" \
  --entry-type integration_point \
  --limit 3
```

#### All search flags

| Flag | Default | Description |
|------|---------|-------------|
| `--scope` | `repo` | `repo` (this repo only) or `related` (include `relates_to` repos) |
| `--tags` | — | Comma-separated tags to require (AND semantics) |
| `--entry-type` | — | Filter: `decision` \| `integration_point` \| `structure` |
| `--source` | — | Filter: `agent` \| `scan` \| `manual` |
| `--limit` | `5` | Maximum results to return |
| `--json` | `false` | Output as JSON |

#### Reading search results

Human mode output shows:

```
  1.  (94%) Adopted JWT with RS256 for service-to-service auth...
      repo: my-service  tags: auth, jwt, security  type: decision
      source: agent  confidence: high  2026-04-10T15:30:00Z

  2.  (87%) Auth service exposes /validate endpoint for token...
      repo: auth-service  tags: auth, api, validation  type: integration_point
      source: agent  confidence: high  2026-04-09T10:00:00Z
```

JSON mode (`--json`) returns the full machine-readable payload:

```json
{
  "query": "how do we handle authentication",
  "filters": { "scope": "repo", "repos": ["my-service"] },
  "results": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "repo": "my-service",
      "org": "my-company",
      "rationale": "Adopted JWT with RS256...",
      "tags": ["auth", "jwt", "security"],
      "entry_type": "decision",
      "similarity": 0.94,
      ...
    }
  ],
  "count": 2
}
```

---

### Step 4: List Decisions

Browse entries chronologically (newest first) with optional date-range filtering.

#### Basic listing

```bash
memo list                    # last 20 entries for this repo
memo list --limit 50         # last 50 entries
```

#### Filter by date range

```bash
# Entries from a specific date
memo list --from 2026-04-01

# Entries in a date range
memo list --from 2026-04-01 --to 2026-04-10

# Full ISO 8601 timestamps also work
memo list --from 2026-04-01T00:00:00Z --to 2026-04-10T23:59:59Z
```

#### Filter by tags and type

```bash
memo list --tags "auth,jwt"
memo list --entry-type decision
memo list --source agent --limit 10
```

#### All list flags

| Flag | Default | Description |
|------|---------|-------------|
| `--scope` | `repo` | `repo` or `related` |
| `--tags` | — | Comma-separated tag filter |
| `--entry-type` | — | Filter by entry type |
| `--source` | — | Filter by source |
| `--from` | — | Start date (`YYYY-MM-DD` or ISO 8601) |
| `--to` | — | End date (`YYYY-MM-DD` or ISO 8601) |
| `--limit` | `20` | Maximum entries |
| `--json` | `false` | Output as JSON |

---

### Step 5: Manage Config

#### Show effective configuration

```bash
memo setup show          # human-readable
memo setup show --json   # JSON output
```

#### Validate configuration

```bash
memo setup validate
# Exit code 0 = valid, 1 = errors found
```

#### Re-initialize (overwrite existing config)

```bash
memo setup init --force
```

---

## Command Reference

| Command | Purpose | Key Flags |
|---------|---------|-----------|
| `memo setup init` | Create `memo.config.json` | `--repo`, `--org`, `--domain`, `--relates-to`, `--force` |
| `memo setup show` | Display current config | `--json` |
| `memo setup validate` | Check config validity | — |
| `memo write` | Capture a decision | `--rationale`, `--tags`, `--entry-type`, `--source`, `--on-duplicate`, `--json` |
| `memo search <query>` | Semantic search | `--scope`, `--tags`, `--entry-type`, `--limit`, `--json` |
| `memo list` | Chronological listing | `--from`, `--to`, `--tags`, `--limit`, `--json` |

### Global flags

| Flag | Description |
|------|-------------|
| `--version` | Print version number |
| `--help` | Show help text |

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | User error (bad input, missing config) |
| `2` | System error (Qdrant unreachable, API failure) |

---

## Agent Integration

Memo is designed to be used by AI coding agents as part of their workflow. All commands support `--json` for machine-readable output.

### Recommended agent workflow

```bash
# 1. Before starting a task — search for prior decisions
memo search "authentication strategy for microservices" --json

# 2. After completing a task — write the decision
memo write \
  --rationale "Implemented OAuth2 with PKCE for the mobile client. Chose this over implicit flow for security." \
  --tags "auth,oauth2,mobile" \
  --entry-type decision \
  --source agent \
  --commit "$(git rev-parse HEAD)" \
  --story "PROJ-123" \
  --on-duplicate consolidate \
  --json

# 3. Verify the write
memo search "OAuth2 mobile client" --json | jq '.count'
```

### Environment setup for agents

Agents need these environment variables set:

```bash
export QDRANT_URL=http://localhost:6333
export EMBEDDINGS_API_KEY=sk-...
```

No `.env` file needed — agents should inject variables directly into the process environment.

---

## Bootstrap Workflow

To populate memo with decisions from an existing codebase, use the bootstrap workflow:

1. Feed key artifacts (README, architecture docs, config files) to an AI agent with the bootstrap prompt template
2. The agent produces JSON entries conforming to the entry schema
3. Validate the JSON with the included validation script
4. Write entries via `memo write`

See [docs/bootstrap-guide.md](docs/bootstrap-guide.md) for the full prompt template, JSON conversion examples, and validation steps.

### Quick validation example

```bash
# Validate a bootstrap JSON file
node --loader ts-node/esm scripts/validate-bootstrap.ts ./my-bootstrap.json
```

---

## Development

### Setup

```bash
git clone https://github.com/llipe/memo-cli.git
cd memo-cli
pnpm install
cp .env.example .env   # configure credentials
```

### Scripts

| Script | Description |
|--------|-------------|
| `pnpm run build` | Compile TypeScript to `dist/` |
| `pnpm run typecheck` | Type-check without emitting |
| `pnpm run lint` | ESLint (v9 flat config, strict type-checked) |
| `pnpm run lint:fix` | ESLint with auto-fix |
| `pnpm run format` | Prettier format |
| `pnpm run test` | Run Jest test suite |
| `pnpm run test:coverage` | Run Jest with coverage report |

### Testing

```bash
pnpm run test                          # all tests
pnpm run test -- --testPathPattern=write   # specific module
pnpm run test:coverage                 # with coverage report
```

155+ test cases across unit and integration layers. Coverage threshold: 80% lines/functions/statements.

### CI/CD

- **CI** runs on every push: typecheck → lint → test → build → audit
- **Publish** triggers on semver tag push (`v*.*.*`) → npm publish

---

## Project Structure

```
src/
├── index.ts              # CLI entry point (Commander root)
├── commands/
│   ├── setup.ts          # memo setup (init / show / validate)
│   ├── write.ts          # memo write (with duplicate detection)
│   ├── search.ts         # memo search (semantic + pre-filters)
│   └── list.ts           # memo list (chronological + date range)
├── lib/
│   ├── qdrant.ts         # Qdrant collection management & queries
│   ├── embeddings.ts     # Embeddings adapter interface & factory
│   ├── config.ts         # Config file I/O & validation
│   ├── registry.ts       # Related-repo resolution
│   ├── output.ts         # Human/JSON output formatting
│   ├── errors.ts         # Typed error hierarchy
│   ├── dedupe.ts         # Deduplication & merge strategies
│   ├── search-filters.ts # Search pre-filter builder
│   ├── list-filters.ts   # List pre-filter builder (date range)
│   ├── retry.ts          # Exponential backoff retry
│   └── debug.ts          # Debug logging (MEMO_DEBUG)
├── adapters/
│   └── openai-embeddings.ts  # OpenAI text-embedding-3-small
└── types/
    ├── entry.ts           # EntryPayload Zod schema
    ├── config.ts          # MemoConfig Zod schema
    └── cli.ts             # Shared CLI interfaces
tests/
├── unit/                  # Unit tests (lib, adapters, commands)
└── integration/           # Integration tests (commands, qdrant)
scripts/
├── run-jest.mjs           # Jest argument forwarder
└── validate-bootstrap.ts  # Bootstrap JSON validator
docs/
├── product-context.md     # Product strategy & roadmap
├── technical-guidelines.md # Technical standards
├── system-overview.md     # Architecture overview
├── data-model.md          # Data entities & schema
├── bootstrap-guide.md     # Bootstrap prompt & workflow
└── requirements/
    └── prd-001-mvp.md     # MVP product requirements
```

---

## License

MIT
