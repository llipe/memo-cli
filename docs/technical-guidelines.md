# Technical Guidelines — Memo CLI
> `@memo-ai/cli` · v1.0 · April 2026

---

## 1. Overview

### Technical Vision

Memo CLI is a lightweight, agent-first command-line tool built to be fast, composable, and predictable. The architecture prioritizes:

- **Agent compatibility:** every command must produce machine-readable output via `--json`; exit codes must be deterministic.
- **Provider swap-ability:** embeddings and LLM providers are injectable adapters — the core has no hardcoded vendor.
- **Near-zero startup cost:** modules are loaded lazily per command; the binary must boot in under 200ms.
- **Simplicity over abstraction:** only introduce abstractions that are used by more than one consumer.

### Guiding Principles

- YAGNI — build only what is needed now.
- Fail fast with clear, actionable error messages.
- Prefer composition over inheritance.
- Credentials are never logged, committed, or echoed.
- All public surfaces (CLI flags, payload schema) are versioned and backward-compatible within a major.

---

## 2. Technology Stack

### Runtime

| Component | Choice | Version | Rationale |
|-----------|--------|---------|-----------|
| **Runtime** | Node.js | 24 LTS | Latest LTS; native `fetch`, improved startup, full ESM support |
| **Language** | TypeScript | 5.x | Strict mode; type safety across the full codebase |
| **Package manager** | pnpm | 9.x | Efficient disk usage; strict `node_modules` layout; lockfile committed |

### Core Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI framework — command/option/argument parsing |
| `@qdrant/js-client-rest` | Official Qdrant REST client |
| `openai` | OpenAI SDK — embeddings and LLM calls (scan) |
| `zod` | Runtime schema validation for config files and API payloads |
| `dotenv` | Local `.env` loading (dev only; production uses env vars directly) |
| `chalk` | Terminal color output (human-readable mode) |
| `ora` | Spinner for long-running operations |
| `uuid` | RFC 4122 UUID generation for entry IDs |

### Dev Dependencies

| Package | Purpose |
|---------|---------|
| `typescript` | Compiler |
| `ts-jest` | Jest TypeScript transform — no separate compile step for tests |
| `jest` | Test framework and runner |
| `@types/jest` | Jest type definitions |
| `@types/node` | Node.js type definitions |
| `eslint` | Linter (v9, flat config) |
| `typescript-eslint` | TypeScript-aware ESLint rules (replaces legacy `@typescript-eslint/*`) |
| `eslint-config-prettier` | Disables ESLint rules that conflict with Prettier |
| `prettier` | Opinionated code formatter |
| `husky` | Git hooks (pre-commit lint + format) |
| `lint-staged` | Run linters only on staged files |
| `@types/uuid` | UUID type definitions |

---

## 3. Architecture Patterns

### System Architecture (v1.0 — Implemented)

```
CLI Entry (src/index.ts)
    └── Commander root program
        ├── commands/setup.ts      → SetupCommand (init / show / validate)
        ├── commands/write.ts      → WriteCommand (with duplicate detection)
        ├── commands/search.ts     → SearchCommand (semantic + pre-filters)
        └── commands/list.ts       → ListCommand (chronological + date range)

lib/
  ├── qdrant.ts            → QdrantRepository (collection mgmt, upsert, search, scroll)
  ├── embeddings.ts        → EmbeddingsAdapter interface + factory
  ├── config.ts            → Config loader (memo.config.json + env)
  ├── registry.ts          → Related-repo resolution for cross-repo scope
  ├── output.ts            → Human/JSON output formatter (chalk, ora)
  ├── errors.ts            → Typed MemoError hierarchy + exit codes
  ├── dedupe.ts            → Deduplication key generation + merge strategies
  ├── search-filters.ts    → Qdrant pre-filter builder for search
  ├── list-filters.ts      → Qdrant pre-filter builder for list (with date range)
  ├── retry.ts             → Generic exponential backoff retry wrapper
  └── debug.ts             → Conditional debug logging to stderr

adapters/
  └── openai-embeddings.ts → OpenAI text-embedding-3-small provider

types/
  ├── entry.ts             → EntryPayload Zod schema + TypeScript type
  ├── config.ts            → MemoConfig Zod schema + TypeScript type
  └── cli.ts               → Shared CLI flag interfaces (placeholder)
```

> **Note:** `ask.ts`, `scan.ts`, `llm.ts`, `telemetry.ts`, and additional embedding adapters (Voyage, Cohere, Ollama) are planned for future phases and are not implemented in v1.0.

### Key Patterns

| Pattern | Where Applied | Rationale |
|---------|--------------|-----------|
| **Adapter** | `lib/embeddings.ts`, `lib/llm.ts` | Swap providers without changing commands |
| **Repository** | `lib/qdrant.ts` | Isolate all Qdrant operations; commands never call Qdrant directly |
| **Command** | `src/commands/*` | Each command is an independent module with a single `run()` function |
| **Config object** | `lib/config.ts` | Single resolved config passed through; no global state |

### No Global State

Commands receive all dependencies (config, repo client, embeddings adapter) via function arguments or constructor injection. No module-level singletons except the Commander root program.

---

## 4. API Design Standards

### CLI Interface

- Use Commander.js `program.command()` for each subcommand.
- All flags use `--kebab-case`.
- Positional arguments are used only for the primary input (e.g., query string); everything else is a named flag.
- Boolean flags use the `--flag` / `--no-flag` pair pattern where the default matters.

### Output Modes

| Mode | Trigger | Format |
|------|---------|--------|
| **Human** | Default | Colored, formatted text via `chalk`; spinners via `ora` |
| **Machine** | `--json` flag | Newline-delimited JSON or single JSON object; no ANSI codes |

### Human Output Color Policy

When output is not `--json`, CLI responses should use a consistent semantic color palette for fast visual parsing:

| Semantic role | Color (chalk) | Example |
|---------------|----------------|---------|
| Success | `green` | Entry written, operation complete |
| Warning | `yellow` | Partial results, fallback config used |
| Error | `red` | Validation failure, API/network failure |
| Info | `cyan` | Query scope, selected repo, progress notes |
| Metadata labels | `gray` | `repo`, `tags`, `confidence`, `timestamp` |
| Emphasis | `bold` (plus semantic color) | Primary action/result line |

Rules:
- Colors are enabled only in human mode; `--json` output must be plain JSON with no ANSI escape codes.
- Respect terminal capabilities: disable colors when `NO_COLOR` is set or when output is not a TTY.
- Do not rely on color alone to convey meaning; always include explicit text labels (`ERROR`, `WARNING`, `SUCCESS`).
- Keep palette stable across commands so agents and humans can predict output structure.

```typescript
// lib/output.ts — usage pattern
output.result(data, { json: flags.json });
output.error(err, { json: flags.json });
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | User error (bad input, missing config, not found) |
| `2` | System error (Qdrant unreachable, embeddings API error) |

All errors must produce a message to `stderr`. JSON mode must output `{ "error": "...", "code": "..." }` to `stderr`.

### Error Catalog

The MVP error hierarchy should use a small, stable set of machine-readable codes:

| Error code | Exit code | Meaning |
|------------|-----------|---------|
| `CONFIG_NOT_FOUND` | `1` | Local `memo.config.json` is missing in a command that requires repo context |
| `CONFIG_INVALID` | `1` | `memo.config.json` exists but fails schema validation |
| `MISSING_CREDENTIAL` | `1` | Required environment variable is absent |
| `VALIDATION_FAILED` | `1` | CLI input or payload validation failed |
| `REPO_CONTEXT_UNRESOLVED` | `1` | Repo/org defaults could not be resolved from config or flags |
| `ENTRY_NOT_FOUND` | `1` | Lookup returned no matching entry when a concrete result was required |
| `QDRANT_UNREACHABLE` | `2` | Qdrant is unavailable or network connectivity failed |
| `QDRANT_OPERATION_FAILED` | `2` | Qdrant responded but the operation could not be completed |
| `EMBEDDING_API_ERROR` | `2` | Embeddings provider call failed |
| `COLLECTION_BOOTSTRAP_FAILED` | `2` | First-run auto-creation or index creation for `decisions` failed |
| `UNEXPECTED_ERROR` | `2` | Fallback for uncategorized runtime failures |

`MemoError` should carry `code`, `exitCode`, and a human-readable message. Unknown exceptions are wrapped as `UNEXPECTED_ERROR`.

### Streaming / Long Operations

Long operations (scan, bulk write) must show progress in human mode (spinner + count). In `--json` mode, emit a final JSON summary only.

---

## 5. Authentication & Authorization

### Scope

Memo has no authentication layer of its own. Access control is delegated entirely to the infrastructure:
- **Qdrant:** access controlled by `QDRANT_API_KEY` and the Qdrant instance's own auth.
- **Embeddings API:** controlled by `EMBEDDINGS_API_KEY`.
- **LLM API (scan):** controlled by `LLM_API_KEY` (may be the same as `EMBEDDINGS_API_KEY` for OpenAI).

### No Multi-Tenancy in v1

The CLI operates as a single-user/single-org tool. All entries in the `decisions` collection are co-located; the `repo` and `org` fields are the logical isolation mechanism.

### Shared-Cluster Access Policy (v1)

- Memo has no internal user identity or permission model in v1.
- Configuration is repository-scoped, but any repo using Memo can read/write for any configured repo.
- Access control is enforced only at infrastructure boundaries (Qdrant credentials + network-level controls).
- Team-level RBAC/ACL is explicitly deferred beyond MVP.

---

## 6. Security Requirements

### Credential Handling

- All credentials are read exclusively from environment variables (see Section 18 for full list).
- `.env` files are supported for local development via `dotenv` but **must never be committed** (`.gitignore` must include `.env`).
- Credentials are **never** logged, echoed, or included in error messages or telemetry.
- The CLI must fail immediately with a clear error if a required credential is missing — no fallback to empty string.

### Input Handling

- Query strings passed to `memo search` and `memo ask` are passed to the embeddings API as-is; no eval or shell execution occurs.
- File paths in `memo scan --path` are resolved to absolute paths and validated to exist before processing.
- No user-supplied text is ever injected into shell commands.

### OWASP Considerations

- **Injection:** No SQL (Qdrant uses its own query language; inputs are typed, not interpolated). No shell injection.
- **Sensitive data exposure:** Credentials are never written to disk or telemetry.
- **Dependency vulnerabilities:** Dependabot enabled; `pnpm audit` runs in CI.

### `.gitignore` Requirements

```
.env
.env.*
!.env.example
dist/
node_modules/
```

---

## 7. Data & Database Guidelines

### Qdrant Collection

- **Collection name:** `decisions` (single collection for all repos/orgs)
- **Distance metric:** Cosine (appropriate for text embeddings)
- **Vector size:** 1536 (OpenAI `text-embedding-3-small`); configurable per provider
- **Payload indexing:** Index `repo`, `org`, `entry_type`, `source`, `tags`, `timestamp_utc` for compound filtered queries and chronological listing

### Collection Bootstrap

- The `decisions` collection is auto-created on first write, search, or list if it does not already exist.
- Bootstrap includes collection creation, vector configuration, and payload index creation.
- Bootstrap is idempotent: repeated checks must not fail if the collection already exists.
- If bootstrap cannot complete, fail with `COLLECTION_BOOTSTRAP_FAILED`.

### Entry Payload Schema

Enforced via Zod at write time:

```typescript
const EntryPayload = z.object({
  id:              z.string().uuid(),
  repo:            z.string().min(1),
  org:             z.string().optional(),
  domain:          z.string().optional(),
  story:           z.string().optional(),
  commit:          z.string().optional(),
  timestamp_utc:   z.string().datetime(),               // auto-generated
  files_modified:  z.array(z.string()).default([]),
  tags:            z.array(z.string()).min(2).max(5),
  relates_to:      z.array(z.string()).default([]),
  rationale:       z.string().min(1).max(5000),
  entry_type:      z.enum(['decision', 'integration_point', 'structure']),
  source:          z.enum(['agent', 'scan', 'manual']),
  confidence:      z.enum(['high', 'medium', 'low']).default('high'),
});
```

### Entry Semantics

- `entry_type` allowed values in MVP:
  - `decision`: a task or story decision written by an agent or user
  - `integration_point`: how another system or module is integrated or consumed
  - `structure`: architectural or module-level structure captured during bootstrap or documentation
- `source` semantics in MVP:
  - `agent`: normal post-task or story write
  - `manual`: human-curated or Copilot-assisted bootstrap write
  - `scan`: reserved for the future fully automated `memo scan` command
- `confidence` is not passed as a CLI flag in MVP. It is inferred by the command path:
  - `agent` writes default to `high`
  - `manual` bootstrap writes default to `medium`
  - future automated `scan` writes default to `low` unless upgraded by scan heuristics
- `relates_to` is an optional CLI input and should be provided when the decision explicitly affects or references other repositories.

### Naming Conventions

- Collection fields: `snake_case`.
- TypeScript types: `PascalCase` interfaces, `camelCase` properties (mapped at boundary).
- UUIDs are generated by the CLI at write time using `uuid` v4.

### Long Rationale Strategy

If rationale exceeds 512 tokens (~2000 characters), embed a compressed summary (`title: tags + main decision`) and store the full text in the payload. This improves search precision without losing information.

### Embedding Text Composition

- Standard write-path embedding input uses a derived string with three parts:
  1. a transient title derived from the main decision sentence,
  2. normalized tags,
  3. the full rationale text.
- This title is computed for embedding quality only and is not persisted as a payload field in MVP.
- For `memo search`, the search vector input is built from the natural-language query plus any provided `--tags` values.

### Schema Evolution Policy (Flexible + Backward-Compatible)

- Additive changes are the default (new optional fields only).
- Existing required fields in v1 payloads must remain readable in later versions.
- Readers must ignore unknown fields and preserve them during pass-through operations.
- Writers may include a `schema_version` field when introduced; absence is interpreted as `v1`.
- Dedicated migration tooling is deferred; compatibility is handled in runtime serializers/parsers.

---

## 8. Integration Methods

### Qdrant Client

- Use `@qdrant/js-client-rest` via the `QdrantRepository` wrapper (`lib/qdrant.ts`).
- All collection operations (upsert, search, scroll, delete) are encapsulated in `QdrantRepository`.
- Commands never import the Qdrant client directly.

### Search and List Semantics

- `memo search` applies exact-match conditions as Qdrant pre-filters before vector search.
- Pre-filters include `repo`, `org`/company scope, `entry_type` when later added, and `tags` when provided.
- The search vector is built from the query string plus normalized tag terms when `--tags` is present.
- Search responses in JSON mode must include all payload fields plus `similarity`.
- `memo list` uses `order_by` on indexed `timestamp_utc` in descending order.
- Date filters for `memo list` are applied as pre-filters on `timestamp_utc`.

### Embeddings Adapter

```typescript
interface EmbeddingsAdapter {
  embed(text: string): Promise<number[]>;
  readonly dimensions: number;
}
```

Supported providers (configurable via `EMBEDDINGS_PROVIDER` env var):

| Provider | Env var value | Notes |
|----------|--------------|-------|
| OpenAI (default) | `openai` | `text-embedding-3-small`, 1536 dims |
| Voyage AI | `voyage` | `voyage-code-3`, code-specialized |
| Cohere | `cohere` | `embed-v4` |
| Ollama | `ollama` | Local; requires `OLLAMA_BASE_URL` |

### LLM Adapter (scan)

```typescript
interface LLMAdapter {
  complete(prompt: string): Promise<string>;
}
```

Defaults to OpenAI `gpt-4o-mini`. Configurable via `LLM_PROVIDER` + `LLM_MODEL`.

### Retry Policy

All external API calls (Qdrant, embeddings, LLM) use exponential backoff:
- Max 3 attempts
- Base delay: 500ms, multiplier: 2x
- Retryable: 429 (rate limit), 503 (unavailable), network errors
- Non-retryable: 400 (bad request), 401 (auth error)

### Central Org Config Distribution

- MVP commands rely on a local `memo.config.json` created by `memo setup init` in each repository.
- The local config defines the repo identity and defaults used by `write`, `search`, and `list`.
- A central configuration file is expected to be HTTP-accessible in multi-repo deployments.
- Resolution order:
  1. Local `memo.config.json`
  2. Central HTTP config (if configured)
  3. Environment overrides
- Central config URL should be provided via `MEMO_CONFIG_URL` and fetched with short timeout + local cache.
- If HTTP fetch fails, CLI falls back to local config and emits a warning (error in strict mode if later enabled).

---

## 9. Code Organization & Structure

```
memo-cli/
├── src/
│   ├── index.ts                  ← CLI entry point; Commander root setup
│   ├── commands/
│   │   ├── setup.ts              ← memo setup (init / show / validate)
│   │   ├── write.ts              ← memo write (with duplicate detection)
│   │   ├── search.ts             ← memo search (semantic + pre-filters)
│   │   └── list.ts               ← memo list (chronological + date range)
│   ├── lib/
│   │   ├── qdrant.ts             ← QdrantRepository
│   │   ├── embeddings.ts         ← EmbeddingsAdapter interface + factory
│   │   ├── config.ts             ← Config loader and resolver
│   │   ├── registry.ts           ← Related-repo resolution
│   │   ├── output.ts             ← Human/JSON output formatter
│   │   ├── errors.ts             ← MemoError hierarchy + exit codes
│   │   ├── dedupe.ts             ← Deduplication key generation + merge strategies
│   │   ├── search-filters.ts     ← Qdrant pre-filter builder (search)
│   │   ├── list-filters.ts       ← Qdrant pre-filter builder (list, date range)
│   │   ├── retry.ts              ← Exponential backoff retry wrapper
│   │   └── debug.ts              ← Conditional debug logging (MEMO_DEBUG)
│   ├── adapters/
│   │   └── openai-embeddings.ts  ← OpenAI text-embedding-3-small
│   └── types/
│       ├── entry.ts              ← EntryPayload Zod schema
│       ├── config.ts             ← MemoConfig Zod schema
│       └── cli.ts                ← Shared CLI flag interfaces (placeholder)
├── scripts/
│   ├── run-jest.mjs              ← Jest argument forwarder
│   └── validate-bootstrap.ts     ← Bootstrap JSON schema validator
├── tests/
│   ├── __mocks__/                ← ESM-only package stubs (chalk, ora)
│   ├── unit/
│   │   ├── lib/
│   │   ├── adapters/
│   │   ├── commands/
│   │   └── scripts/
│   └── integration/
│       ├── commands/
│       └── lib/
├── docs/                         ← Product and technical documentation
├── workstream/                   ← Planning artifacts (PRD, spec, stories, tasks)
├── dist/                         ← Compiled output (gitignored)
├── .env.example                  ← Example credentials file (committed)
├── .env                          ← Actual credentials (gitignored)
├── .github/workflows/            ← CI + publish workflows
├── tsconfig.json
├── jest.config.ts
├── eslint.config.ts
├── .prettierrc
├── package.json
└── pnpm-lock.yaml
```

### Naming Conventions

| Artifact | Convention | Example |
|----------|------------|---------|
| Files | `kebab-case.ts` | `openai-embeddings.ts` |
| Interfaces | `PascalCase` | `EmbeddingsAdapter` |
| Classes | `PascalCase` | `QdrantRepository` |
| Functions | `camelCase` | `resolveRelatedRepos()` |
| Constants | `SCREAMING_SNAKE_CASE` | `DEFAULT_LIMIT` |
| Zod schemas | `PascalCase` (no suffix) | `EntryPayload` |
| Test files | `*.test.ts` | `qdrant.test.ts` |

---

## 10. Design Patterns & Principles

### Applied Patterns

- **Adapter** — Embeddings and LLM providers. New providers implement the interface; no changes to commands.
- **Repository** — `QdrantRepository` is the only place that knows about Qdrant's client API.
- **Command** — Each CLI subcommand is a module exporting a single `run(flags, deps)` function.
- **Factory** — `createEmbeddingsAdapter(config)` and `createLLMAdapter(config)` select implementations from config/env.

### Principles

- **YAGNI:** Do not build a plugin system, middleware pipeline, or event bus unless a concrete second use case requires it.
- **DRY:** Share retry logic, output formatting, and error handling through `lib/` utilities — not inline in commands.
- **KISS:** Commands are thin orchestrators. Business logic lives in `lib/` and `adapters/`.
- **Fail fast:** Validate credentials and config at startup before any I/O. Surface errors immediately.
- **No magic:** Avoid decorators, IoC containers, or reflection. Dependencies are passed explicitly.

---

## 11. Testing Strategy

### Framework

- **Jest** + **ts-jest** (no separate compile step; tests run directly on TypeScript).
- Config: `jest.config.ts` with `preset: 'ts-jest'`, strict `moduleNameMapper` for path aliases.

### Testing Pyramid

| Layer | Scope | Mock Strategy |
|-------|-------|---------------|
| **Unit** | `lib/`, `adapters/`, `types/` | Mock external clients with `jest.fn()` |
| **Integration** | `commands/` | Mock `QdrantRepository` and `EmbeddingsAdapter` at the boundary |
| **E2E** (manual) | Full CLI binary | Real local Qdrant + real embeddings; run before major releases |

### Coverage Targets

| Area | Target |
|------|--------|
| `lib/` | ≥ 85% |
| `adapters/` | ≥ 80% |
| `commands/` | ≥ 75% |
| Overall | ≥ 80% |

### Test File Conventions

- Co-located with source under `tests/unit/` and `tests/integration/` (mirroring `src/` structure).
- Test files: `<module-name>.test.ts`.
- Describe blocks mirror the module/function name.
- No production dependencies imported in test utilities.

### Mock Strategy

- Qdrant client mocked via a `MockQdrantRepository` implementing the same interface.
- Embeddings adapter mocked with a fixed-dimension zero vector for determinism.
- LLM adapter mocked with canned responses per test case.

### MVP Pilot: Agent-Assisted Minimal Scan Test

Before implementing full `memo scan` automation, run an initial pilot that uses Copilot to infer definitions and persists them through `memo write`.

**Pilot objective:** validate that inferred architecture definitions are writeable, searchable, and useful with minimal tooling.

**Pilot setup:**

- Target sample: 20-50 files from a single bounded module/repo.
- Input artifacts: `README`, routing/API files, schema/migrations, and `package.json`.
- Copilot prompt output format: strict JSON objects with fields `entry_type`, `tags`, `files_modified`, `rationale`, `relates_to`.

**Execution flow:**

1. Generate candidate definitions with Copilot from the selected artifacts.
2. Validate each object against a local Zod schema before writing.
3. Write entries using `memo write --json` with:
  - `source=manual`
  - `entry_type=structure` or `integration_point`
4. Run validation queries with `memo search` and assess retrieval relevance.

### JSON Output Contracts (MVP)

- `memo write --json` returns the stored entry object in full plus operation metadata:
  - all payload fields
  - `created: boolean`
  - `updated: boolean`
  - `dedupe_key_sha256`
- `memo search --json` returns:
  - `query`
  - `filters`
  - `results`, where each result includes all payload fields plus `similarity`
- `memo list --json` returns:
  - `filters`
  - `results`, where each result includes all payload fields
- Human mode may abbreviate output for readability, but JSON mode is the full machine contract.

**Initial acceptance thresholds:**

- At least 5 successful writes, 0 invalid payload writes.
- At least 80% of validation queries return relevant results in top-3.
- Total pilot runtime under 15 minutes.

If thresholds are met, proceed to full `memo scan` implementation (filesystem walker + LLM orchestration + confidence pipeline).

---

## 12. Code Quality & Standards

### TypeScript Configuration (`tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "skipLibCheck": false
  }
}
```

### ESLint Configuration

Use ESLint v9 flat config (`eslint.config.ts`) with **`typescript-eslint`** (the unified v8+ package):

```typescript
// eslint.config.ts
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: { project: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'error',   // use lib/output.ts instead
    },
  },
);
```

> **Recommendation:** `tseslint.configs.strictTypeChecked` is the strongest TypeScript-aware ruleset. It catches real bugs (unsafe returns, unchecked promise usage, type assertions). Some rules may need per-file granular disabling for tests — prefer `// eslint-disable-next-line` with a comment over file-level disables.

### Prettier Configuration (`.prettierrc`)

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

### Pre-commit Hooks

- **husky** + **lint-staged**: on pre-commit, run ESLint and Prettier only on staged files.
- Configuration in `package.json`:

```json
{
  "lint-staged": {
    "*.ts": ["eslint --fix", "prettier --write"]
  }
}
```

### No `console.log` in Production Code

All output must go through `lib/output.ts`. This enforces consistent JSON/human mode and prevents accidental leaks in agent-consumed output.

---

## 13. Deployment & DevOps

### Repository

- **GitHub:** `llipe/memo-cli`
- **Default branch:** `main`

### GitHub Actions Workflows

#### CI (`.github/workflows/ci.yml`)

Triggers: every PR to `main` and every push to `main`.

```
Steps:
  1. Setup Node.js 24 LTS
  2. Install pnpm + dependencies
  3. Type-check (tsc --noEmit)
  4. Lint (eslint .)
  5. Test (jest --coverage)
  6. Build (tsc)
  7. pnpm audit (fail on high/critical)
```

#### Publish (`.github/workflows/publish.yml`)

Triggers: push of a semver tag (`v*.*.*`).

```
Steps:
  1. Setup Node.js 24 LTS + npm registry
  2. Install + build
  3. Tests must pass
  4. npm publish --access public
```

### Versioning

- **Semantic Versioning** (`MAJOR.MINOR.PATCH`).
- v1.x: no breaking CLI interface changes. Payload schema changes are additive only.
- Tags trigger publish: `git tag v1.0.0 && git push --tags`.

### npm Package

- **Name:** `@memo-ai/cli`
- **Scope:** public
- **`bin`:** `{ "memo": "./dist/index.js" }`
- **`engines`:** `{ "node": ">=24.0.0" }`
- **Files published:** `dist/`, `README.md`, `LICENSE`

---

## 14. Monitoring, Logging & Observability

### Telemetry

Memo CLI collects **opt-in, anonymous** usage telemetry to understand adoption and command usage patterns. No PII, no query content, no credentials are ever collected.

**Telemetry is disabled by default.** It must be explicitly enabled:

```bash
memo setup telemetry enable   # writes flag to ~/.memo/telemetry.json
```

Or via environment variable (always takes precedence):

```
MEMO_TELEMETRY=true   # enable
MEMO_TELEMETRY=false  # disable (also the unset default)
```

**Events collected (when enabled):**

| Event | Properties |
|-------|-----------|
| `command_invoked` | command name, `--scope` flag, `--json` flag |
| `command_succeeded` | command name, duration_ms, result_count |
| `command_failed` | command name, error_code (no message content) |

**Transport:** Single HTTPS POST, fire-and-forget, with a 2s timeout. Never blocks the CLI result. Failures are silently swallowed.

**Implementation:** `lib/telemetry.ts` — the telemetry client wraps a simple `fetch()` POST. Commands call `telemetry.track(event, props)` after their operation completes.

### Logging

- No structured logging library. All user-facing output is via `lib/output.ts`.
- Debug mode: `MEMO_DEBUG=true` enables verbose internal logging to `stderr` (does not affect `--json` stdout).
- No log files on disk.

---

## 15. Performance & Scalability

| Target | Metric |
|--------|--------|
| CLI startup time | < 200ms (cold start, no network) |
| Embedding call | < 2s (OpenAI API) |
| Qdrant search query | < 500ms (cloud free tier) |
| `memo scan` (200 files) | < 5 min (LLM calls are the bottleneck) |
| `memo write` total | < 3s end-to-end |

### Optimization Strategies

- **Lazy command loading:** Commander registers commands lazily; only the invoked command's dependencies are initialized.
- **Batched writes in scan:** `memo scan` batches Qdrant upserts (50 entries per batch) to stay within API rate limits.
- **Token truncation:** Rationale > 512 tokens is summarized before embedding; full text is stored in payload.
- **Connection reuse:** The Qdrant client and OpenAI client are initialized once per command invocation, not per request.

---

## 16. Dependency Management

### Package Manager

- **pnpm** — `pnpm-lock.yaml` is committed and required. CI uses `pnpm install --frozen-lockfile`.
- No `npm install` or `yarn` in CI or docs; pnpm is the sole package manager.

### Version Pinning

- Production dependencies: use `^` for minor/patch updates (pnpm lockfile ensures reproducibility).
- Dev dependencies: use `^`; pin only when a specific version is required for a known compatibility issue.

### Vulnerability Scanning

- **Dependabot** enabled for npm dependencies (weekly scan).
- **`pnpm audit --audit-level=high`** runs in CI; fails the build on high or critical vulnerabilities.

---

## 17. Development Workflow

### Branching Strategy

**Trunk-based development** — the `main` branch is always deployable.

Per `github-ops` conventions:

| Branch Type | Pattern | Example |
|-------------|---------|---------|
| Feature / issue | `issue/<number>-<short-description>` | `issue/12-write-command` |
| Story | `story/<id>-<short-description>` | `story/S-003-scan-command` |
| Bug fix | `fix/<number>-<short-description>` | `fix/34-qdrant-timeout` |
| Chore | `chore/<number>-<short-description>` | `chore/5-upgrade-deps` |
| Docs | `docs/<number>-<description>` | `docs/8-readme-update` |

Rules:
- Branches are short-lived (< 3 days ideally).
- No long-lived feature branches. Break work into small PRs.
- Branch names: lowercase, hyphens only.

### Commit Convention

**Conventional Commits** per `github-ops` conventions:

```
<type>(<scope>): <description>

Types: feat | fix | chore | docs | refactor | test | ci
```

Examples:
```
feat(write): add --tags flag to memo write
fix(qdrant): handle connection timeout with retry
chore: upgrade pnpm to 9.x
```

### Pull Request Process

1. Open a **draft PR** when starting work.
2. PR must pass CI (lint + type-check + tests).
3. PR description follows the `github-ops` template (What / Why / How / Testing / Checklist).
4. At least one reviewer approval required before merge.
5. **Squash merge** preferred to keep `main` history clean.
6. PR title must follow Conventional Commits (`feat(scope): description`).
7. Include `Closes #<issue-number>` in the PR body.

### Release Process

```bash
# 1. Ensure main is green
# 2. Bump version
pnpm version patch   # or minor / major

# 3. Push tag — triggers publish workflow
git push && git push --tags
```

### Proposed Auto-Write Implementation (Post-MVP)

Auto-write is not part of MVP, but the recommended implementation path is:

1. **Local git hook path**
- Add optional helper command: `memo hooks post-commit`.
- Hook captures commit hash and file diff, asks the agent for rationale with a strict prompt template, then executes `memo write`.

2. **CI fallback path**
- GitHub Actions job runs on merged PRs and calls `memo hooks ci-write`.
- CI-generated entries use conservative metadata (`confidence=low`, tag `generated_by:ci`) when rationale quality is uncertain.

3. **Deduplication and idempotency**
- Use canonical dedupe string format:
  - `v1|<repo>|<commit>|<story_or_na>|<entry_type>|<source>`
  - `story_or_na` must be `na` when story/task ID is unavailable.
  - `repo` is lowercased and trimmed; `commit` is full SHA when available, else `na`.
- Persist a hashed key in payload for indexing and lookup:
  - `dedupe_key_sha256 = sha256(canonical_dedupe_string)`
  - also store `dedupe_key_version = "v1"`.
- Lookup strategy before write:
  1. Try exact `dedupe_key_sha256` match.
  2. If no match and commit is available, fallback query by `repo + commit + entry_type`.
  3. If still no match, create a new entry.

**Update semantics (when key exists):**

| Field | Rule |
|------|------|
| `timestamp_utc` | Update to current write time |
| `rationale` | Replace only if incoming text is longer or has higher confidence; otherwise keep existing |
| `tags` | Union, dedupe, then cap at 5 tags (prefer incoming tags first) |
| `files_modified` | Union, dedupe, preserve relative paths |
| `confidence` | Keep max confidence (`high > medium > low`) |
| `source` | Keep existing unless incoming source is `agent` and existing is `manual`/`scan` |
| `relates_to` | Union, dedupe |

- Never mutate immutable identity fields on update: `id`, `repo`, `commit` (when non-empty), `dedupe_key_sha256`, `dedupe_key_version`.
- If immutable fields conflict, do not update; create a new entry and set `supersedes=<previous_id>` when applicable.
- Updates must be idempotent: repeated writes of identical payload produce no additional semantic changes.

4. **Operational safeguards**
- Support `--dry-run`, `--json`, and `--no-write` for validation.
- All hook failures must never block commits by default; strict blocking mode can be enabled later.

---

## 18. Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QDRANT_URL` | ✅ | — | Qdrant instance URL (e.g., `https://xyz.qdrant.tech`) |
| `QDRANT_API_KEY` | ✅ for cloud | — | Qdrant API key (omit for local unauthenticated) |
| `EMBEDDINGS_PROVIDER` | — | `openai` | Provider: `openai` \| `voyage` \| `cohere` \| `ollama` |
| `EMBEDDINGS_API_KEY` | ✅ | — | API key for the embeddings provider |
| `EMBEDDINGS_MODEL` | — | Provider default | Override embeddings model name |
| `LLM_PROVIDER` | for scan | `openai` | LLM provider for `memo scan` |
| `LLM_API_KEY` | for scan | `EMBEDDINGS_API_KEY` | LLM API key (defaults to embeddings key for OpenAI) |
| `LLM_MODEL` | — | `gpt-4o-mini` | LLM model for scan analysis |
| `OLLAMA_BASE_URL` | for Ollama | `http://localhost:11434` | Ollama server base URL |
| `MEMO_TELEMETRY` | — | `false` | Enable telemetry: `true` \| `false` |
| `MEMO_DEBUG` | — | `false` | Enable verbose debug output to stderr |

All variables can be provided via a `.env` file (loaded via `dotenv` in development). In CI/CD and agent environments, inject directly into the process environment — do not use `.env` files in automated pipelines.

---

## 19. Known Constraints & Trade-offs

| Constraint | Detail | Trade-off Rationale |
|------------|--------|---------------------|
| **Qdrant free tier 1GB** | ~100K entries per org | Sufficient for multi-repo teams; paid tier if needed later |
| **Single `decisions` collection** | All repos co-located | Simpler client; `repo` field provides logical isolation |
| **No auth layer** | CLI is single-user/single-org | Multi-tenancy not in scope for v1; Qdrant handles network auth |
| **Agent writes rationale** | No post-commit hooks in v1 | System-prompt approach captures context while it's fresh |
| **Node.js 24 LTS required** | Users must upgrade | Required for native ESM, `fetch`, and performance improvements |
| **Embeddings are vendor costs** | ~$0.10/year typical usage | Cost is near-negligible; Ollama available for zero-cost local use |
| **LLM required for scan** | `memo scan` is not offline | Acceptable; scan is a one-time bootstrap operation per repo |
| **No schema migration tooling** | v1 schema is stable | Version-pinned schema; breaking changes require major version bump |
