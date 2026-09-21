# Implementation Plan - Issue #75 Validate Script

## Relevant Files

- `package.json` - Add a `validate` script chaining `typecheck`, `lint`, `format:check`, `test`, and `audit`.
- `TESTING.md` - Remove the "no `validate` script" harness-defect note now that it exists.
- `README.md` - Document `pnpm run validate` alongside the other canonical scripts, if a scripts table/section exists.

## Tasks

- [x] 1.0 Implement Issue #75 - https://github.com/llipe/memo-cli/issues/75: add `validate` script consolidating quality gates
  - [x] 1.1 Add `validate` script to `package.json` running `typecheck`, `lint`, `format:check`, `test`, `audit` in sequence, failing fast on the first failure
  - [x] 1.2 Verify Acceptance Criterion: `pnpm run validate` exists
  - [x] 1.3 Verify Acceptance Criterion: running it executes typecheck → lint → format:check → test → audit in order
  - [x] 1.4 Verify Acceptance Criterion: command fails loudly (non-zero exit) if any step fails
  - [x] 1.5 Verify Acceptance Criterion: script matches the convention defined in AGENTS.md
  - [x] 1.6 Update `TESTING.md` to remove the now-resolved "no `validate` script" harness-defect note
  - [x] 1.7 Update `README.md` script reference, if applicable
  - [x] 1.8 Run Tests: `pnpm run validate` — typecheck/lint/test/audit each individually confirmed passing; format:check fails only on the same ~53-60 pre-existing, unrelated files flagged throughout this repo (not introduced by this change, not reformatted here as out of scope for this issue). A fully-green end-to-end run is blocked by that pre-existing debt, not by this script.
  - [x] 1.9 Run Tests: injected a deliberate lint violation (`src/lib/errors.ts`) — confirmed `pnpm run validate` ran typecheck (pass), then failed and stopped at lint with exit code 1, never reaching format:check/test/audit. File restored, verified clean (`git status` shows no diff).
