# Implementation Plan - Issue #77 Release Script

## Relevant Files

- `scripts/release.sh` - New: automates version bump, annotated tag creation, and push to `main` + `release` for issue #77.
- `README.md` - Update the Release Process section to reference `scripts/release.sh` instead of the fully manual step list.
- `package.json` - Optional thin wrapper (`"release": "bash scripts/release.sh"`) per `deploy-ops`'s documented convention for JS/TS repos.

## Tasks

- [x] 1.0 Implement Issue #77 - https://github.com/llipe/memo-cli/issues/77: add `scripts/release.sh`
  - [x] 1.1 Scaffold `scripts/release.sh`: shebang, `set -euo pipefail`, `--help` text, arg parsing (`--dry-run`, `--bump <patch|minor|major>`, `--help`)
  - [x] 1.2 Implement the human-only guard: refuse (exit 2) on the mutating path when stdin is not a TTY, or when `CI` is set without `INFRA_HUMAN_APPROVED=1`; `--dry-run` is exempt
  - [x] 1.3 Implement preflight checks: repo root detection, clean working tree, on `main`, `main` in sync with `origin/main` (fetch + compare) — refuse (exit 2) on any failure
  - [x] 1.4 Implement the quality gate step: run `pnpm run validate`, never skippable by any flag; a failure blocks (exit 1)
  - [x] 1.5 Implement bump-type detection from Conventional Commits since the last `v*` tag (BREAKING CHANGE/`!` → major, `feat` → minor, else patch), with interactive confirmation; `--bump` overrides/skips the prompt. Confirmation is skipped entirely (not just non-blocking) in `--dry-run` mode — a real bug found during testing where dry-run without `--bump` hung on `read` with no stdin was fixed by moving the interactive prompt so it never runs in dry-run mode.
  - [x] 1.6 Implement `--dry-run` mode: print the full plan (current version, target version, tag name, branches to push) and exit 0 without any mutation
  - [x] 1.7 Implement the real mutating path: `npm version <bump> -m "chore(release): v%s"` (creates commit + annotated tag), `git push origin main --follow-tags`, then `git push origin main:release --force-with-lease`
  - [x] 1.8 Print a clear success summary noting that `publish.yml` will now run in CI to publish to npm via provenance
  - [x] 1.9 Verify Acceptance Criterion: `--help` prints usage and exits 0 — confirmed directly
  - [x] 1.10 Verify Acceptance Criterion: `--dry-run` runs the full plan and exits 0 without mutating — verified via an isolated `git worktree` on real `main` (no version/tag/push changes occurred; confirmed via `git log`/`git tag`/`package.json` before and after)
  - [x] 1.11 Verify Acceptance Criterion: preflight refuses correctly on wrong branch (confirmed directly) and on a dirty/untracked tree (confirmed via worktree test); sync check verified by code review + a temporary local-only test commit in the worktree that correctly triggered the block once reset away
  - [x] 1.12 Verify Acceptance Criterion: quality gate runs and is never skippable — confirmed `pnpm run validate` executes and blocks progress until it passes; no flag exists to skip it
  - [x] 1.13 Verify Acceptance Criterion: bump-type suggestion (tested against 5 representative commit-message cases: fix-only→patch, feat-present→minor, `feat!:`→major, `BREAKING CHANGE` footer→major, no commits→patch) and `--bump patch|minor|major` overrides — all verified correct, including target-version arithmetic
  - [x] 1.14 Verify Acceptance Criterion: non-dry-run mutating path self-blocks (exit 2) in a non-interactive context (no TTY) and under `CI=true` without `INFRA_HUMAN_APPROVED=1` — both confirmed directly, including that setting `INFRA_HUMAN_APPROVED=1` alone still correctly blocks on the separate no-TTY check (defense in depth)
  - [x] 1.15 Update `README.md`'s Release Process section to reference `scripts/release.sh`
  - [x] 1.16 Add `"release": "bash scripts/release.sh"` wrapper to `package.json` scripts
  - [x] 1.17 Run Tests: `scripts/release.sh --help` — exit 0, usage printed
  - [x] 1.18 Run Tests: `scripts/release.sh --dry-run` (and with `--bump minor`/`--bump major` overrides) — all correct, no mutation
  - [x] 1.19 Run Tests: attempted the real mutating path from this non-interactive context — confirmed it self-blocks with exit 2 at the human-only guard, before ever reaching preflight, `npm version`, or any push
  - [x] 1.20 Run Tests: `pnpm run validate` (full repo quality gate)
