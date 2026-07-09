# Implementation Plan - Issue #32 Read Specific ID

## Relevant Files

- `src/lib/qdrant.ts` - Add/confirm repository helper to fetch one entry by ID.
- `src/commands/read.ts` - Implement `memo read --id` command logic and output paths.
- `src/index.ts` - Register the new `read` command.
- `tests/unit/commands/read.test.ts` - Unit coverage for validation and output behavior.
- `tests/unit/lib/qdrant.test.ts` - Unit coverage for `getById` repository helper.
- `tests/integration/commands/read.test.ts` - End-to-end command behavior coverage.
- `README.md` - Add command reference and usage examples for `memo read --id`.
- `docs/system-overview.md` - Add `memo read` to command inventory and read flow.
- `docs/technical-guidelines.md` - Include `commands/read.ts` in architecture and command surface.
- `docs/product-context.md` - Record issue #32 as delivered capability.
- `docs/adr/ADR-002-document-read-command-in-canonical-docs.md` - ADR documenting canonical docs parity update.

## Tasks

- [x] 1.0 Implement Issue #32 - https://github.com/llipe/memo-cli/issues/32: `memo read --id` read specific entry
  - [x] 1.1 Add or confirm `getById(id: string): Promise<ScrollResult | null>` in `src/lib/qdrant.ts`
  - [x] 1.2 Create `src/commands/read.ts` with `ReadFlags`, `ReadDeps`, and `handleRead()`
  - [x] 1.3 Validate command flags (`--id` required) and enforce read-only behavior
  - [x] 1.4 Implement human-readable output for a single entry, omitting empty fields
  - [x] 1.5 Implement `--json` output returning a flat payload object
  - [x] 1.6 Register `memo read` in `src/index.ts`
  - [x] 1.7 Update command docs/help examples in `README.md`
  - [x] 1.8 Verify Acceptance Criterion: found entry in human mode
  - [x] 1.9 Verify Acceptance Criterion: found entry in JSON mode
  - [x] 1.10 Verify Acceptance Criterion: missing `--id` returns `VALIDATION_FAILED`
  - [x] 1.11 Verify Acceptance Criterion: unknown ID returns `ENTRY_NOT_FOUND` with exit code `1`
  - [x] 1.12 Verify Acceptance Criterion: command works without `memo.config.json`
  - [x] 1.13 Run Tests: `tests/unit/commands/read.test.ts`
  - [x] 1.14 Run Tests: `tests/unit/lib/qdrant.test.ts` coverage for `getById`
  - [x] 1.15 Run Tests: `tests/integration/commands/read.test.ts`
  - [x] 1.16 Run Tests: `pnpm test -- --testPathPattern="read"`
