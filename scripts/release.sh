#!/usr/bin/env bash
#
# scripts/release.sh — version bump, annotated release tag, and release-branch push.
#
# Automates the local/git-side portion of memo-cli's release process. Publishing
# to npm itself happens in CI (.github/workflows/publish.yml) via GitHub OIDC
# provenance, triggered when this script pushes the `release` branch — this
# script never runs `npm publish` itself.
#
# Usage:
#   scripts/release.sh [--dry-run] [--bump patch|minor|major] [--help]
#
# Exit codes:
#   0  success (including a completed --dry-run)
#   1  a quality gate or command failed
#   2  blocked by a precondition (dirty tree, wrong branch, non-interactive
#      invocation, CI without INFRA_HUMAN_APPROVED=1, etc.)

set -euo pipefail

DRY_RUN=0
BUMP=""

usage() {
  cat <<'EOF'
Usage: scripts/release.sh [--dry-run] [--bump patch|minor|major] [--help]

Automates the version bump, annotated release tag, and push steps of the
release process. Publishing to npm happens separately, in CI, via
.github/workflows/publish.yml (GitHub OIDC provenance) — this script never
runs `npm publish` itself.

Options:
  --dry-run           Print the release plan without changing anything.
                      No commit, no release tag, no push.
  --bump <type>       Force the version bump type (patch|minor|major),
                      skipping the interactive prompt.
  --help, -h          Show this help and exit.

Exit codes:
  0  success
  1  a quality gate or command failed
  2  blocked by a precondition (dirty tree, wrong branch, non-interactive
     invocation, CI without INFRA_HUMAN_APPROVED=1, etc.)

This script requires an interactive terminal (a human running it directly)
for any mutating run. Set CI=1 and INFRA_HUMAN_APPROVED=1 only from a
protected-environment CI job explicitly approved by a human for this exact
purpose.
EOF
}

log() { printf '%s\n' "$*"; }
err() { printf 'error: %s\n' "$*" >&2; }
block() {
  printf 'blocked: %s\n' "$*" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --bump)
      [ $# -ge 2 ] || {
        err "--bump requires an argument (patch|minor|major)"
        exit 1
      }
      BUMP="$2"
      shift 2
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    *)
      err "unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [ -n "$BUMP" ]; then
  case "$BUMP" in
    patch | minor | major) ;;
    *)
      err "invalid --bump value: $BUMP (expected patch|minor|major)"
      exit 1
      ;;
  esac
fi

# --- Human-only guard --------------------------------------------------------
# release.sh never mutates unless a human is driving it interactively, or an
# explicitly-approved protected-environment CI job set INFRA_HUMAN_APPROVED=1.
# --dry-run is exempt so the plan can be inspected from any context, including
# CI and automated/agent sessions.
if [ "$DRY_RUN" -eq 0 ]; then
  if [ -n "${CI:-}" ] && [ "${INFRA_HUMAN_APPROVED:-}" != "1" ]; then
    block "CI is set without INFRA_HUMAN_APPROVED=1 — refusing to run the mutating release path in CI without explicit human approval. Re-run with --dry-run, or set INFRA_HUMAN_APPROVED=1 only from an approved, protected-environment job."
  fi
  if [ ! -t 0 ]; then
    block "stdin is not a terminal — refusing to run the mutating release path in a non-interactive context (this includes automated/agent invocations). Re-run with --dry-run, or run this script directly in your own terminal."
  fi
fi

# --- Preflight ----------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

[ -f package.json ] && [ -e .git ] || block "must be run from the memo-cli repository root"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$CURRENT_BRANCH" = "main" ] || block "must be run on 'main' (currently on '$CURRENT_BRANCH')"

if [ -n "$(git status --porcelain)" ]; then
  block "working tree is not clean — commit, stash, or discard changes first"
fi

git fetch origin main --quiet
LOCAL_MAIN="$(git rev-parse main)"
REMOTE_MAIN="$(git rev-parse origin/main)"
[ "$LOCAL_MAIN" = "$REMOTE_MAIN" ] \
  || block "local 'main' ($LOCAL_MAIN) is not in sync with 'origin/main' ($REMOTE_MAIN) — pull or push first"

# --- Quality gate (never skippable) -------------------------------------------
log "==> Running the full quality gate (pnpm run validate)..."
if ! pnpm run validate; then
  err "quality gate failed — release blocked"
  exit 1
fi
log "==> Quality gate passed."

# --- Determine bump type -------------------------------------------------------
LAST_RELEASE_TAG="$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)"
if [ -n "$LAST_RELEASE_TAG" ]; then
  COMMIT_RANGE="$LAST_RELEASE_TAG..HEAD"
else
  COMMIT_RANGE="HEAD"
fi

COMMIT_SUBJECTS="$(git log "$COMMIT_RANGE" --pretty=%s 2>/dev/null || true)"
COMMIT_BODIES="$(git log "$COMMIT_RANGE" --pretty=%B 2>/dev/null || true)"

SUGGESTED="patch"
if printf '%s\n' "$COMMIT_SUBJECTS" | grep -qE '^[a-zA-Z]+(\([^)]*\))?!:' \
  || printf '%s\n' "$COMMIT_BODIES" | grep -q 'BREAKING CHANGE'; then
  SUGGESTED="major"
elif printf '%s\n' "$COMMIT_SUBJECTS" | grep -qE '^feat(\([^)]*\))?:'; then
  SUGGESTED="minor"
fi

log "==> Commits since ${LAST_RELEASE_TAG:-the beginning}:"
printf '%s\n' "$COMMIT_SUBJECTS" | sed 's/^/    - /'
log "==> Suggested bump: $SUGGESTED (Conventional Commits)"

if [ -n "$BUMP" ]; then
  FINAL_BUMP="$BUMP"
  log "==> Bump type: $FINAL_BUMP (from --bump, overriding suggestion of $SUGGESTED)"
elif [ "$DRY_RUN" -eq 1 ]; then
  # Dry run never blocks on input: show the suggestion and what a real run
  # would ask, but don't wait on stdin.
  FINAL_BUMP="$SUGGESTED"
  log "==> (dry run: would prompt to confirm this bump; pass --bump to preview a different type)"
else
  printf 'Accept suggested bump "%s"? [Y/n, or type patch/minor/major]: ' "$SUGGESTED"
  read -r REPLY
  case "$REPLY" in
    "" | y | Y | yes | YES) FINAL_BUMP="$SUGGESTED" ;;
    patch | minor | major) FINAL_BUMP="$REPLY" ;;
    *) block "unrecognized response: $REPLY" ;;
  esac
fi

CURRENT_VERSION="$(node -p "require('./package.json').version")"
IFS='.' read -r MAJOR MINOR PATCH <<<"$CURRENT_VERSION"
case "$FINAL_BUMP" in
  major) TARGET_VERSION="$((MAJOR + 1)).0.0" ;;
  minor) TARGET_VERSION="${MAJOR}.$((MINOR + 1)).0" ;;
  patch) TARGET_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
esac
RELEASE_TAG="v$TARGET_VERSION"

log ""
log "==> Release plan:"
log "    Current version   : $CURRENT_VERSION"
log "    Bump type         : $FINAL_BUMP"
log "    Target version    : $TARGET_VERSION"
log "    Release tag       : $RELEASE_TAG (annotated)"
log "    Push              : origin main --follow-tags"
log "    Release branch    : origin main:release (force-with-lease)"
log ""

if [ "$DRY_RUN" -eq 1 ]; then
  log "Dry run complete — nothing was changed. Re-run without --dry-run (from an interactive terminal) to perform the release."
  exit 0
fi

log "==> Bumping version and creating the annotated release tag $RELEASE_TAG..."
npm version "$FINAL_BUMP" -m "chore(release): v%s"

log "==> Pushing commit and release tag to origin main..."
git push origin main --follow-tags

log "==> Force-updating the release branch to trigger the CI publish workflow..."
git push origin main:release --force-with-lease

log ""
log "==> Done. Pushed $RELEASE_TAG to main and updated 'release'."
log "    CI will now run .github/workflows/publish.yml and publish to npm"
log "    via GitHub OIDC provenance. Watch it at:"
log "    https://github.com/llipe/memo-cli/actions/workflows/publish.yml"
