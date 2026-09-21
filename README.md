# memo-cli

> Agent-first CLI for capturing and querying development decisions via a Qdrant vector store.

GitHub: [https://github.com/llipe/memo-cli](https://github.com/llipe/memo-cli)

`@llipe.com/memo-cli` lets AI agents and developers record architectural decisions, integration points, and structural choices during development — then retrieve them semantically at any time.

---

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Getting Started](#getting-started)
- [Usage Guide](#usage-guide)
  - [Step 1: Initialize a Repository](#step-1-initialize-a-repository)
    - [Ranking configuration (optional)](#ranking-configuration-optional)
  - [Step 2: Write Your First Decision](#step-2-write-your-first-decision)
  - [Step 3: Search Decisions](#step-3-search-decisions)
  - [Step 4: List Decisions](#step-4-list-decisions)
  - [Step 5: Manage Config](#step-5-manage-config)
  - [Step 6: Discover Tags](#step-6-discover-tags)
  - [Step 7: Inspect the Knowledge Base](#step-7-inspect-the-knowledge-base)
  - [Step 8: Delete Entries](#step-8-delete-entries)
  - [Step 9: Read a Single Entry](#step-9-read-a-single-entry)
- [Command Reference](#command-reference)
- [Agent Integration](#agent-integration)
  - [Agent Skill (memo-cli-usage)](#agent-skill-memo-cli-usage)
- [Bootstrap Workflow](#bootstrap-workflow)
- [Development](#development)
- [Release Process](#release-process)
- [Project Structure](#project-structure)
- [License](#license)

---

## Requirements

| Tool           | Version  | Notes                                                                                                                  |
| -------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| Node.js        | ≥ 24 LTS | Required for native ESM support                                                                                        |
| Qdrant         | ≥ 1.7    | [Local Docker](https://qdrant.tech/documentation/quick-start/) or [Qdrant Cloud](https://cloud.qdrant.io/) (free tier) |
| OpenAI API key | —        | For text embeddings (`text-embedding-3-small`)                                                                         |

---

## Installation

### From npm (recommended)

```bash
npm install -g @llipe.com/memo-cli
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

#### Ranking configuration (optional)

`memo search` orders results by a composite `final_score`, not raw similarity. The `ranking` block is additive and optional — omit it entirely to use the documented defaults:

```json
{
  "schema_version": "1",
  "repo": "my-service",
  "org": "my-company",
  "domain": "backend",
  "ranking": {
    "w_similarity": 0.6,
    "w_recency": 0.3,
    "w_source": 0.1,
    "recency_half_life_days": 365,
    "tag_boost_factor": 0.05,
    "confidence_thresholds": {
      "exact": 0.88,
      "high": 0.75,
      "medium": 0.6
    },
    "staleness_threshold_days": 120,
    "staleness_tag_overlap_threshold": 0.5,
    "lexical": true,
    "lexical_boost_factor": 0.15
  }
}
```

| Field                             | Default                                    | Meaning                                                                                                                                                                                                                                                                                       |
| --------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `w_similarity`                    | `0.6`                                      | Weight on raw cosine similarity, clamped to `[0, 1]` before compositing                                                                                                                                                                                                                       |
| `w_recency`                       | `0.3`                                      | Weight on exponential recency decay based on `timestamp_utc`                                                                                                                                                                                                                                  |
| `w_source`                        | `0.1`                                      | Weight on source reliability (`agent` 1.0, `manual` 0.8, `scan` 0.5, unknown/missing 0.5)                                                                                                                                                                                                     |
| `recency_half_life_days`          | `365`                                      | Days for the recency score to decay to `0.5`; must be a positive number. Tuned up from the originally-proposed `90` via the task 8.0 sweep methodology, applied to this story after a relevance-eval regression at `90` (see the Development section's relevance-eval subsection)             |
| `tag_boost_factor`                | `0.05`                                     | Additive boost for tag overlap between the query and a result's `tags` (issue #36): `tag_boost = matched_tags / total_query_terms * tag_boost_factor`, added to the base score before the `1.0` cap. `0` disables tag boosting entirely; must be a non-negative finite number                 |
| `confidence_thresholds`           | `{ exact: 0.88, high: 0.75, medium: 0.6 }` | Band boundaries (issue #35) for the `confidence_tier` attached to every `memo search` result: `exact` at/above the `exact` threshold, `high` in `[high, exact)`, `medium` in `[medium, high)`, `low` below `medium`. Each threshold is a number in `[0, 1]`.                                  |
| `staleness_threshold_days`        | `120`                                      | Age (in days) beyond which a result becomes eligible to be flagged stale (issue #38); must be a non-negative finite number                                                                                                                                                                    |
| `staleness_tag_overlap_threshold` | `0.5`                                      | Minimum Jaccard tag overlap with a newer same-repo entry required to flag a result stale (issue #38); a number in `[0, 1]`                                                                                                                                                                    |
| `lexical`                         | `true`                                     | Enables lexical identifier matching (issue #62); `false` (or `--lexical off`) skips the extra scroll entirely                                                                                                                                                                                 |
| `lexical_boost_factor`            | `0.15`                                     | Additive boost for lexical identifier matches (issue #62): `lexical_boost = identifiers_matched / total_identifiers * lexical_boost_factor`, added to the base score alongside `tag_boost` before the `1.0` cap. `0` disables lexical boosting entirely; must be a non-negative finite number |

**Weight-sum rule:** `w_similarity + w_recency + w_source` must sum to `1.0` within a `±0.001` tolerance (float rounding). A `ranking` block that fails this check — including a _partial_ block whose resolved weights break the sum — fails `memo setup validate` (exit `1`) and `memo search` (`CONFIG_INVALID`, exit `1`); there is no silent fallback to defaults. A partial block that only overrides `recency_half_life_days` (or `tag_boost_factor`) is fine, since the untouched weights still sum to `1.0`.

**Tag overlap boosting (#36):** matching is case-insensitive and whole-word. The query is normalized by splitting on whitespace, stripping leading/trailing punctuation from each term (keeping internal hyphens, so a kebab-case tag like `rate-limiting` only matches the whole query token `rate-limiting`, not the bare word `rate`), and excluding a fixed stopword list (`a, the, is, for, of, in, to, with`) from `total_query_terms`. A query with only stopwords, or no terms at all, yields `tag_boost: 0` and never divides by zero.

**Confidence threshold ordering (#35):** `confidence_thresholds` must be strictly descending (`exact > high > medium`); equal values are rejected too, since a zero-width band would make that tier unreachable. Like the weight-sum rule, an invalid ordering — including a partial override that breaks it — fails `memo setup validate` (exit `1`) and `memo search` (`CONFIG_INVALID`, exit `1`), naming the offending `ranking.confidence_thresholds` path.

`final_score`, `recency_score`, `source_score`, and `tag_boost` are always present alongside the original `similarity` on every `--json` result (backward compatible — `similarity` keeps its original raw meaning). Human-mode output is unaffected by tag boosting — it only shifts `final_score` ordering and percentage.

**Staleness detection (#38):** every `memo search` result older than `staleness_threshold_days` (default `120`) is checked, once per invocation, against a same-repo corpus fetched via one `scroll` call (bounded at 1,000 entries, cached for the command's duration — never a per-result network call). If a _strictly newer_ entry in that corpus has Jaccard tag overlap `>= staleness_tag_overlap_threshold` (default `0.5`) with the result, the result carries `stale: true` and `stale_by: <newest qualifying entry's id>` on `--json` output, and an inline `⚠ STALE — superseded by <id>` warning under the result in human output. Same-timestamp entries never supersede each other, an entry is never marked stale by itself, and an entry with no tags is never a superseder. Staleness is advisory-only: it is derived per-query, never stored, and never changes `final_score` or ordering — a stale result keeps its position. When a result is not stale, the `stale` and `stale_by` keys are omitted entirely (not `false`/`null`). Note the field name is `stale_by`, not `superseded_by` — Phase 2 introduces a distinct, _stored_ `superseded_by` payload field with different (authoritative, not inferred) semantics; a result may legitimately carry both.

**Lexical identifier matching (#62):** `memo search` widens (never narrows) its candidate set when the query contains identifier-shaped tokens — a token containing `.`, `/`, `-`, or `_`, matching `#\d+` or `[A-Z]+-\d+`, starting with `--`, or written in CamelCase (e.g. `search-filters.ts`, `#123`, `PROJ-45`, `--lexical`, `QdrantRepository`). When at least one such token is present and `ranking.lexical` is `true` (the default), exactly one extra Qdrant `scroll` runs against `rationale`/`files_modified` text indexes (`should` per identifier, `min_should: 1`, same pre-filters as the dense query, `limit 50`), in addition to the normal dense vector search — never instead of it. Candidates found only via this scroll get a locally computed cosine similarity against the query embedding; candidates already found by the dense search keep their Qdrant score. Every candidate (dense or lexical) then receives `lexical_boost = identifiers_matched / total_identifiers * lexical_boost_factor`, added to the base score alongside `tag_boost` before the `1.0` cap — matching is all-or-nothing per identifier (every one of `search-filters.ts`'s word-tokens must appear in a candidate's `rationale`/`files_modified` for that identifier to count). Use `--lexical off` (or `ranking.lexical: false`) to disable this entirely; a query with no identifier tokens never issues the extra scroll regardless of the setting. If the lexical scroll itself fails, `memo search` degrades to dense-only results (logged under `MEMO_DEBUG`, exit code unchanged) rather than failing the command. `lexical_boost` is internal to Phase 1 ranking — it becomes visible in `--json` output via `--explain` (issue #63).

The two supporting Qdrant `text` indexes (`rationale`, `files_modified` — see [Data Model](docs/data-model.md)) are created automatically and idempotently by `ensureIndexes()` on every `memo search`/`memo write` invocation, including against a collection created by an earlier memo-cli version; no manual migration step is required.

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

| Flag               | Required | Default     | Description                                                              |
| ------------------ | -------- | ----------- | ------------------------------------------------------------------------ |
| `--rationale`      | Yes      | —           | Decision text (1–5000 chars)                                             |
| `--tags`           | Yes      | —           | Comma-separated tags (2–5, kebab-case)                                   |
| `--entry-type`     | No       | `decision`  | `decision` \| `integration_point` \| `structure`                         |
| `--source`         | No       | from config | `agent` \| `scan` \| `manual`                                            |
| `--commit`         | No       | —           | Associated git commit SHA                                                |
| `--story`          | No       | —           | Associated story/task identifier                                         |
| `--files-modified` | No       | —           | Comma-separated file paths                                               |
| `--relates-to`     | No       | —           | Comma-separated related repos                                            |
| `--on-duplicate`   | No       | —           | Duplicate action: `consolidate` \| `update` \| `replace` \| `create-new` |
| `--json`           | No       | `false`     | Output as JSON                                                           |

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

| Type                | When to use                                                        |
| ------------------- | ------------------------------------------------------------------ |
| `decision`          | Architectural or technical decisions made during a task            |
| `integration_point` | How another system, service, or module is integrated               |
| `structure`         | Module-level or architectural structure (typically from bootstrap) |

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

| Flag           | Default | Description                                                            |
| -------------- | ------- | ---------------------------------------------------------------------- |
| `--scope`      | `repo`  | `repo` (this repo only) or `related` (include `relates_to` repos)      |
| `--tags`       | —       | Comma-separated tags to require (AND semantics)                        |
| `--entry-type` | —       | Filter: `decision` \| `integration_point` \| `structure`               |
| `--source`     | —       | Filter: `agent` \| `scan` \| `manual`                                  |
| `--limit`      | `5`     | Maximum results to return                                              |
| `--lexical`    | `on`    | `on` \| `off` — enable/disable lexical identifier matching (issue #62) |
| `--explain`    | `false` | Show a per-result factor breakdown (issue #63) — see below             |
| `--json`       | `false` | Output as JSON                                                         |

#### Reading search results

Results are ordered by a composite `final_score` — not raw similarity (see [Ranking configuration](#ranking-configuration-optional) above). Human mode output shows the `final_score` percentage in the same position raw similarity used to occupy, prefixed with a `[tier]` confidence-tier label (issue #35; `exact`/`high` render green, `medium` yellow, `low` gray — the text label is always present regardless of color support):

```
  [exact] my-service  94%  Adopted JWT with RS256 for service-to-service auth...
      repo: my-service  tags: auth, jwt, security  type: decision
      source: agent  2026-04-10T15:30:00Z

  [high] auth-service  87%  Auth service exposes /validate endpoint for token...
      repo: auth-service  tags: auth, api, validation  type: integration_point
      source: agent  2026-04-09T10:00:00Z
```

JSON mode (`--json`) returns the full machine-readable payload, including all five score components plus `confidence_tier` on every result (`similarity` keeps its original raw-cosine meaning; `final_score` is what `results` is ordered by), and a `query_id` at the envelope level:

```json
{
  "query": "how do we handle authentication",
  "query_id": "6f1c2e6a-2b3f-4a3b-9c1e-7a1f9c9e6f1c",
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
      "final_score": 0.87,
      "recency_score": 0.71,
      "source_score": 1.0,
      "tag_boost": 0.025,
      "confidence_tier": "high",
      ...
    }
  ],
  "count": 2
}
```

> **Note for existing `--json` consumers:** if you previously sorted or filtered on `results[].similarity`, that field's raw meaning is unchanged, but the array's own order now follows `final_score`, not `similarity` — switch to `final_score` if you rely on result order.

> **Breaking change (#35, the one output removal in Phase 1):** the static `confidence` field (`high`/`medium`/`low`, inherited from the entry's write-time `source`) is **removed from `memo search` output only** — both `--json` and human mode. It is replaced by `confidence_tier`, a per-query signal computed from `final_score` (`exact ≥ 0.88`, `high` `[0.75, 0.88)`, `medium` `[0.60, 0.75)`, `low` below `0.60`; thresholds are configurable under `ranking.confidence_thresholds` above). `confidence` is unaffected everywhere else — it remains on `memo read`, `memo list`, and `memo write` output, and in the stored payload. If your integration reads `confidence` from `memo search --json`, switch to `confidence_tier`.

#### `query_id` and `--explain` (issue #63)

Every `memo search --json` response carries a fresh, random `query_id` (UUID v4) at the envelope level, generated once per invocation — two identical queries produce two different ids. `query_id` is **inert in Phase 1**: nothing is persisted (no file, no Qdrant payload change), and nothing reads it back. It exists purely to establish the contract Phase 3 fills in (attaching feedback and relevance snapshots to a specific result set via `memo used`) without another output-shape change. In human mode, `query_id` is not printed unless `--explain` is set.

`--explain` is a diagnostic flag: it never changes ordering, scores, or which results return, and it adds no extra Qdrant or embeddings call. It adds a `factors` object to every `--json` result:

```json
{
  "results": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      ...,
      "factors": {
        "similarity": 0.94,
        "recency_score": 0.71,
        "source_score": 1.0,
        "tag_boost": 0.025,
        "lexical_boost": 0.0,
        "retention": 1.0,
        "use_ratio": 0,
        "link_factor": 1.0,
        "final_score": 0.87
      }
    }
  ]
}
```

`retention`, `use_ratio`, and `link_factor` are always the neutral values shown above in Phase 1 (they belong to issues #54-#56) — they are explicit, not omitted, so `--explain`'s shape never changes once those stories light them up. `lexical_boost` is present and numeric (`0.0`, not omitted) even when `--lexical off` disabled lexical matching for that query.

In human mode, `--explain` appends an aligned factor table under each result and a `query_id: <uuid>` footer line after all results:

```
  [high] my-service  87%  Adopted JWT with RS256 for service-to-service auth...
      repo: my-service  tags: auth, jwt, security  type: decision
      source: agent  2026-04-10T15:30:00Z
sim   recency  source  tag    lex   retention  use   final
0.94  0.71     1.00    0.03   0.00  1.00       0.00  0.87
id:550e8400-e29b-41d4-a716-446655440000

query_id: 6f1c2e6a-2b3f-4a3b-9c1e-7a1f9c9e6f1c
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

| Flag           | Default | Description                           |
| -------------- | ------- | ------------------------------------- |
| `--scope`      | `repo`  | `repo` or `related`                   |
| `--tags`       | —       | Comma-separated tag filter            |
| `--entry-type` | —       | Filter by entry type                  |
| `--source`     | —       | Filter by source                      |
| `--from`       | —       | Start date (`YYYY-MM-DD` or ISO 8601) |
| `--to`         | —       | End date (`YYYY-MM-DD` or ISO 8601)   |
| `--limit`      | `20`    | Maximum entries                       |
| `--json`       | `false` | Output as JSON                        |

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

### Step 6: Discover Tags

Browse all unique tags stored in your knowledge base, with counts and flexible scope.

#### List all tags in the current repo

```bash
memo tags list
```

#### Scope and sorting options

```bash
# Include related repos from config
memo tags list --scope related

# Sort alphabetically (default: frequency)
memo tags list --sort alpha

# JSON output for agent consumption
memo tags list --json
```

#### All tags list flags

| Flag      | Default     | Description                         |
| --------- | ----------- | ----------------------------------- |
| `--scope` | `repo`      | `repo` or `related`                 |
| `--sort`  | `frequency` | `frequency` (count desc) or `alpha` |
| `--json`  | `false`     | Output as JSON                      |

---

### Step 7: Inspect the Knowledge Base

Discover what organizations, repositories, and domains have entries in your Qdrant collection — without any scope restriction.

#### Show everything

```bash
memo inspect
```

Outputs three grouped sections: Organizations, Repositories (with org and domain annotations), and Domains.

#### Filter to specific facets

```bash
# Only repositories
memo inspect --repos

# Only organizations
memo inspect --orgs

# Only domains
memo inspect --domains

# JSON output
memo inspect --json
```

#### All inspect flags

| Flag        | Default | Description             |
| ----------- | ------- | ----------------------- |
| `--orgs`    | —       | Show only organizations |
| `--repos`   | —       | Show only repositories  |
| `--domains` | —       | Show only domains       |
| `--json`    | `false` | Output as JSON          |

> When no filter flags are passed, all three facets are shown.

---

### Step 8: Delete Entries

Safely delete individual entries or bulk-delete by repository or organization. Always confirms before deleting.

#### Delete a single entry by ID

```bash
memo delete --id 550e8400-e29b-41d4-a716-446655440000
```

Memo shows a preview of the matching entry and asks for confirmation.

#### Bulk delete by repository or organization

```bash
# Delete all entries for a repository
memo delete --all-by-repo my-service

# Delete all entries for an organization
memo delete --all-by-org my-company
```

Memo shows a count of matching entries and asks for confirmation.

#### Skip confirmation (automation)

```bash
memo delete --id <id> --yes
memo delete --all-by-repo my-service --yes
```

#### Agent mode note

In agent mode (`--source agent` or when `--json` is used for single deletes), bulk flags are not available via `--json`. Single-entry deletion supports `--json` output:

```bash
memo delete --id <id> --json
# outputs: { "deleted": true, "id": "...", "scope": "single", "count": 1 }
```

#### All delete flags

| Flag            | Default | Description                                   |
| --------------- | ------- | --------------------------------------------- |
| `--id`          | —       | Delete a single entry by UUID                 |
| `--all-by-repo` | —       | Delete all entries for the given repo name    |
| `--all-by-org`  | —       | Delete all entries for the given organization |
| `--yes`         | `false` | Skip confirmation prompt                      |
| `--json`        | `false` | JSON output (single-delete only)              |

> `--id`, `--all-by-repo`, and `--all-by-org` are mutually exclusive.

---

### Step 9: Read a Single Entry

Fetch one exact memo entry when you already know its ID.

```bash
memo read --id 550e8400-e29b-41d4-a716-446655440000
```

This command is read-only and does not require local `memo.config.json`.

#### JSON mode

```bash
memo read --id 550e8400-e29b-41d4-a716-446655440000 --json
```

Returns the flat entry payload as JSON.

#### All read flags

| Flag     | Default | Description                |
| -------- | ------- | -------------------------- |
| `--id`   | —       | Required entry id to fetch |
| `--json` | `false` | Output as JSON             |

---

## Command Reference

| Command               | Purpose                       | Key Flags                                                                       |
| --------------------- | ----------------------------- | ------------------------------------------------------------------------------- |
| `memo setup init`     | Create `memo.config.json`     | `--repo`, `--org`, `--domain`, `--relates-to`, `--force`                        |
| `memo setup show`     | Display current config        | `--json`                                                                        |
| `memo setup validate` | Check config validity         | —                                                                               |
| `memo write`          | Capture a decision            | `--rationale`, `--tags`, `--entry-type`, `--source`, `--on-duplicate`, `--json` |
| `memo search <query>` | Semantic search               | `--scope`, `--tags`, `--entry-type`, `--limit`, `--json`                        |
| `memo list`           | Chronological listing         | `--from`, `--to`, `--tags`, `--limit`, `--json`                                 |
| `memo tags list`      | Browse unique tags            | `--scope`, `--sort`, `--json`                                                   |
| `memo inspect`        | Discover orgs/repos/domains   | `--orgs`, `--repos`, `--domains`, `--json`                                      |
| `memo delete`         | Delete entries                | `--id`, `--all-by-repo`, `--all-by-org`, `--yes`, `--json`                      |
| `memo read`           | Read one specific entry by id | `--id`, `--json`                                                                |

### Global flags

| Flag        | Description          |
| ----------- | -------------------- |
| `--version` | Print version number |
| `--help`    | Show help text       |

### Exit codes

| Code | Meaning                                        |
| ---- | ---------------------------------------------- |
| `0`  | Success                                        |
| `1`  | User error (bad input, missing config)         |
| `2`  | System error (Qdrant unreachable, API failure) |

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

### Agent Skill (memo-cli-usage)

This repository ships a reusable agent skill at [`.github/skills/memo-cli-usage/SKILL.md`](.github/skills/memo-cli-usage/SKILL.md) that teaches AI agents (and developers) how to operate memo-cli correctly and consistently.

The skill is **self-contained and installable** — copy the `memo-cli-usage/` folder into any repository's `.github/skills/` directory and reference it from that repo's agent registry.

#### What the skill covers

| Section                               | Description                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **When to write / when to search**    | Precise trigger tables — which moment calls for a `memo write`, which calls for a `memo search` first           |
| **`repo`, `org`, `domain` explained** | What each identity field means, how to choose values, and why they matter for scoping                           |
| **`relates_to` explained**            | When to add a repo, how cross-repo queries work, and how to avoid over-populating the list                      |
| **Tag strategy**                      | Five-layer taxonomy (domain, technology, entry nature, story ref, scope), naming rules, and ready-made examples |
| **Writing quality**                   | The context + decision + rationale formula with side-by-side good/bad examples                                  |
| **Intent & outcome entries**          | How to narrate agent work as it happens — write before starting, write after finishing                          |
| **Recording file changes**            | How to annotate which files changed and explain why those were the right files                                  |
| **Recording config decisions**        | Env vars, storage layout, feature flags, schema versions — what to capture and why                              |
| **Multi-developer & cross-session**   | Shared KB, session continuity for stateless agents, multi-day work pattern                                      |
| **Memory scope decision tree**        | When to use IDE/agent memory (`/memories/`) vs. memo-cli                                                        |
| **Safe operation guardrails**         | Non-destructive defaults, `--json` mode rules, error handling, credential safety                                |

#### Install into another repository

```bash
# 1. Copy the skill
cp -r .github/skills/memo-cli-usage /path/to/your-repo/.github/skills/

# 2. Register it in your AGENTS.md or skill registry:
# | memo-cli-usage | .github/skills/memo-cli-usage/ | Agent guidance for memo-cli | Any agent |

# 3. Install memo-cli
pnpm add -D @llipe.com/memo-cli

# 4. Initialize the repo
npx memo setup init --repo <name> --org <org> --domain <domain>
```

Once the skill is registered, any agent (GitHub Copilot, Claude, GPT-4, etc.) that loads it will know how to record decisions, restore session context, tag consistently, and stay safe.

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

| Script                    | Description                                                                  |
| ------------------------- | ---------------------------------------------------------------------------- |
| `pnpm run build`          | Compile TypeScript to `dist/`                                                |
| `pnpm run build:watch`    | Compile in watch mode                                                        |
| `pnpm run typecheck`      | Type-check without emitting                                                  |
| `pnpm run lint`           | ESLint (v9 flat config, strict type-checked)                                 |
| `pnpm run lint:fix`       | ESLint with auto-fix                                                         |
| `pnpm run format`         | Prettier format                                                              |
| `pnpm run format:check`   | Check formatting without writing                                             |
| `pnpm run test`           | Run Jest test suite                                                          |
| `pnpm run test:coverage`  | Run Jest with coverage report                                                |
| `pnpm run validate`       | Run typecheck, lint, format:check, test, and audit in sequence, failing fast |
| `pnpm run eval:relevance` | Run the relevance evaluation harness (see below)                             |

### Testing

```bash
pnpm run test                          # all tests
pnpm run test -- --testPathPattern=write   # specific module
pnpm run test:coverage                 # with coverage report
```

### Relevance evaluation harness

`scripts/eval-relevance.ts` measures `memo search`'s top-3 retrieval relevance
against a versioned fixture set (`tests/fixtures/relevance/`), so ranking
changes are judged against a recorded baseline instead of intuition. It is a
development/eval affordance, not a shipped CLI command.

Modes (flags are combinable):

| Invocation                                                 | Effect                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm run eval:relevance`                                  | Runs every query in `queries.json` against a live Qdrant + embeddings provider; prints per-category and overall top-3 hit rate; always exits 0 (reports, does not gate).                                                                                                       |
| `MEMO_COLLECTION=memo_eval pnpm run eval:relevance --seed` | Upserts `entries.json` into the collection named by `MEMO_COLLECTION`. **Refuses (exit 1) if `MEMO_COLLECTION` is unset or empty** — this guard exists so fixture data can never land in the production `decisions` collection. Idempotent: re-seeding overwrites by fixed id. |
| `pnpm run eval:relevance --record`                         | Runs every query and additionally writes `candidates.json` and `baseline.json`. Manual only — CI replays, it never records.                                                                                                                                                    |

`MEMO_COLLECTION` isolates the evaluation collection from production data:
`QdrantRepository` resolves it once at construction (default `decisions` when
unset or empty/whitespace-only). Plain `run` and `--record` do **not** refuse
when `MEMO_COLLECTION` is unset, since neither writes a Qdrant point (only
local JSON files); only `--seed` — the one mode that writes points — enforces
the refusal.

`tests/relevance/replay.test.ts` replays the committed `candidates.json`
offline (no network, no `QDRANT_URL`/`EMBEDDINGS_API_KEY`) and asserts the
recomputed hit rate is at least `baseline.json.overall_top3`, guarding every
later ranking change against a regression.

**Story S1-02 (issue #34) case study:** landing composite ranking at the
originally-proposed defaults (`recency_half_life_days: 90`) dropped the
overall hit rate from the recorded 92.9% floor to 85.7% — a real regression,
not a fluke (`concept` and `identifier` queries were hit hardest, consistent
with recency weighting burying a genuinely correct older decision). Rather
than accept the regression or move the floor, a one-factor sweep over
`recency_half_life_days` (keeping the weights at their spec values) found a
wide, robust plateau from ~260 to 700+ days all measuring 96.4%; `365` was
chosen as the simplest, most legible value well inside that plateau. See PR
#67 for the full sweep grid and numbers.

The `eval:relevance` script sets `TS_NODE_TRANSPILE_ONLY=true` for its
`node --loader ts-node/esm` invocation: ts-node/esm's own type-check pass
does not apply `esModuleInterop` for `openai`'s CJS default export the same
way `tsc`/the compiled `dist/` bin entry does, which otherwise aborts the
script with spurious `TS2709`/`TS2351` diagnostics before any code runs,
independent of credentials or network reachability. `pnpm run typecheck`
still covers `src/**` with correct interop; this only skips ts-node's
redundant re-check for this one script invocation.

Typical workflow when re-recording the baseline against local Docker Qdrant:

```bash
MEMO_COLLECTION=memo_eval pnpm run eval:relevance --seed
MEMO_COLLECTION=memo_eval pnpm run eval:relevance --record
memo inspect   # confirm "decisions" point counts are unaffected
```

202+ test cases across unit and integration layers. Coverage threshold: 80% lines/functions/statements.

### CI/CD

> **Current status:** there is no `.github/workflows/` pipeline in this repository yet. Typecheck, lint, test, build, audit, and npm publish are all run **manually** by the releaser. The steps below reflect the actual manual process, not an automated one.

## Release Process

Releases are tag-driven and version-locked, but published manually until an automated workflow exists.

Rules:

- Tag format must be `vX.Y.Z` for stable releases and `vX.Y.Z-rc.N` for pre-releases.
- The git tag and `package.json` `version` field must match exactly.
- Do not manually create a tag that differs from `package.json` version.
- If publish fails with "already published" (`npm` rejects re-publishing an existing version), bump the version and create a new tag.

### How to release (stable)

```bash
# 1. Make sure you're on the correct Node version (see .nvmrc)
nvm use

# 2. Install deps and run the full local quality gate
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
pnpm audit

# 3. Bump version and create matching git tag (example: v1.1.2)
npm version patch   # or: minor | major

# 4. Push commit + tag
git push origin main --follow-tags
```

Pushing the tag only updates git history — it does **not** publish to npm by itself. Publishing is a separate, manual step:

```bash
# 5. Authenticate to npm (skip if npm whoami already succeeds)
npm login
npm whoami   # confirm you're logged in as the expected account

# 6. Sanity-check exactly what will be published
npm pack --dry-run
# Confirm the tarball only contains dist/, README.md, LICENSE, package.json,
# and that the version matches the tag you just pushed.

# 7. Publish (runs the `prepublishOnly` build automatically)
npm publish

# 8. Verify the release landed
npm view @llipe.com/memo-cli version
npm install -g @llipe.com/memo-cli@latest
memo --version
```

### How to release (pre-release)

```bash
# Example: creates package version 1.2.0-rc.0 and tag v1.2.0-rc.0
npm version prerelease --preid=rc
git push origin main --follow-tags

npm login   # if not already authenticated
npm publish --tag next
```

### Notes

- `package.json` already sets `"publishConfig": { "access": "public" }` and a `prepublishOnly` script that runs `pnpm run build`, so `npm publish` always ships a freshly built `dist/`.
- If your local `~/.npmrc` auth token has expired, `npm publish` fails with `401 Unauthorized` — run `npm login` again before retrying.
- Automating this (tag push → CI build/test → npm publish) is tracked as future work; see Issue #21 in `workstream/tasks-prd-001-mvp-plan.md` for the planned `release.yml` workflow. Until that lands, treat every release as a manual, checklist-driven step.

---

## Project Structure

```
src/
├── index.ts              # CLI entry point (Commander root)
├── commands/
│   ├── setup.ts          # memo setup (init / show / validate)
│   ├── write.ts          # memo write (with duplicate detection)
│   ├── search.ts         # memo search (semantic + pre-filters)
│   ├── list.ts           # memo list (chronological + date range)
│   ├── tags.ts           # memo tags list (unique tags with counts)
│   ├── inspect.ts        # memo inspect (org/repo/domain facets)
│   ├── delete.ts         # memo delete (safe single + bulk delete)
│   └── read.ts           # memo read (single entry by ID)
├── lib/
│   ├── qdrant.ts         # Qdrant collection management & queries
│   ├── facets.ts         # Scroll-based facet aggregation
│   ├── embeddings.ts     # Embeddings adapter interface & factory
│   ├── config.ts         # Config file I/O & validation
│   ├── registry.ts       # Related-repo resolution
│   ├── output.ts         # Human/JSON output formatting
│   ├── errors.ts         # Typed error hierarchy
│   ├── dedupe.ts         # Deduplication & merge strategies
│   ├── search-filters.ts # Search pre-filter builder
│   ├── list-filters.ts   # List pre-filter builder (date range)
│   ├── retry.ts          # Exponential backoff retry
│   ├── eval.ts           # Pure top-3 hit-rate computation (eval harness)
│   └── debug.ts          # Debug logging (MEMO_DEBUG)
├── adapters/
│   └── openai-embeddings.ts  # OpenAI text-embedding-3-small
└── types/
    ├── entry.ts           # EntryPayload Zod schema
    ├── config.ts          # MemoConfig Zod schema
    └── cli.ts             # Shared CLI interfaces
tests/
├── unit/                  # Unit tests (lib, adapters, commands, scripts)
├── integration/           # Integration tests (commands, qdrant)
├── relevance/             # Offline replay guard (replay.test.ts)
└── fixtures/relevance/    # entries/queries/candidates/baseline.json
scripts/
├── run-jest.mjs           # Jest argument forwarder
├── validate-bootstrap.ts  # Bootstrap JSON validator
└── eval-relevance.ts      # Relevance evaluation harness (seed/run/record)
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
