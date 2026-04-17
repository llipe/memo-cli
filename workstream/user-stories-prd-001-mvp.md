# User Stories — PRD-001 Memo MVP Core Loop

## Changelog

| Version | Date       | Summary                                   | Author         |
| ------- | ---------- | ----------------------------------------- | -------------- |
| 1.0     | 2026-04-10 | Initial version                           | GitHub Copilot |
| 1.1     | 2026-04-17 | Added S-009 npm deployment workflow story | GitHub Copilot |

---

## Stories

### Story S-001: Project Setup & Development Environment

**Priority:** Critical
**Estimated Size:** S
**Dependencies:** None

#### User Story

As a developer contributing to Memo CLI,
I want a ready-to-run development environment with all tooling configured,
So that I can start implementing features without spending time on scaffolding.

#### Context

This is the foundation story — nothing else can land until the repository structure, toolchain, and environment are in place. It covers project initialization, dependency setup, CI configuration, and verification that the local environment is functional.

#### Acceptance Criteria

- [ ] `pnpm install` succeeds with a committed `pnpm-lock.yaml`.
- [ ] `pnpm run build` compiles TypeScript to `dist/` with no errors.
- [ ] `pnpm run lint` passes with zero warnings on the initial scaffold.
- [ ] `pnpm run test` runs Jest and reports a passing suite (even if empty).
- [ ] `pnpm run typecheck` (`tsc --noEmit`) completes without errors.
- [ ] `.env.example` exists with all required variables documented.
- [ ] `.gitignore` excludes `.env`, `dist/`, and `node_modules/`.
- [ ] `memo --help` is reachable after `pnpm run build`.
- [ ] GitHub Actions CI workflow exists and passes on the initial commit.
- [ ] `README.md` includes local setup instructions (install Node 24, pnpm 9, env config, build, test).

#### Business Rules

- Node.js 24 LTS and pnpm 9.x are the required toolchain versions.
- Lockfile must be committed; `npm install` and `yarn` are not used.
- No secrets in any committed file.

#### Technical Notes

- Follow folder structure from spec §4 / tech-guidelines §9.
- `tsconfig.json` must use `strict: true`, `NodeNext` module resolution.
- ESLint v9 flat config with `typescript-eslint` strict mode.
- Prettier with 2-space indent, single quotes, trailing commas.
- Husky + lint-staged pre-commit hook on `*.ts` files.
- `package.json` must include `bin: { "memo": "./dist/index.js" }` and `engines: { "node": ">=24.0.0" }`.

#### Testing Requirements

- **Unit Tests:** Not applicable for scaffolding.
- **Integration Tests:** Not applicable for scaffolding.
- **Manual Testing:** Run `pnpm install && pnpm run build && ./dist/index.js --help` from a clean checkout.
- **Edge Cases:** Verify CI passes on push to `main`.

#### Implementation Steps

1. Initialize repository with `package.json` (name `@memo-ai/cli`, scope public).
2. Install runtime dependencies: `commander`, `@qdrant/js-client-rest`, `openai`, `zod`, `dotenv`, `chalk`, `ora`, `uuid`.
3. Install dev dependencies: TypeScript, ts-jest, jest, eslint, typescript-eslint, eslint-config-prettier, prettier, husky, lint-staged, @types/\*.
4. Create `tsconfig.json` with NodeNext module resolution and strict mode.
5. Create `eslint.config.ts` using typescript-eslint strict + prettier rules.
6. Create `.prettierrc`.
7. Configure `jest.config.ts` with ts-jest preset.
8. Create `src/index.ts` as Commander root with version and `--help`.
9. Create empty command stubs: `src/commands/setup.ts`, `write.ts`, `search.ts`, `list.ts`.
10. Create empty lib stubs: `src/lib/errors.ts`, `config.ts`, `output.ts`, `qdrant.ts`, `embeddings.ts`.
11. Create `src/types/` with `entry.ts`, `config.ts`, `cli.ts`.
12. Create `.github/workflows/ci.yml` (type-check, lint, test, build, audit).
13. Create `.env.example` with `QDRANT_URL`, `QDRANT_API_KEY`, `EMBEDDINGS_API_KEY`.
14. Create `README.md` with setup instructions.
15. Validate full build and commit.

#### Files to Create/Modify

- `package.json` — package config, bin, engines, scripts
- `tsconfig.json` — TypeScript compiler options
- `eslint.config.ts` — ESLint flat config
- `.prettierrc` — Prettier config
- `jest.config.ts` — Jest config
- `src/index.ts` — CLI entry point
- `src/commands/setup.ts` — stub
- `src/commands/write.ts` — stub
- `src/commands/search.ts` — stub
- `src/commands/list.ts` — stub
- `src/lib/errors.ts` — MemoError hierarchy
- `src/lib/config.ts` — config loader stub
- `src/lib/output.ts` — output formatter stub
- `src/lib/qdrant.ts` — QdrantRepository stub
- `src/lib/embeddings.ts` — EmbeddingsAdapter interface stub
- `src/types/entry.ts` — EntryPayload type
- `src/types/config.ts` — MemoConfig type
- `src/types/cli.ts` — shared CLI flag interfaces
- `.github/workflows/ci.yml` — CI pipeline
- `.env.example` — env variable documentation
- `.gitignore` — ignore rules
- `README.md` — setup instructions
- `pnpm-lock.yaml` — committed lockfile

#### Definition of Done Checklist

- [ ] Code implemented per technical guidelines
- [ ] Unit tests written and passing
- [ ] Code reviewed and approved
- [ ] Acceptance criteria verified
- [ ] Pull Request created and merged

---

### Story S-002: `memo setup` — Repository Initialization and Config Management

**Priority:** Critical
**Estimated Size:** M
**Dependencies:** S-001

#### User Story

As a developer or agent,
I want to initialize, inspect, and validate a local Memo config for my repository,
So that all subsequent commands can infer repo context without manual repetition every time.

#### Context

`memo setup` is the prerequisite for all other commands that rely on local context. It covers three subcommands: `init` (creates `memo.config.json`), `show` (displays resolved config), and `validate` (checks config without writing).

#### Acceptance Criteria

- [ ] `memo setup init` in an empty directory creates a valid `memo.config.json` with `schema_version`, `repo`, `org`, `domain`, `relates_to`, and `defaults`.
- [ ] Interactive mode shows a config preview before writing and asks for confirmation.
- [ ] Non-interactive mode (`--repo`, `--org`, `--domain` flags) skips prompts and writes immediately.
- [ ] `--json` flag on `init` outputs the written config as JSON to stdout instead of showing the wizard.
- [ ] `memo setup init` on an existing config warns the user and prompts for overwrite confirmation.
- [ ] `memo setup show` prints the resolved effective config (human-readable and `--json`).
- [ ] `memo setup validate` exits `0` when config is valid and `1` with `CONFIG_INVALID` when invalid.
- [ ] Inline field validation: `repo`, `org`, `domain`, and `relates_to` items must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- [ ] `relates_to` must not contain duplicates or the same value as `repo`.
- [ ] Unknown keys in an existing config are preserved and ignored.

#### Business Rules

- `memo.config.json` is written to the current working directory.
- Required fields: `schema_version`, `repo`, `org`, `domain`, `relates_to`.
- `defaults` is optional; allowed keys: `entry_source`, `search_scope`.
- No credentials are written to config.

#### Technical Notes

- Interactive prompts use `chalk` colors per spec §10 interactive design table.
- Wizard renders box with `╔/╚` borders, field labels in `cyan`, defaults in `gray`.
- Preview step renders config JSON before prompting `Write memo.config.json? [Y/n]`.
- Conditional interactivity: prompts only when `process.stdout.isTTY === true` and `--json` not set.
- Git remote auto-detect: in interactive mode, attempt to read `git remote get-url origin` and derive repo name as a suggested default, shown in `gray`.
- Config I/O through `lib/config.ts`.
- `lib/errors.ts`: use `CONFIG_NOT_FOUND`, `CONFIG_INVALID` error codes.

#### Testing Requirements

- **Unit Tests:** Config schema validation (valid/invalid fields, duplicates, unknown keys); kebab-case regex; defaults validation.
- **Integration Tests:** `setup init` writes correct file; `--json` flag produces machine output; `setup validate` exits correctly on invalid config.
- **Manual Testing:** Interactive wizard on a TTY with and without git remote; non-interactive agent invocation.
- **Edge Cases:** Config already exists; `relates_to` containing `repo` value; `schema_version` mismatch; empty required fields.

#### Implementation Steps

1. Implement `MemoConfig` Zod schema in `src/types/config.ts`.
2. Implement `lib/config.ts`: `loadConfig()`, `writeConfig()`, `validateConfig()`.
3. Implement `setup init` interactive wizard with chalk colors, inline validation, and preview step.
4. Implement non-interactive path for all `init` flags.
5. Implement git remote detection for repo name suggestion.
6. Implement `setup show` — load and print effective config.
7. Implement `setup validate` — load, validate, report; exit 0/1.
8. Wire all three subcommands into `src/commands/setup.ts` and register in `src/index.ts`.
9. Write unit tests for config schema and validation rules.
10. Write integration tests for init/show/validate command behavior and JSON contracts.

#### Files to Create/Modify

- `src/types/config.ts` — `MemoConfig` Zod schema and TypeScript types
- `src/lib/config.ts` — config loader, writer, validator
- `src/lib/errors.ts` — `CONFIG_NOT_FOUND`, `CONFIG_INVALID` error codes
- `src/lib/output.ts` — interactive wizard rendering (chalk, TTY detection)
- `src/commands/setup.ts` — init/show/validate subcommands
- `src/index.ts` — register setup command
- `tests/unit/lib/config.test.ts` — schema and validation unit tests
- `tests/integration/commands/setup.test.ts` — command behavior integration tests

#### Definition of Done Checklist

- [ ] Code implemented per technical guidelines
- [ ] Unit tests written and passing
- [ ] Code reviewed and approved
- [ ] Acceptance criteria verified
- [ ] Pull Request created and merged

---

### Story S-003: Foundation Libraries — Errors, Output, Qdrant Bootstrap, Embeddings Adapter

**Priority:** Critical
**Estimated Size:** M
**Dependencies:** S-001

#### User Story

As a developer implementing Memo commands,
I want shared foundation libraries for errors, output formatting, Qdrant interaction, and embeddings,
So that all commands have consistent, reusable building blocks without duplicating infrastructure logic.

#### Context

Before `write`, `search`, and `list` can be built, the shared infrastructure they depend on must exist and be tested: typed error hierarchy, human/JSON output formatter, QdrantRepository with collection bootstrap, and the EmbeddingsAdapter with OpenAI implementation.

#### Acceptance Criteria

- [ ] `MemoError` class carries `code`, `exitCode`, and a human-readable message; unknown exceptions are wrapped as `UNEXPECTED_ERROR`.
- [ ] `lib/output.ts` renders human mode (chalk colors, semantic roles) and strict JSON mode; never mixes ANSI into JSON output.
- [ ] `NO_COLOR` and non-TTY environments disable chalk colors automatically.
- [ ] `QdrantRepository` wraps all Qdrant I/O; commands never import the Qdrant client directly.
- [ ] `ensureCollection()` creates the `decisions` collection and all payload indexes idempotently on first call.
- [ ] `ensureCollection()` fails with `COLLECTION_BOOTSTRAP_FAILED` if Qdrant is unreachable.
- [ ] `EmbeddingsAdapter` interface is defined; `OpenAIEmbeddingsAdapter` implements it using `text-embedding-3-small`.
- [ ] Retry policy (3 attempts, exponential backoff 500ms×2) applies to all Qdrant and embeddings calls.
- [ ] `MISSING_CREDENTIAL` error fires immediately when a required env var is absent.
- [ ] All error codes from the spec §6 error catalog are implemented.

#### Business Rules

- Credentials never appear in error messages or logs.
- `lib/output.ts` is the only place `console.log`/`console.error` is called; commands must not use `console` directly.
- Collection bootstrap is idempotent: repeated calls must not fail on an existing collection.

#### Technical Notes

- `MemoError` extends `Error` with `code: ErrorCode` and `exitCode: 0 | 1 | 2`.
- Process exit on unhandled errors in `src/index.ts` global catch.
- `QdrantRepository`: `lib/qdrant.ts` — methods: `ensureCollection()`, `upsert()`, `search()`, `scroll()`, `getByDedupeKey()`.
- `EmbeddingsAdapter` interface: `embed(text: string): Promise<number[]>`, `dimensions: number`.
- Factory: `createEmbeddingsAdapter(config)` reads `EMBEDDINGS_PROVIDER` env var; defaults to `openai`.
- `EMBEDDINGS_API_KEY` and `QDRANT_URL` are validated at startup before any I/O.
- `MEMO_DEBUG=true` enables verbose stderr logging without affecting stdout JSON output.

#### Testing Requirements

- **Unit Tests:** `MemoError` wrapping; error code coverage; output.ts human vs JSON mode; chalk disabled when `NO_COLOR`; embeddings adapter mock interface compliance.
- **Integration Tests:** `ensureCollection` creates collection on fresh Qdrant; idempotent on repeat; `COLLECTION_BOOTSTRAP_FAILED` on unavailable Qdrant.
- **Manual Testing:** Verify `MEMO_DEBUG=true` output; verify `NO_COLOR` disables chalk.
- **Edge Cases:** Missing `EMBEDDINGS_API_KEY`; `QDRANT_URL` pointing to unreachable host; unknown error wrapping.

#### Implementation Steps

1. Implement full `MemoError` class and all error codes in `src/lib/errors.ts`.
2. Add global error handler in `src/index.ts` that maps `MemoError` to correct exit code.
3. Implement `lib/output.ts` with `result()`, `error()`, `info()`, `warn()` methods; respect `--json` and `NO_COLOR`.
4. Implement `QdrantRepository` in `lib/qdrant.ts` with `ensureCollection()`, `upsert()`, `search()`, `scroll()`, `getByDedupeKey()`.
5. Implement retry helper in `lib/qdrant.ts` or shared `lib/retry.ts`.
6. Implement `EmbeddingsAdapter` interface in `lib/embeddings.ts`.
7. Implement `OpenAIEmbeddingsAdapter` in `src/adapters/openai-embeddings.ts`.
8. Implement `createEmbeddingsAdapter()` factory.
9. Add credential validation at adapter construction time.
10. Write unit tests for errors and output module.
11. Write integration tests for QdrantRepository bootstrap and adapter interface compliance.

#### Files to Create/Modify

- `src/lib/errors.ts` — full `MemoError` hierarchy and error catalog
- `src/lib/output.ts` — human/JSON formatter
- `src/lib/qdrant.ts` — `QdrantRepository`
- `src/lib/embeddings.ts` — `EmbeddingsAdapter` interface + factory
- `src/adapters/openai-embeddings.ts` — OpenAI implementation
- `src/index.ts` — global error handler
- `tests/unit/lib/errors.test.ts`
- `tests/unit/lib/output.test.ts`
- `tests/unit/lib/qdrant.test.ts`
- `tests/unit/adapters/openai-embeddings.test.ts`
- `tests/integration/lib/qdrant.test.ts`

#### Definition of Done Checklist

- [ ] Code implemented per technical guidelines
- [ ] Unit tests written and passing
- [ ] Code reviewed and approved
- [ ] Acceptance criteria verified
- [ ] Pull Request created and merged

---

### Story S-004: `memo write` — Decision Capture with Duplicate Detection

**Priority:** Critical
**Estimated Size:** L
**Dependencies:** S-002, S-003

#### User Story

As an AI agent or developer,
I want to write a decision entry with minimal required flags and have the system detect duplicates before persisting,
So that I can capture rationale at task completion time without creating noise from repeated writes across sessions.

#### Context

`memo write` is the core write path — the most frequently used command in the agent post-task loop. It validates inputs, generates a dedupe key, checks for existing entries, embeds the rationale, and upserts to Qdrant. Duplicate resolution (consolidate/update/replace/create-new) is the most complex behavior in this command.

#### Acceptance Criteria

- [ ] `memo write --rationale "..." --tags "tag1,tag2"` succeeds using repo/org/domain from local config.
- [ ] `--repo`, `--org`, `--domain` flags override config values.
- [ ] `--entry-type` accepts `decision`, `integration_point`, `structure`; defaults to `decision`.
- [ ] `--source` accepts `agent`, `manual`; defaults to `agent`.
- [ ] `--confidence` flag is rejected with a clear error if supplied.
- [ ] `confidence` is inferred: `agent→high`, `manual→medium`.
- [ ] `--story`, `--commit`, `--files`, `--relates-to` are all optional and persisted when provided.
- [ ] A `dedupe_key_sha256` is computed from `v1|repo|commit|story_or_na|entry_type|source` and stored.
- [ ] On duplicate detected: human mode shows the interactive resolution menu; agent mode (`--json`) returns `VALIDATION_FAILED` with action options listed.
- [ ] `--on-duplicate consolidate|update|replace|create-new` skips interactive prompt and applies the action directly.
- [ ] `memo write --json` returns full entry payload plus `created`, `updated`, `duplicate_detected`.
- [ ] `memo write` auto-creates the `decisions` collection if it does not exist.
- [ ] Tags array must contain 2–5 items; Zod validation rejects shorter/longer.
- [ ] Rationale must be non-empty and ≤ 5000 characters.
- [ ] `repo` context fails with `REPO_CONTEXT_UNRESOLVED` when no config and no explicit `--repo` flag.

#### Business Rules

- `confidence` is never a CLI flag; it is inferred from `source`.
- Dedupe key is computed before any I/O; lookup runs before embedding.
- Consolidate: union tags, files, relates_to; keep max confidence; keep longer/higher-confidence rationale.
- Update: patch metadata only; immutable fields (`id`, `repo`, `commit`, `dedupe_key_sha256`) never change.
- Replace: create new entry, keep old for auditability.
- Create-new: persist independently regardless of duplicate.

#### Technical Notes

- `dedupe_key_version = "v1"`, canonical string: `v1|<repo>|<commit>|<story_or_na>|<entry_type>|<source>`.
- `story_or_na` = story value if provided, else `"na"`.
- `commit` = full SHA if provided, else `"na"`.
- Embed text composition: `<title derived from first sentence of rationale>\n<normalized tags>\n<rationale>`.
- Interactive duplicate menu: use `chalk` color scheme from spec §10; `↑/↓` navigation; `Enter` to confirm.
- TTY guard: interactive prompt only when `process.stdout.isTTY === true && !flags.json`.
- `ora` spinner during embed + upsert in human mode.

#### Testing Requirements

- **Unit Tests:** Dedupe key generation; confidence inference; tag/rationale validation; consolidate/update merge logic.
- **Integration Tests:** Full write with mock Qdrant; duplicate detection flow for all four actions; `--json` contracts; `REPO_CONTEXT_UNRESOLVED` error when no config.
- **Manual Testing:** Interactive duplicate resolution menu on TTY; `--on-duplicate` flag in agent mode.
- **Edge Cases:** Write with no commit; write with no story; write when collection doesn't exist (auto-bootstrap); duplicate with higher-confidence new entry; tag count boundary (2 min, 5 max).

#### Implementation Steps

1. Implement `EntryPayload` Zod schema in `src/types/entry.ts`.
2. Implement `buildDedupeKey()` utility.
3. Implement confidence inference (`sourceToConfidence()`).
4. Implement embed text composition helper.
5. Implement duplicate resolution merge functions: `consolidate()`, `update()`, `replace()`, `createNew()`.
6. Implement interactive duplicate resolution prompt (chalk colors, keyboard navigation).
7. Implement write command orchestration: validate → dedupe lookup → resolve → embed → upsert.
8. Register `memo write` in `src/index.ts`.
9. Write unit tests for dedupe key, confidence inference, merge logic.
10. Write integration tests for write command flow and JSON contracts.

#### Files to Create/Modify

- `src/types/entry.ts` — `EntryPayload` Zod schema and types
- `src/commands/write.ts` — full write command implementation
- `src/lib/qdrant.ts` — add `getByDedupeKey()`, `upsert()` with update semantics
- `src/lib/output.ts` — interactive duplicate resolution prompt
- `src/index.ts` — register write command
- `tests/unit/commands/write.test.ts`
- `tests/unit/lib/dedupe.test.ts`
- `tests/integration/commands/write.test.ts`

#### Definition of Done Checklist

- [ ] Code implemented per technical guidelines
- [ ] Unit tests written and passing
- [ ] Code reviewed and approved
- [ ] Acceptance criteria verified
- [ ] Pull Request created and merged

---

### Story S-005: `memo search` — Semantic Search with Pre-filters

**Priority:** Critical
**Estimated Size:** M
**Dependencies:** S-003, S-004

#### User Story

As an AI agent or developer,
I want to search for relevant decisions using a natural-language query with optional pre-filters,
So that I can quickly find architectural knowledge before starting a task or designing a feature.

#### Context

`memo search` is the read path for semantic retrieval. It applies exact-match pre-filters to narrow the Qdrant candidate set before running vector search. Multi-tag filters use AND semantics. Scope expansion includes related repos when `--scope related` is active.

#### Acceptance Criteria

- [ ] `memo search "<query>"` succeeds using repo context from local config.
- [ ] Pre-filters for `repo`, `org`, `entry_type`, `source`, `tags` are applied before vector search.
- [ ] Multi-tag filtering uses AND semantics — every provided tag must be present in the result.
- [ ] `--scope related` expands the candidate repo set to include all repos in local config `relates_to`.
- [ ] `--scope repo` (default) limits results to the configured repo.
- [ ] `--entry-type` and `--source` accept comma-separated values to filter by multiple types/sources.
- [ ] `--limit` controls maximum result count (default 10).
- [ ] `memo search --json` returns `query`, `filters`, and `results` array; each result includes all payload fields plus `similarity`.
- [ ] Empty results return exit code 0 with `{ "results": [], "count": 0, "message": "..." }`.
- [ ] Human mode displays each result with score, rationale preview, and metadata labels using correct colors.
- [ ] Human mode empty results display active filters and a tip for broadening search.
- [ ] Collection is auto-bootstrapped if it does not exist before searching.

#### Business Rules

- Tag filtering is AND, not OR.
- Search query is combined with normalized tag terms when `--tags` is present.
- `similarity` value is the raw Qdrant cosine score, not normalized.
- `story` is omitted from result payload when the entry has no story.

#### Technical Notes

- Search vector: `embed(query + " " + tags.join(" "))` when `--tags` provided; `embed(query)` otherwise.
- Qdrant pre-filter structure: `must: [match repo, match tags[0], match tags[1], ...]`.
- Related scope: build filter with `should: [match repo, match related_repo_1, ...]`.
- Use `QdrantRepository.search()`.
- Human output: `cyan` for labels, `bold` for rationale lead, `gray` for metadata, similarity shown as percentage (`Math.round(score * 100)%`).

#### Testing Requirements

- **Unit Tests:** Filter builder (single repo, multi-tag AND, related scope, entry_type filter, source filter); search vector composition.
- **Integration Tests:** Search with mock repository returning results; empty results; `--json` contract; related scope expansion.
- **Manual Testing:** Run search against real Qdrant with seeded entries; verify tag AND filtering; verify related scope.
- **Edge Cases:** Query with 5 tags; `--scope related` with empty `relates_to` in config; `--limit 1`; search with no config (fallback to `--repo` flag).

#### Implementation Steps

1. Implement `buildSearchFilters()` helper covering all flag combinations.
2. Implement vector composition logic (query + tags).
3. Implement related-scope repo list resolution from config.
4. Implement `QdrantRepository.search()` method.
5. Implement search command orchestration: resolve context → build filters → embed → search → format output.
6. Implement human output for results (colors, similarity label) and empty state.
7. Register `memo search` in `src/index.ts`.
8. Write unit tests for filter builder and vector composition.
9. Write integration tests for search command.

#### Files to Create/Modify

- `src/commands/search.ts` — search command implementation
- `src/lib/qdrant.ts` — `search()` method
- `src/lib/output.ts` — search result rendering, empty state
- `src/lib/registry.ts` — related-repo resolution helper
- `src/index.ts` — register search command
- `tests/unit/commands/search.test.ts`
- `tests/unit/lib/search-filters.test.ts`
- `tests/integration/commands/search.test.ts`

#### Definition of Done Checklist

- [ ] Code implemented per technical guidelines
- [ ] Unit tests written and passing
- [ ] Code reviewed and approved
- [ ] Acceptance criteria verified
- [ ] Pull Request created and merged

---

### Story S-006: `memo list` — Chronological Entry Listing

**Priority:** High
**Estimated Size:** S
**Dependencies:** S-003, S-004

#### User Story

As a tech lead or developer,
I want to list recent Memo entries in chronological order with optional filters,
So that I can audit decisions and review what was captured recently across a repository.

#### Context

`memo list` is the chronological audit path. It uses Qdrant's `order_by` on an indexed `timestamp_utc` field, with pre-filter support for repo, org, date range, entry type, source, and scope.

#### Acceptance Criteria

- [ ] `memo list` returns entries ordered by `timestamp_utc` descending.
- [ ] `--from` and `--to` are ISO 8601 date strings applied as pre-filters on `timestamp_utc`.
- [ ] `--repo`, `--org`, `--entry-type`, `--source`, `--scope`, `--limit` flags work as described in spec.
- [ ] `--scope related` applies the same related-repo expansion as search.
- [ ] `--limit` defaults to 20.
- [ ] `memo list --json` returns `filters` and `results` array with all payload fields.
- [ ] Empty results return exit code 0 with count 0 and a message.
- [ ] Human mode displays a table-style listing with colored metadata labels and timestamps.
- [ ] Collection is auto-bootstrapped if not present.

#### Business Rules

- Default scope is `repo` (from config `defaults.search_scope` if set, else `repo`).
- Date filters are inclusive at both ends.
- `story` is omitted from result payload when not present.

#### Technical Notes

- Use `QdrantRepository.scroll()` with `order_by: { key: "timestamp_utc", direction: "desc" }`.
- Date range filter: convert `--from`/`--to` to ISO UTC strings for Qdrant range filter on `timestamp_utc`.
- Human output: one entry per line, `gray` for meta labels, `cyan` for repo, `bold` for rationale snippet.

#### Testing Requirements

- **Unit Tests:** Date range filter builder; list filter composition.
- **Integration Tests:** `memo list --json` contract; empty list; `--from`/`--to` date range; `--entry-type` filter.
- **Manual Testing:** Run list against seeded Qdrant; verify descending order.
- **Edge Cases:** `--from` > `--to`; large `--limit`; list with `--scope related` and empty `relates_to`.

#### Implementation Steps

1. Implement `QdrantRepository.scroll()` with order_by and filter support.
2. Implement `buildListFilters()` helper.
3. Implement list command orchestration: resolve context → build filters → scroll → format output.
4. Implement human output for list results and empty state.
5. Register `memo list` in `src/index.ts`.
6. Write unit tests for list filter builder.
7. Write integration tests for list command.

#### Files to Create/Modify

- `src/commands/list.ts` — list command implementation
- `src/lib/qdrant.ts` — `scroll()` with order_by support
- `src/lib/output.ts` — list result rendering
- `src/index.ts` — register list command
- `tests/unit/commands/list.test.ts`
- `tests/unit/lib/list-filters.test.ts`
- `tests/integration/commands/list.test.ts`

#### Definition of Done Checklist

- [ ] Code implemented per technical guidelines
- [ ] Unit tests written and passing
- [ ] Code reviewed and approved
- [ ] Acceptance criteria verified
- [ ] Pull Request created and merged

---

### Story S-007: Bootstrap Prompt Documentation & Validation Workflow

**Priority:** High
**Estimated Size:** S
**Dependencies:** S-004

#### User Story

As a developer onboarding an existing repository into Memo,
I want a documented guided bootstrap prompt so I can generate baseline `structure` and `integration_point` entries from existing artifacts without waiting for full scan automation,
So that the repository has useful architectural memory from day one.

#### Context

This story produces a self-contained documentation artefact and a local validation helper. The prompt template is the same one defined in the PRD (§12). The workflow instructs the user to feed selected repository artifacts to Copilot and convert the JSON output into `memo write` calls. A local Zod validator validates bootstrap JSON before writes, reducing schema corrections.

#### Acceptance Criteria

- [ ] `docs/bootstrap-guide.md` exists with the full prompt template, artifact selection guide, and worked conversion examples.
- [ ] The prompt produces valid JSON objects matching the entry payload mini-schema (`entry_type`, `tags`, `files_modified`, `rationale`, `relates_to`).
- [ ] A Zod validation script (`scripts/validate-bootstrap.ts`) accepts a JSON file path and validates each item against the bootstrap schema.
- [ ] `scripts/validate-bootstrap.ts` exits 0 when all items are valid and 1 with detailed errors when any item is invalid.
- [ ] At least 5 valid bootstrap entries can be written via `memo write --source manual --json` using the documented workflow.
- [ ] The guide includes a verification section: run `memo search` queries after bootstrap and confirm relevant results.

#### Business Rules

- Bootstrap entries always use `source=manual`; `confidence=medium` is inferred.
- Bootstrap prompt output must not include `confidence`, `title`, `score`, or extra fields.
- `relates_to` in bootstrap items is only populated when the artifact explicitly evidences a cross-repo dependency.

#### Technical Notes

- `scripts/validate-bootstrap.ts` uses the same Zod schema as the entry payload, restricted to bootstrap-relevant fields.
- Validation errors are printed with field path and expected value in human-readable format.
- No new CLI commands needed; this is a script and documentation deliverable.

#### Testing Requirements

- **Unit Tests:** Bootstrap Zod schema accepts valid items; rejects items missing required fields, wrong entry_types, tag count out of range.
- **Integration Tests:** Not applicable (documentation + script).
- **Manual Testing:** Run the full bootstrap pilot: pick a sample repo module, feed to Copilot with the prompt, validate output with script, write entries, run verification searches.
- **Edge Cases:** Bootstrap item with 1 tag; item with extra fields (`confidence`, `title`); empty `files_modified`.

#### Implementation Steps

1. Write `docs/bootstrap-guide.md` with full prompt template, artifact selection rules, conversion examples (JSON → `memo write` command), and verification queries.
2. Create bootstrap Zod schema in `scripts/validate-bootstrap.ts` (subset of EntryPayload).
3. Implement file argument parsing and validation loop in the script.
4. Implement human-readable error output.
5. Test script against valid and invalid JSON sample files.
6. Link guide from `README.md`.

#### Files to Create/Modify

- `docs/bootstrap-guide.md` — bootstrap documentation
- `scripts/validate-bootstrap.ts` — validation script
- `README.md` — add link to bootstrap guide

#### Definition of Done Checklist

- [ ] Code implemented per technical guidelines
- [ ] Unit tests written and passing
- [ ] Code reviewed and approved
- [ ] Acceptance criteria verified
- [ ] Pull Request created and merged

---

### Story S-008: First Release — Package Build, Publish, and Install Verification

**Priority:** High
**Estimated Size:** S
**Dependencies:** S-001, S-002, S-003, S-004, S-005, S-006, S-007

#### User Story

As a developer team member,
I want the CLI published to npm as `@memo-ai/cli` with a verified install path,
So that any developer or agent can install Memo globally and start using it in minutes.

#### Context

This story covers the release pipeline: build verification, version bump, npm publish workflow, and global install validation. It also includes the GitHub Actions publish workflow and a verification checklist for first-release readiness.

#### Acceptance Criteria

- [ ] `pnpm run build` produces a `dist/` folder with `dist/index.js` as the CLI entry.
- [ ] `dist/index.js` starts with `#!/usr/bin/env node` shebang.
- [ ] `npm install -g @memo-ai/cli` (or `pnpm add -g`) succeeds and makes `memo` available globally.
- [ ] `memo --version` returns the correct semver from `package.json`.
- [ ] `memo --help` lists all commands (`setup`, `write`, `search`, `list`).
- [ ] `.github/workflows/publish.yml` triggers on semver tag push and runs install + build + test + `npm publish --access public`.
- [ ] CI passes on `main` before tag is pushed.
- [ ] `npm pack` dry run produces a correct `.tgz` with only `dist/`, `README.md`, and `LICENSE`.
- [ ] `pnpm audit --audit-level=high` passes with zero high/critical findings.
- [ ] `README.md` has a "Quick Start" section covering global install and a first-run example.

#### Business Rules

- Published package name: `@memo-ai/cli`.
- Package scope: public.
- Files published: `dist/`, `README.md`, `LICENSE` (enforced via `files` field in `package.json`).
- Node.js engine constraint: `>=24.0.0`.
- Release via tag: `git tag vX.Y.Z && git push --tags`.

#### Technical Notes

- Use `pnpm version patch|minor|major` to bump version; it updates `package.json` and creates a commit + tag.
- The publish workflow uses `NODE_AUTH_TOKEN` secret for npm registry auth.
- `"files": ["dist", "README.md", "LICENSE"]` in `package.json`.
- Ensure `tsconfig.json` `outDir` is `dist` and `rootDir` is `src`.

#### Testing Requirements

- **Unit Tests:** Not applicable for release pipeline.
- **Integration Tests:** Not applicable.
- **Manual Testing:** Run `npm pack` and inspect tarball; run global install from local tarball; run `memo --version`; run `memo setup init` to confirm end-to-end.
- **Edge Cases:** Install on Node.js < 24 should fail with engine constraint error; missing `NPM_TOKEN` secret shows clear CI failure.

#### Implementation Steps

1. Finalize `package.json`: `files`, `bin`, `engines`, `version`, `publishConfig`.
2. Ensure `dist/index.js` has shebang and is executable.
3. Create `.github/workflows/publish.yml` triggered by `v*.*.*` tag push.
4. Validate `pnpm run build` produces correct output.
5. Run `npm pack --dry-run` and confirm included files.
6. Run `pnpm audit --audit-level=high`.
7. Bump to `v1.0.0`, push tag, verify publish workflow runs.
8. Install from npm registry globally and run end-to-end smoke test.
9. Update `README.md` Quick Start section with install and usage.

#### Files to Create/Modify

- `package.json` — finalize `files`, `bin`, `engines`, `publishConfig`
- `.github/workflows/publish.yml` — npm publish workflow
- `README.md` — Quick Start section
- `src/index.ts` — ensure shebang present in compiled output (add `#!/usr/bin/env node` at top)

#### Definition of Done Checklist

- [ ] Code implemented per technical guidelines
- [ ] Unit tests written and passing
- [ ] Code reviewed and approved
- [ ] Acceptance criteria verified
- [ ] Pull Request created and merged

---

### Story S-009: Automated Registry Deployment Workflow (npm)

**Priority:** High
**Estimated Size:** M
**Dependencies:** S-001, S-003, S-008

#### User Story

As a maintainer,
I want a controlled and repeatable CI/CD deployment workflow that publishes Memo CLI to npm,
So that releases are safe, validated, and auditable before users install them.

#### Context

This story formalizes release automation beyond manual first-release steps. It adds workflow gates, package integrity checks, smoke tests, and explicit rollback handling for npm publication. The goal is to prevent broken or incomplete artifacts from being published.

#### Acceptance Criteria

- [ ] A dedicated GitHub Actions release workflow exists (`.github/workflows/release.yml`) and runs only on semver tags (`vX.Y.Z`) or manual dispatch.
- [ ] The release workflow enforces `pnpm install --frozen-lockfile`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, and `pnpm run build` before publish.
- [ ] The workflow fails if `npm pack --json` shows files outside the allowed publish set (`dist/**`, `README.md`, `LICENSE`, `package.json`).
- [ ] A pre-publish smoke test installs the packed tarball in a temporary folder and validates `memo --version` and `memo --help`.
- [ ] Publish executes with `npm publish --access public --provenance` and requires `NPM_TOKEN` to be configured.
- [ ] The workflow creates a post-publish verification step that installs `@memo-ai/cli@<released-version>` and runs `memo --version`.
- [ ] The release process is documented with a rollback guide for deprecating or yanking a bad version.
- [ ] The workflow is idempotent for the same tag: if version already exists on npm, it exits with a clear message and non-zero status.

#### Business Rules

- Only signed/approved semver tags may trigger npm publication.
- Release pipeline must block publish when any validation step fails.
- Registry credentials must only come from GitHub Secrets and never be echoed in logs.
- The published artifact must be reproducible from tagged source.

#### Technical Notes

- Use Node 24 and pnpm 9 in workflow setup to match project constraints.
- Add a script check (for example in `scripts/`) to validate tarball file list and size limits.
- Smoke test should run against local `.tgz` before publish and registry package after publish.
- Configure workflow concurrency (`concurrency: release-${{ github.ref }}`) to avoid double publishes.
- Protect release with environment rules (manual approval optional for production release environment).

#### Testing Requirements

- **Unit Tests:** Validator script tests for allowed/disallowed tarball content patterns.
- **Integration Tests:** CI workflow dry-run via `workflow_dispatch` with `dry_run` input; validate gate behavior for failing lint/test/build.
- **Manual Testing:** Create a prerelease tag on a branch, run workflow, confirm artifact checks and smoke tests; verify installed binary works.
- **Edge Cases:** Existing version already published; missing `NPM_TOKEN`; corrupted `dist/`; accidental extra file in package; npm outage/retry behavior.

#### Implementation Steps

1. Create `.github/workflows/release.yml` with semver-tag trigger and optional manual dispatch.
2. Implement pre-publish validation jobs: dependency lockfile check, typecheck, lint, tests, build.
3. Add package integrity validation using `npm pack --json` and an allowlist verifier script.
4. Add local tarball smoke test job (`npm i -g ./package.tgz`, `memo --version`, `memo --help`).
5. Add guarded publish job with `npm publish --access public --provenance`.
6. Add post-publish verification job that installs the published version from npm and runs smoke commands.
7. Document release checklist and rollback procedure in project docs.
8. Add tests for the tarball validation script and verify workflow failure modes.

#### Files to Create/Modify

- `.github/workflows/release.yml` - automated release and npm publish workflow
- `scripts/validate-package-contents.ts` - tarball allowlist validator
- `tests/unit/scripts/validate-package-contents.test.ts` - validator unit tests
- `README.md` - release process and rollback notes
- `docs/system-overview.md` - CI/CD deployment flow update

#### Definition of Done Checklist

- [ ] Code implemented per technical guidelines
- [ ] Unit tests written and passing
- [ ] Code reviewed and approved
- [ ] Acceptance criteria verified
- [ ] Pull Request created and merged

---

## Coverage Validation

### Summary

- **Total PRD Requirements:** 25 functional requirements + 12 acceptance criteria + 5 business rules
- **Total User Stories:** 9
- **Coverage:** 100%
- **Status:** Complete

### Requirement Mapping

| PRD Requirement                                                                    | Story ID(s)                | Status                      |
| ---------------------------------------------------------------------------------- | -------------------------- | --------------------------- |
| FR1 — `memo setup init` scaffolds `memo.config.json`                               | S-002                      | ✅ Covered                  |
| FR2 — Interactive + non-interactive modes for setup                                | S-002                      | ✅ Covered                  |
| FR3 — Config must contain `repo`, `org`, `domain`, `relates_to`                    | S-002                      | ✅ Covered                  |
| FR4 — Config ignores unknown keys                                                  | S-002                      | ✅ Covered                  |
| FR5 — Merge local + remote config in later phases (interface only)                 | S-003                      | ✅ Covered (interface stub) |
| FR6 — MVP relies on local config as default context                                | S-002, S-004, S-005, S-006 | ✅ Covered                  |
| FR7 — `memo write` auto-creates collection and indexes                             | S-003, S-004               | ✅ Covered                  |
| FR8 — `memo write` validates inputs before embed/persist                           | S-004                      | ✅ Covered                  |
| FR9 — `memo write` supports `--relates-to`                                         | S-004                      | ✅ Covered                  |
| FR10 — `--confidence` flag not exposed                                             | S-004                      | ✅ Covered                  |
| FR11 — `confidence` inferred from source                                           | S-004                      | ✅ Covered                  |
| FR12 — Entry types: `decision`, `integration_point`, `structure`                   | S-004                      | ✅ Covered                  |
| FR13 — Source values: `agent`, `manual`, `scan` (reserved)                         | S-004                      | ✅ Covered                  |
| FR14 — `memo search` semantic vector search with tag normalization                 | S-005                      | ✅ Covered                  |
| FR15 — `memo search` applies exact-match pre-filters                               | S-005                      | ✅ Covered                  |
| FR16 — Multi-tag AND semantics                                                     | S-005                      | ✅ Covered                  |
| FR17 — `memo search` related-repo scope expansion                                  | S-005                      | ✅ Covered                  |
| FR18 — `memo list` ordered by `timestamp_utc` descending                           | S-006                      | ✅ Covered                  |
| FR19 — Storage indexes `timestamp_utc`                                             | S-003                      | ✅ Covered                  |
| FR20 — JSON responses return all payload fields                                    | S-004, S-005, S-006        | ✅ Covered                  |
| FR21 — `memo search --json` includes `similarity`                                  | S-005                      | ✅ Covered                  |
| FR22 — Empty results return success + empty array                                  | S-005, S-006               | ✅ Covered                  |
| FR23 — Human empty results echo active filters                                     | S-005, S-006               | ✅ Covered                  |
| FR24 — Documented bootstrap prompt for Copilot                                     | S-007                      | ✅ Covered                  |
| FR25 — Bootstrap supports `structure` and `integration_point` with `source=manual` | S-007                      | ✅ Covered                  |
| Setup show/validate subcommands                                                    | S-002                      | ✅ Covered                  |
| Duplicate detection + resolution                                                   | S-004                      | ✅ Covered                  |
| Dev environment setup                                                              | S-001                      | ✅ Covered                  |
| npm publish + global install                                                       | S-008, S-009               | ✅ Covered                  |

### Non-Goals Validation

- [ ] Full automated `memo scan` with filesystem walking — Confirmed NOT in any story
- [ ] `memo ask` ecosystem-level Q&A — Confirmed NOT in any story
- [ ] Remote central config authoring UX — Confirmed NOT in any story
- [ ] Team-level RBAC or multi-tenant authorization — Confirmed NOT in any story
- [ ] Additional embedding providers (Voyage, Cohere, Ollama) — Confirmed NOT in any story
- [ ] Telemetry collection — Confirmed NOT in any story
