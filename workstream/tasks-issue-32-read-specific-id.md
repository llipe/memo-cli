# Implementation Plan - Issue #32 Read Specific ID

## Relevant Files

- `src/lib/qdrant.ts` - Add/confirm repository helper to fetch one entry by ID.
- `src/commands/read.ts` - Implement `memo read --id` command logic and output paths.
- `src/index.ts` - Register the new `read` command.
- `tests/unit/commands/read.test.ts` - Unit coverage for validation and output behavior.
- `tests/unit/lib/qdrant.test.ts` - Unit coverage for `getById` repository helper.
- `tests/integration/commands/read.test.ts` - End-to-end command behavior coverage.
- `README.md` - Add command reference and usage examples for `memo read --id`.

## Tasks

- [ ] 1.0 Implement Issue #32 - https://github.com/llipe/memo-cli/issues/32: `memo read --id` read specific entry
  - [ ] 1.1 Add or confirm `getById(id: string): Promise<ScrollResult | null>` in `src/lib/qdrant.ts`
  - [ ] 1.2 Create `src/commands/read.ts` with `ReadFlags`, `ReadDeps`, and `handleRead()`
  - [ ] 1.3 Validate command flags (`--id` required) and enforce read-only behavior
  - [ ] 1.4 Implement human-readable output for a single entry, omitting empty fields
  - [ ] 1.5 Implement `--json` output returning a flat payload object
  - [ ] 1.6 Register `memo read` in `src/index.ts`
  - [ ] 1.7 Update command docs/help examples in `README.md`
  - [ ] 1.8 Verify Acceptance Criterion: found entry in human mode
  - [ ] 1.9 Verify Acceptance Criterion: found entry in JSON mode
  - [ ] 1.10 Verify Acceptance Criterion: missing `--id` returns `VALIDATION_FAILED`
  - [ ] 1.11 Verify Acceptance Criterion: unknown ID returns `ENTRY_NOT_FOUND` with exit code `1`
  - [ ] 1.12 Verify Acceptance Criterion: command works without `memo.config.json`
  - [ ] 1.13 Run Tests: `tests/unit/commands/read.test.ts`
  - [ ] 1.14 Run Tests: `tests/unit/lib/qdrant.test.ts` coverage for `getById`
  - [ ] 1.15 Run Tests: `tests/integration/commands/read.test.ts`
  - [ ] 1.16 Run Tests: `pnpm test -- --testPathPattern="read"`
