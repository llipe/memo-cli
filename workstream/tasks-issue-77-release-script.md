# Implementation Plan - Issue #77 Release Script

## Relevant Files

- `scripts/release.sh` - New: automates version bump, annotated tag creation, and push to `main` + `release` for issue #77.
- `README.md` - Update the Release Process section to reference `scripts/release.sh` instead of the fully manual step list.
- `package.json` - Optional thin wrapper (`"release": "bash scripts/release.sh"`) per `deploy-ops`'s documented convention for JS/TS repos.

## Tasks

- [ ] 1.0 Implement Issue #77 - https://github.com/llipe/memo-cli/issues/77: add `scripts/release.sh`
  - [ ] 1.1 Scaffold `scripts/release.sh`: shebang, `set -euo pipefail`, `--help` text, arg parsing (`--dry-run`, `--bump <patch|minor|major>`, `--help`)
  - [ ] 1.2 Implement the human-only guard: refuse (exit 2) on the mutating path when stdin is not a TTY, or when `CI` is set without `INFRA_HUMAN_APPROVED=1`; `--dry-run` is exempt
  - [ ] 1.3 Implement preflight checks: repo root detection, clean working tree, on `main`, `main` in sync with `origin/main` (fetch + compare) — refuse (exit 2) on any failure
  - [ ] 1.4 Implement the quality gate step: run `pnpm run validate`, never skippable by any flag; a failure blocks (exit 1)
  - [ ] 1.5 Implement bump-type detection from Conventional Commits since the last `v*` tag (BREAKING CHANGE/`!` → major, `feat` → minor, else patch), with interactive confirmation; `--bump` overrides/skips the prompt
  - [ ] 1.6 Implement `--dry-run` mode: print the full plan (current version, target version, tag name, branches to push) and exit 0 without any mutation
  - [ ] 1.7 Implement the real mutating path: `npm version <bump> -m "chore(release): v%s"` (creates commit + annotated tag), `git push origin main --follow-tags`, then `git push origin main:release --force-with-lease`
  - [ ] 1.8 Print a clear success summary noting that `publish.yml` will now run in CI to publish to npm via provenance
  - [ ] 1.9 Verify Acceptance Criterion: `--help` prints usage and exits 0
  - [ ] 1.10 Verify Acceptance Criterion: `--dry-run` runs the full plan and exits 0 without mutating (no commit/tag/push)
  - [ ] 1.11 Verify Acceptance Criterion: preflight refuses correctly on a dirty tree / wrong branch / out-of-sync main
  - [ ] 1.12 Verify Acceptance Criterion: quality gate is never skippable and a failure blocks with exit 1
  - [ ] 1.13 Verify Acceptance Criterion: bump-type suggestion and `--bump` override both work
  - [ ] 1.14 Verify Acceptance Criterion: non-dry-run mutating path self-blocks (exit 2) in a non-interactive context and under `CI` without `INFRA_HUMAN_APPROVED=1`
  - [ ] 1.15 Update `README.md`'s Release Process section to reference `scripts/release.sh`
  - [ ] 1.16 Add `"release": "bash scripts/release.sh"` wrapper to `package.json` scripts
  - [ ] 1.17 Run Tests: `scripts/release.sh --help`
  - [ ] 1.18 Run Tests: `scripts/release.sh --dry-run` (and with `--bump minor`/`--bump major` overrides)
  - [ ] 1.19 Run Tests: attempt the real mutating path from this non-interactive context and confirm it self-blocks with exit 2, never reaching `npm version`/`git tag`/`git push`
  - [ ] 1.20 Run Tests: `pnpm run validate` (full repo quality gate)
