# memo-cli v1.3.0 — Draft Release Notes

> Draft only. Tagging and publishing v1.3.0 is a separate, explicit, human-run
> decision via `scripts/release.sh`, made after PR #104 (S2-11, issue #90) is
> reviewed and merged to `main`. This file is not itself the release; it is
> the input for whoever runs the release.

## Summary

Phase 2 of PRD-004 ("Long-Lived Agent Memory") ships in this release: memory
**banks**, three **memory kinds** (`self`, `episodic`, `semantic`), **session**
tracking, and a one-call **`memo recall`** bundle. All ten Phase 2 stories
(S2-01…S2-10) plus one drift fix landed on the integration branch and are
rolled up in this release.

## What's new

- **Banks** — a memory bank (`bank` payload field) partitions the single
  Qdrant collection between the shared team knowledge base (`kb`, the
  default) and any number of private, per-agent banks. `--bank`, `MEMO_BANK`,
  and `config.bank.default` resolve in that order. `memo bank init|list|show`
  manages bank identity and lifecycle.
- **Kinds** — every entry now carries a `kind`: `self` (permanent persona,
  standing preferences, open commitments — private banks only), `episodic`
  (short-term, sequential session stream), or `semantic` (long-term
  consolidated lessons/decisions). `memo write` validates and defaults kind
  by bank (`kb` defaults to `semantic`; private banks default to `episodic`).
- **Sessions** — `--session <id>` groups episodic writes; `memo timeline
--bank x --session s-42` replays them in `seq`-then-`timestamp_utc` order,
  independent of similarity ranking.
- **Supersede** — `memo write --kind self --supersedes <id>` retires an old
  `self` entry from `recall`/`bank show` while `memo read` still returns it
  with `valid_to` set, preserving history without silent mutation.
- **`memo recall`** — one call that returns `SELF` first (every valid `self`
  entry, never trimmed away), followed by ranked episodic/semantic context,
  deduplicated across sections, trimmed to `--max-tokens`, under one
  `query_id`. Replaces the four-command manual synthesis dev-tasks agents did
  at session start.
- **`memo migrate --to-v2`** — a one-time, idempotent migration that assigns
  `bank`/`kind` to pre-Phase-2 (v1) points. `--dry-run` writes nothing; a
  real run applies the FR-2.8 default-assignment rules; running it again
  reports `scanned: 0` changes.
- **dev-tasks integration** — the `developer` prompt and `memo-cli-usage`
  skill now call `memo recall` at session start and write intent/outcome
  entries as `episodic` in the agent's own bank, tagged `--session
ISSUE-<n>`.

## Migration instructions

`memo migrate --to-v2` is required before Phase 2 features (`--bank`,
`--kind`, `--session`, `recall`, `timeline`) behave correctly against
pre-existing data. It is **not** run automatically by this release.

1. **Always dry-run first:**
   ```
   memo migrate --to-v2 --dry-run
   ```
   This writes nothing and reports exactly what would change.
2. Review the dry-run output.
3. Only after reviewing, apply for real:
   ```
   memo migrate --to-v2
   ```
4. Re-run the dry-run (or the real command) a second time to confirm
   `scanned: 0` — the migration is idempotent and safe to re-run.

**Applying this migration to the production `decisions` collection is a
separate, explicit, human-run step, not automatic as part of this release.**
Nothing in v1.3.0 runs `memo migrate` against `decisions` on your behalf —
you choose when to run it, after reading the dry-run output for your own
data.

## Quality signals

- `pnpm run validate` (typecheck, lint, format:check, test, audit): all pass.
- `pnpm test`: 1051/1051 tests, 52 suites.
- `pnpm run test:coverage`: global gate PASS — 92.15% statements / 80.35%
  branches / 89.17% functions / 93.29% lines (threshold 80/75/80/80).
  `write.ts` remains below an informal per-file target on several metrics;
  this is a known, carried-forward limitation, not a gate failure (the
  configured `jest.config.ts` threshold is global-only).
- Live relevance evaluation (`MEMO_COLLECTION=memo_eval pnpm run
eval:relevance`): **96.4%** overall top-3 hit rate (concept 100%, identifier
  100%, cross-repo 83.3%, recency 100%), matching the Phase 1 floor exactly.

## Process note carried into Phase 3+

During this exit gate, the shared `memo_eval` evaluation collection was found
to have accumulated 12 non-fixture points left behind by prior stories'
required manual-smoke-test steps (across five different stories, including
this one's own). `scripts/eval-relevance.ts` queries Qdrant with no payload
filter by design, so leftover points dilute the ranked candidate pool and can
mask (or fake) a regression. The 12 points were explicitly enumerated, user-
approved, and deleted before the number above was recorded. This is flagged
as an open process gap for Phase 3+: either establish a dedicated smoke-test
cleanup convention, or scope `eval-relevance.ts` defensively to the known
fixture id set. Not resolved in this release — tracked as a follow-up
decision, not a code change.
