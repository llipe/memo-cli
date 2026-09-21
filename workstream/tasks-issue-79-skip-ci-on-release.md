# Implementation Plan - Issue #79 Skip Redundant CI Run on Release Branch

## Relevant Files

- `.github/workflows/ci.yml` - Excludes `release`/`release/**` from the push trigger.

## Tasks

- [x] 1.0 Implement Issue #79 - https://github.com/llipe/memo-cli/issues/79: skip redundant CI run on release branch push
  - [x] 1.1 Change `ci.yml`'s push trigger from `branches: ['**']` to `branches-ignore: ['release', 'release/**']`
  - [x] 1.2 Verify Acceptance Criterion: `publish.yml`'s trigger on `release`/`release/**` untouched (confirmed via `git diff`, zero changes to that file)
  - [x] 1.3 Verify Acceptance Criterion: YAML syntax valid (prettier --check passes; prettier fails on invalid YAML)
  - [x] 1.4 Verify Acceptance Criterion: push to `main` and other branches still triggers `ci.yml` — `branches-ignore` matches everything except the two excluded patterns, confirmed by reading GitHub Actions' documented semantics (mutually exclusive with `branches`, correctly used here)
  - [x] 1.5 Run Tests: `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm audit` (full local gate; format:check covered separately on touched files)
