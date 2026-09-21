# Implementation Plan - Issue #75 Validate Script

## Relevant Files

- `package.json` - Add a `validate` script chaining `typecheck`, `lint`, `format:check`, `test`, and `audit`.
- `TESTING.md` - Remove the "no `validate` script" harness-defect note now that it exists.
- `README.md` - Document `pnpm run validate` alongside the other canonical scripts, if a scripts table/section exists.

## Tasks

- [ ] 1.0 Implement Issue #75 - https://github.com/llipe/memo-cli/issues/75: add `validate` script consolidating quality gates
  - [x] 1.1 Add `validate` script to `package.json` running `typecheck`, `lint`, `format:check`, `test`, `audit` in sequence, failing fast on the first failure
  - [ ] 1.2 Verify Acceptance Criterion: `pnpm run validate` exists
  - [ ] 1.3 Verify Acceptance Criterion: running it executes typecheck → lint → format:check → test → audit in order
  - [ ] 1.4 Verify Acceptance Criterion: command fails loudly (non-zero exit) if any step fails
  - [ ] 1.5 Verify Acceptance Criterion: script matches the convention defined in AGENTS.md
  - [ ] 1.6 Update `TESTING.md` to remove the now-resolved "no `validate` script" harness-defect note
  - [ ] 1.7 Update `README.md` script reference, if applicable
  - [ ] 1.8 Run Tests: `pnpm run validate` (happy path, all gates pass)
  - [ ] 1.9 Run Tests: inject a failing step (e.g. a deliberate lint violation) and confirm `pnpm run validate` exits non-zero and stops at that step
