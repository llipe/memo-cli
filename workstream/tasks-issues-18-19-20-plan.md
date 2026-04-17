# Implementation Plan — Issues #18, #19, #20: Discovery Commands and Safe Delete

## Relevant Files

- `src/index.ts` — Register new commands (tags, inspect, delete)
- `src/commands/tags.ts` — `memo tags list` command (new)
- `src/commands/inspect.ts` — `memo inspect` command (new)
- `src/commands/delete.ts` — `memo delete` command (new)
- `src/lib/facets.ts` — Shared aggregation utility for tag/field faceting (new)
- `src/lib/qdrant.ts` — Add deleteById(), deleteByFilter() methods
- `src/lib/errors.ts` — Add ENTRY_NOT_FOUND, DELETE_FAILED error codes
- `tests/unit/lib/facets.test.ts` — Unit tests for aggregation utility (new)
- `tests/unit/commands/tags.test.ts` — Unit tests for tags command (new)
- `tests/unit/commands/inspect.test.ts` — Unit tests for inspect command (new)
- `tests/unit/commands/delete.test.ts` — Unit tests for delete command (new)
- `tests/unit/lib/qdrant.test.ts` — Extend existing unit tests for delete methods
- `tests/integration/commands/tags.test.ts` — Integration tests for tags command (new)
- `tests/integration/commands/inspect.test.ts` — Integration tests for inspect command (new)
- `tests/integration/commands/delete.test.ts` — Integration tests for delete command (new)

## Tasks

- [x] 8.0 Implement Issue #18 - https://github.com/llipe/memo-cli/issues/18: `memo tags list` command
  - [x] 8.1 Implement `src/lib/facets.ts` aggregation utility — `aggregateField()` helper using QdrantRepository scroll to collect unique values with counts for a given payload field and optional repo filter
  - [x] 8.2 Implement `src/commands/tags.ts` — `tags list` subcommand: parse flags (`--scope`, `--json`, `--sort`) → resolve repos from config → scroll + aggregate tags → format output
  - [x] 8.3 Implement human output: `Tags (N total):\n  <tag>  (<count> entries)` sorted by alpha (default) or frequency
  - [x] 8.4 Implement `--json` output: `{ tags: [{name, count}], total, scope, repos }`
  - [x] 8.5 Implement empty result path: exit 0 with "No tags found" message
  - [x] 8.6 Register `memo tags` command group and `memo tags list` subcommand in `src/index.ts`
  - [x] 8.7 Write unit tests: `tests/unit/lib/facets.test.ts` — aggregateField output with mocked scroll, sort alpha/frequency
  - [x] 8.8 Write unit tests: `tests/unit/commands/tags.test.ts` — command orchestration, `--json` output contract, empty results
  - [x] 8.9 Write integration tests: `tests/integration/commands/tags.test.ts` — full tags list run, `--scope related`, `--sort frequency`, `--json`, empty result
  - [x] 8.10 Verify Acceptance Criterion: `memo tags list` returns unique tags for current repo
  - [x] 8.11 Verify Acceptance Criterion: `--scope related` expands to include related repos
  - [x] 8.12 Verify Acceptance Criterion: `--json` outputs machine-readable format with tag counts
  - [x] 8.13 Verify Acceptance Criterion: `--sort` supports `alpha` (default) and `frequency` ordering
  - [x] 8.14 Verify Acceptance Criterion: Empty result returns exit code 0 with no-tags message
  - [x] 8.15 Run Tests: `pnpm test -- --testPathPattern="tags|facets"`

- [x] 9.0 Implement Issue #19 - https://github.com/llipe/memo-cli/issues/19: `memo inspect` command
  - [x] 9.1 Extend `src/lib/facets.ts` with `aggregateMultipleFields()` for multi-field aggregation in a single scroll pass
  - [x] 9.2 Implement `src/commands/inspect.ts` — parse flags (`--orgs`, `--repos`, `--domains`, `--json`) → scroll + aggregate org/repo/domain facets → format output
  - [x] 9.3 Implement human output: grouped by facet with name, count, and domain annotation for repos
  - [x] 9.4 Implement `--json` output: `{ orgs: [{name, count}], repos: [{name, org, domain, count}], domains: [{name, count}] }`
  - [x] 9.5 Implement individual facet flags (`--orgs`, `--repos`, `--domains`) to filter output to a single facet
  - [x] 9.6 Implement empty result path: exit 0 with "No entries found" message
  - [x] 9.7 Register `memo inspect` command in `src/index.ts`
  - [x] 9.8 Write unit tests: `tests/unit/commands/inspect.test.ts` — command orchestration, facet flag filtering, `--json` output contract, empty results
  - [x] 9.9 Write integration tests: `tests/integration/commands/inspect.test.ts` — full inspect run, facet flag combinations, `--json`, empty result
  - [x] 9.10 Verify Acceptance Criterion: `memo inspect` returns unique orgs, repos, and domains with entry counts
  - [x] 9.11 Verify Acceptance Criterion: `--orgs`, `--repos`, `--domains` flags filter output to single facet
  - [x] 9.12 Verify Acceptance Criterion: `--json` outputs machine-readable format
  - [x] 9.13 Verify Acceptance Criterion: Empty result returns exit 0 with no-entries message
  - [x] 9.14 Run Tests: `pnpm test -- --testPathPattern="inspect|facets"`

- [ ] 10.0 Implement Issue #20 - https://github.com/llipe/memo-cli/issues/20: `memo delete` command
  - [ ] 10.1 Add `ENTRY_NOT_FOUND` and `DELETE_FAILED` error codes to `MemoError` catalog in `src/lib/errors.ts`
  - [ ] 10.2 Add `deleteById(id: string): Promise<void>` to `QdrantRepository` in `src/lib/qdrant.ts`
  - [ ] 10.3 Add `deleteByFilter(filter: QdrantFilter): Promise<number>` to `QdrantRepository` in `src/lib/qdrant.ts`
  - [ ] 10.4 Implement `src/commands/delete.ts` — parse flags (`--id`, `--all-by-repo`, `--all-by-org`, `--json`, `--yes`) → validate mutual exclusion of `--id` and bulk flags → route to single or bulk delete path
  - [ ] 10.5 Implement single-entry delete: find entry by id (via scroll filter) → display info + confirmation prompt (interactive) → call `deleteById()` → output result; in json mode skip confirmation
  - [ ] 10.6 Implement bulk delete by repo: check NOT in `--json` mode → reject if json → scroll count → display count + confirmation prompt → call `deleteByFilter()` → output deleted count
  - [ ] 10.7 Implement bulk delete by org: same as by-repo but filter on `org` field
  - [ ] 10.8 Implement agent-mode guardrails: reject `--all-by-repo` or `--all-by-org` when `--json` flag is present
  - [ ] 10.9 Implement `--json` output: `{ deleted: true, id, scope, count }` for single; `{ deleted: true, scope, count }` for bulk
  - [ ] 10.10 Implement `--yes` bypass flag for interactive confirmation (interactive-only scripting use case)
  - [ ] 10.11 Register `memo delete` command in `src/index.ts` with all flag definitions (`--id`, `--all-by-repo`, `--all-by-org`, `--json`, `--yes`)
  - [ ] 10.12 Write unit tests: `tests/unit/commands/delete.test.ts` — option validation, mutual exclusion, agent-mode guardrails, confirmation flow, output payload shape, non-existent id, empty match set
  - [ ] 10.13 Extend `tests/unit/lib/qdrant.test.ts` — deleteById and deleteByFilter method contracts (mocked client)
  - [ ] 10.14 Write integration tests: `tests/integration/commands/delete.test.ts` — end-to-end single delete, bulk delete by repo, bulk delete by org, agent-mode rejection, non-existent id, empty match set, `--yes` bypass
  - [ ] 10.15 Verify Acceptance Criterion: `memo delete --id <id>` deletes exactly one entry in interactive mode
  - [ ] 10.16 Verify Acceptance Criterion: `memo delete --id <id> --json` works in agent mode and returns machine-readable result
  - [ ] 10.17 Verify Acceptance Criterion: Bulk deletion with `--json` flag is rejected with clear error
  - [ ] 10.18 Verify Acceptance Criterion: Interactive bulk deletion requires explicit confirmation before execution
  - [ ] 10.19 Verify Acceptance Criterion: Success output includes scope and deleted count
  - [ ] 10.20 Run Tests: `pnpm test -- --testPathPattern="delete"`
