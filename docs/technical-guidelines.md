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

### System Architecture

```
CLI Entry (src/index.ts)
    └── Commander root program
        ├── commands/write.ts      → WriteCommand
        ├── commands/search.ts     → SearchCommand
        ├── commands/ask.ts        → AskCommand
        ├── commands/list.ts       → ListCommand
        ├── commands/scan.ts       → ScanCommand
        └── commands/setup.ts     → SetupCommand

lib/
  ├── qdrant.ts          → QdrantRepository (all Qdrant I/O)
  ├── embeddings.ts      → EmbeddingsAdapter interface + factory
  ├── llm.ts             → LLMAdapter interface + factory (for scan)
  ├── config.ts          → Config loader (memo.config.json + env)
  ├── registry.ts        → Related-repo resolution
  ├── output.ts          → Human/JSON output formatter
  ├── telemetry.ts       → Opt-in telemetry client
  └── errors.ts          → Typed error hierarchy + exit codes
```

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
- **Payload indexing:** Index `repo`, `org`, `entry_type`, `source`, `tags` for compound filtered queries

### Entry Payload Schema

Enforced via Zod at write time:

```typescript
const EntryPayload = z.object({
  id:              z.string().uuid(),
  repo:            z.string().min(1),
  org:             z.string().optional(),
  domain:          z.string().optional(),
  team:            z.string().optional(),
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

### Naming Conventions

- Collection fields: `snake_case`.
- TypeScript types: `PascalCase` interfaces, `camelCase` properties (mapped at boundary).
- UUIDs are generated by the CLI at write time using `uuid` v4.

### Long Rationale Strategy

If rationale exceeds 512 tokens (~2000 characters), embed a compressed summary (`title: tags + main decision`) and store the full text in the payload. This improves search precision without losing information.

---

## 8. Integration Methods

### Qdrant Client

- Use `@qdrant/js-client-rest` via the `QdrantRepository` wrapper (`lib/qdrant.ts`).
- All collection operations (upsert, search, scroll, delete) are encapsulated in `QdrantRepository`.
- Commands never import the Qdrant client directly.

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

---

## 9. Code Organization & Structure

```
memo-cli/
├── src/
│   ├── index.ts                  ← CLI entry point; Commander root setup
│   ├── commands/
│   │   ├── write.ts
│   │   ├── search.ts
│   │   ├── ask.ts
│   │   ├── list.ts
│   │   ├── scan.ts
│   │   └── setup.ts
│   ├── lib/
│   │   ├── qdrant.ts             ← QdrantRepository
│   │   ├── embeddings.ts         ← EmbeddingsAdapter interface + factory
│   │   ├── llm.ts                ← LLMAdapter interface + factory
│   │   ├── config.ts             ← Config loader and resolver
│   │   ├── registry.ts           ← Related-repo resolution
│   │   ├── output.ts             ← Human/JSON output formatter
│   │   ├── telemetry.ts          ← Opt-in telemetry client
│   │   └── errors.ts             ← MemoError hierarchy + exit codes
│   ├── adapters/
│   │   ├── openai-embeddings.ts
│   │   ├── voyage-embeddings.ts
│   │   ├── cohere-embeddings.ts
│   │   ├── ollama-embeddings.ts
│   │   └── openai-llm.ts
│   └── types/
│       ├── entry.ts              ← EntryPayload, EntryType, Source, Confidence
│       ├── config.ts             ← MemoConfig, RepoConfig
│       └── cli.ts                ← Shared CLI flag interfaces
├── tests/
│   ├── unit/
│   │   ├── lib/
│   │   └── adapters/
│   └── integration/
│       └── commands/
├── dist/                         ← Compiled output (gitignored)
├── memo.config.json              ← Local repo registry (committed)
├── .env.example                  ← Example credentials file (committed)
├── .env                          ← Actual credentials (gitignored)
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
