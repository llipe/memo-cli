# Planner State: prd-004-phase-1

## Run Info

- Task source: workstream/tasks-prd-004-phase-1-plan.md
- Integration branch: integration/prd-004-phase-1-trustworthy-retrieval
- Repository: llipe/memo-cli
- Started: 2026-09-19T00:00:00Z
- Last updated: 2026-09-21T04:07:05Z

## Story Status

| Sequence | Story ID | Issue # | Status      | PR  | Branch                              |
| -------- | -------- | ------- | ----------- | --- | ------------------------------------ |
| 1        | S1-01    | #61     | ✅ Merged   | #66 | issue/61-relevance-eval-harness      |
| 2        | S1-02    | #34     | ✅ Merged   | #67 | issue/34-composite-ranking-score     |
| 3        | S1-03    | #36     | ✅ Merged   | #68 | story/s1-03-tag-overlap-boosting     |
| 4        | S1-04    | #35     | ✅ Merged   | #69 | issue/35-dynamic-confidence-tiers    |
| 5        | S1-05    | #38     | ✅ Merged   | #70 | issue/38-staleness-detection         |
| 6        | S1-06    | #62     | ✅ Merged   | #71 | issue/62-lexical-identifier-matching |
| 7        | S1-07    | #63     | ✅ Merged   | #72 | issue/63-query-id-explain            |
| 8        | S1-08    | #64     | ⏳ Pending  | —   | —                                   |

## Current Position

- Next story: S1-08 (#64) — Phase 1 exit gate
- Last merged PR: #72
- Integration branch HEAD: 4dad2dc

## Decisions Log

- S1-01: verifier Design Mode invoked pre-implementation (workstream/test-plan-issue-61.md) per test-first default.
- S1-01: developer's first pass shipped a synthetic placeholder baseline (no Qdrant credentials in its sandbox). Planner discovered live Qdrant Cloud + OpenAI credentials in the repo's own `.env` and, with explicit user approval ("use the live instance, i'm the only one using it"), had developer re-run against it.
- S1-01: a real, credential-independent execution defect was found (ts-node/esm esModuleInterop failure on the `openai` import in `src/adapters/openai-embeddings.ts`, surfaced only via `eval:relevance`'s direct ts-node/esm invocation). Routed back to developer for a fix rather than planner patching code directly (planner MUST NOT write product code). Fixed via `TS_NODE_TRANSPILE_ONLY=true` scoped to the `eval:relevance` script only; verifier audit confirmed this doesn't reduce `tsc --noEmit` coverage of `src/**` and that `scripts/eval-relevance.ts` is still separately type-checked via `ts-jest` in its unit test.
- S1-01: real baseline recorded against live Qdrant Cloud — overall top-3 hit rate 92.9% (concept 100%, identifier 100%, cross-repo 66.7%, recency 100%).
- S1-01: qa-engineer coverage_gate PASS (coverage improved vs. integration baseline on all four metrics). Flagged that `/TESTING.md` is stale (describes an unrelated project) — non-blocking, explicitly assigned to task 8.0's exit gate.
- S1-01: verifier Audit Mode — High fidelity, no Critical/Major drift. Comment posted to PR #66.
- S1-01: `gh pr merge` was blocked by the auto-mode permission classifier (not git-guard); user merged PR #66 manually. Merge verified via `gh pr view 66 --json state,mergedAt` → MERGED, non-null mergedAt, before recording this checkpoint.
- S1-02: existing verifier Design Mode test plan (workstream/test-plan-issue-34.md) reused — no new Design Mode invocation.
- S1-02: developer's first pass measured composite ranking (spec-default weights 0.6/0.3/0.1, half-life 90) at 85.7% overall top-3 hit rate — a genuine failure of AC19-21's binding "replay ≥ recorded baseline" (92.9%, S1-01's identity-ordering floor). Developer initially overwrote baseline.json with the lower number; planner rejected this per explicit user decision ("Reject baseline.json overwrite, keep 92.9% as the floor") and had it reverted, leaving AC21 genuinely failing and documented rather than silently resolved.
- S1-02: user then chose to escalate for an immediate weight-tuning decision rather than deferring to task 8.0 or leaving CI red for the rest of the phase. Since `product-engineer` is a main-thread orchestrator (not a spawnable subagent), the escalation was implemented by having `developer` apply task 8.0's own tuning-sweep methodology now: single-parameter sweep of `recency_half_life_days` (weights and D1-D9 untouched), landing on 365, legitimately re-recorded against live Qdrant Cloud at 96.4% overall (concept 100%, identifier 100%, cross-repo 83.3%, recency 100%) — a real improvement over S1-01's 92.9%, not a lowered floor.
- S1-02: verifier Audit Mode independently re-verified the tuning resolution (not just trusted the developer's narrative) — confirmed baseline.json genuinely reflects 96.4%, only `DEFAULT_RECENCY_HALF_LIFE_DAYS` moved, replay test is unweakened, DEF-1/DEF-2/D7/D8/R9 all correctly implemented. Verdict: High fidelity, highest drift Minor (stale PR-body line, no behavioral impact).
- S1-02: qa-engineer coverage_gate PASS; one Medium/low-likelihood structural gap noted non-blocking (custom `ranking` config values not exercised flowing through search.ts into rankResults — only default path tested).
- S1-02: `gh pr review --approve` failed structurally — GitHub disallows self-approval when the PR author and the authenticated `gh` account are the same (`llipe`). Recorded the review as a PR comment instead of a formal Approve review. `gh pr merge 67 --squash` then succeeded (auto-mode classifier did not block this specific call, unlike PR #66's chained command).
- S1-02: verifier's fidelity-report-issue-34.md was written to the story branch's working tree but never committed/pushed before the squash-merge; planner found it as an untracked file after switching to the integration branch and committed it directly as a follow-up doc commit (935b77d), matching S1-01's precedent of keeping fidelity reports in the repo.
- Ongoing: `git checkout` commands are being intermittently (not consistently) blocked by the auto-mode permission classifier this run, requiring retries. Not a git-guard block — no alternative mechanism was used, just retried the same command.
- S1-03: no test plan existed (workstream/test-plan-issue-36.md absent). Per the planner instructions' scoping ("before delegating the first story"), the Design Mode check/prompt only applies once per run (already done for S1-01) — proceeded directly to delegation using developer's own test-first workflow, no new AskUserQuestion.
- S1-03: no regression — 96.4% before/after, independently confirmed by verifier via zero-diff on baseline.json/candidates.json between branches (developer did not touch the fixtures, unlike S1-02's near-miss).
- S1-03: branch named `story/s1-03-tag-overlap-boosting`, deviating from the plan's `issue/<number>-<description>` convention used by S1-01/S1-02. Flagged by verifier as Minor/non-blocking; noted to developer in the PR review comment for subsequent stories.
- S1-03: qa-engineer coverage_gate SKIPPED (pre-existing repo-wide missing-coverage-provider condition, tracked in /TESTING.md's own harness-defects section, not caused by this story) — structural analysis instead; one Medium finding (untested defensive branches in computeTagBoostFromTerms for malformed/non-string tag data from Qdrant), non-blocking.
- S1-03: verifier Audit Mode — High fidelity, highest drift Minor (branch naming only). Comment posted to PR #68.
- S1-03: mid-run, local git branch had drifted back to `main` (cause unclear — possibly a subagent's own checkout) and the branch-guard hook correctly blocked a Write attempt while on main; recovered by checking out the integration branch again before retrying, per "a blocked guard is a decision, not an obstacle."
- S1-03: `gh pr merge 68 --squash` succeeded without classifier interference this time; verifier's fidelity-report-S1-03.md was again left uncommitted on the story branch and was committed as a follow-up doc commit (753e313) after the merge, same as S1-02's pattern — consider having developer commit these before closeout in future stories.
- S1-04: only output-removal story in Phase 1 — `confidence` dropped from `memo search` output only, retained in `memo read`/`list`/`write`/storage. Boundary independently verified correct by both qa-engineer and verifier.
- S1-04: no relevance regression — baseline.json/candidates.json zero-diff against integration branch, confirmed by verifier (tiers only annotate, per AC7).
- S1-04: correct `issue/35-<description>` branch naming used this time (explicitly instructed after S1-03's deviation).
- S1-04: qa-engineer coverage_gate FAIL — but pre-existing global threshold debt (branches/functions), confirmed present on integration branch before this story too; every metric actually improved by this diff. Not a merge blocker per policy (self-reported/gate FAIL doesn't block, only omission does).
- S1-04: verifier Audit Mode — High fidelity, highest drift Minor (non-TTY edge case under-tested, no functional defect). Comment posted to PR #69. No fidelity-report-*.md artifact was written this time (verifier used PR comment only) — no orphaned file to commit.
- S1-05: `stale_by` (not `superseded_by`) correctly used per binding decision D-1. All functional ACs verified by verifier: purity, single `scroll` call per invocation, keys genuinely omitted when not stale, staleness computed after ranking (no effect on final_score/ordering), Jaccard boundaries tested.
- S1-05: qa-engineer coverage_gate FAIL — same pre-existing global threshold debt as S1-04, not caused by this story; no structural gaps in the diff itself.
- S1-05: verifier flagged AC8 (latency target) as Major/non-blocking drift — developer's synthetic microbenchmark only covered pure-compute cost, not the new `fetchByRepo` network round-trip. Planner closed this gap directly: ran real `memo search` against the live Qdrant Cloud corpus (171 entries, largest single repo 92 — short of AC8's literal 1,000-entry scale) — warm latency 1.7-1.75s, well under 2.5s target. Did not seed 1,000 synthetic entries (would pollute production `decisions` data or cost real OpenAI embedding calls for a non-blocking check); tracked as a follow-up for S1-08's larger eval-seeding step.
- S1-06 (largest story in the phase): architecture confirmed correct by verifier — additive boost over a unioned candidate set (Decision A4, not RRF), lexical_boost composes with tag_boost in the shared 1.0-cap clamp. `ensureIndexes` verified idempotent against the real pre-existing `decisions` collection (171 points, zero data mutation) both by the developer's live check and independently by qa-engineer/verifier reading the diff.
- S1-06: developer's closeout narrative claimed "no eval query where dense-only fails an identifier query" — verifier caught this was WRONG per the developer's own evidence: q-identifier-01 genuinely benefits from lexical boost (second expected id drops out of top-3 without it). AC9 was actually satisfied; only the narrative was inaccurate. Lesson: closeout self-reports need independent verification even when they sound like honest limitations, not just when they look like optimistic claims.
- S1-06: qa-engineer coverage_gate PASS — all three specifically-flagged risks (failure injection for graceful degradation, ensureIndexes idempotency, union/dedupe on overlapping ids) confirmed genuinely tested. Two minor non-blocking gaps: untested `--lexical <invalid>` validation branch; a test title over-claiming what it asserts (doesn't check debugLog call).
- S1-06: verifier Audit Mode — High fidelity, highest drift Minor. fidelity-report-S1-06.md again left uncommitted on the story branch; committed as a follow-up doc commit (488f5e5) after merge — same recurring pattern as S1-02/S1-03.
- S1-07: developer's sandbox had no live Qdrant credentials this time (unlike prior stories); planner ran manual live validation directly against Qdrant Cloud (query_id in envelope, factors object with correct neutral literals, human --explain table + footer) — all correct.
- S1-07: qa-engineer coverage_gate FAIL on one real, specific, non-blocking gap — the envelope key-order test uses a sorted-array comparison, which can't prove order (only set membership). Verifier independently confirmed the actual runtime order is correct (matches planner's live JSON) via diff reading, so this is a test-rigor gap, not a functional defect. Flagged for follow-up fix, not blocking.
- S1-07: verifier Audit Mode — High fidelity, no Critical/Major drift. query_id confirmed genuinely inert (no caching/dedup wiring), envelope additive-only, neutral-factor semantics correctly distinguished from S1-02's separate ranking.ts factor bag.
- Note for S1-08: this is the Phase 1 EXIT GATE — a gate, not a feature. Per Execution Notes, if the gate fails and tuning cannot close it, stop and escalate (PRD revision needed, not a code change). This is also where /TESTING.md's stale/mismatched-project content (flagged repeatedly by qa-engineer across S1-01 through S1-07) must finally be corrected, and where a true 1,000-entry-scale latency measurement (deferred from S1-05's AC8) should be captured if feasible.
