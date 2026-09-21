# Traceability Matrix — Issue #90: Story S2-11 "Phase 2 exit gate — measure, document, release notes"

> Produced by **`verifier`** (Design Mode) on 2026-09-21. Companion to `workstream/test-plan-issue-90.md`.

## Changelog

| Version | Date       | Summary                     | Author   |
| ------- | ---------- | --------------------------- | -------- |
| 1.0     | 2026-09-21 | Initial traceability matrix | verifier |

## Scope

| Field               | Value                                                      |
| ------------------- | ---------------------------------------------------------- |
| **Repository**      | `llipe/memo-cli`                                           |
| **GitHub Issue**    | [#90](https://github.com/llipe/memo-cli/issues/90)         |
| **Source artifact** | `workstream/user-stories-prd-004-phase-2.md` § Story S2-11 |
| **Test plan**       | `workstream/test-plan-issue-90.md`                         |

`Observed-Result` and `Pass/Fail/Drift` columns are intentionally unfilled — they are populated by `verifier` **Audit Mode** after execution of this phase-exit gate (the mandatory PRD-level rollup requested by AC8).

---

## Coverage Rule Compliance

Every behavioral AC (AC-1, AC-4, AC-6) maps to **at least one positive** and **at least one negative or edge** test case. AC-2, AC-3, AC-5, AC-7, AC-8 are process/artifact criteria (consistent with the AC-15…AC-18 treatment in the issue-34 precedent) and are marked accordingly rather than forced into a positive/negative split that would not reflect their nature.

| AC   | Positive coverage                        | Negative / edge coverage | Rule satisfied    |
| ---- | ---------------------------------------- | ------------------------ | ----------------- |
| AC-1 | SC-1, CT-3                               | EC-1, EC-2, EC-4         | Yes               |
| AC-2 | CT-1, CT-2                               | SC-9                     | Yes               |
| AC-3 | CT-4                                     | EC-5                     | Yes               |
| AC-4 | Execution Checklist                      | EC-6                     | Yes               |
| AC-5 | Execution Checklist                      | —                        | Process criterion |
| AC-6 | SC-2, SC-3, SC-4, SC-5, SC-6, SC-7, SC-8 | SC-9, EC-2, EC-3         | Yes               |
| AC-7 | CT-5                                     | —                        | Process criterion |
| AC-8 | Execution Checklist                      | —                        | Process criterion |

---

## Full Traceability Table

| AC-ID | Test-Case-ID                                    | Type                                      | Severity | Observed-Result | Pass/Fail/Drift |
| ----- | ----------------------------------------------- | ----------------------------------------- | -------- | --------------- | --------------- |
| AC-1  | SC-1                                            | E2E happy-path                            | critical | _pending_       | _pending_       |
| AC-1  | CT-3                                            | Contract — provider-driven                | critical | _pending_       | _pending_       |
| AC-1  | EC-1                                            | Edge — state transitions/API versioning   | major    | _pending_       | _pending_       |
| AC-1  | EC-2                                            | Edge — auth & permissions/data boundaries | critical | _pending_       | _pending_       |
| AC-1  | EC-4                                            | Edge — failure modes                      | major    | _pending_       | _pending_       |
| AC-2  | CT-1                                            | Contract — schema-compat                  | critical | _pending_       | _pending_       |
| AC-2  | CT-2                                            | Contract — schema-compat                  | critical | _pending_       | _pending_       |
| AC-2  | SC-9                                            | E2E negative-path (regression)            | critical | _pending_       | _pending_       |
| AC-3  | CT-4                                            | Contract — provider-driven                | critical | _pending_       | _pending_       |
| AC-3  | EC-5                                            | Edge — failure modes                      | major    | _pending_       | _pending_       |
| AC-4  | Execution Checklist — doc/skill drift sweep     | process                                   | major    | _pending_       | _pending_       |
| AC-4  | EC-6                                            | Edge — API versioning                     | major    | _pending_       | _pending_       |
| AC-5  | Execution Checklist — ADR + kb memo entry       | process                                   | major    | _pending_       | _pending_       |
| AC-6  | SC-2                                            | E2E happy-path                            | critical | _pending_       | _pending_       |
| AC-6  | SC-3                                            | E2E happy-path                            | critical | _pending_       | _pending_       |
| AC-6  | SC-4                                            | E2E happy-path                            | major    | _pending_       | _pending_       |
| AC-6  | SC-5                                            | E2E happy-path                            | critical | _pending_       | _pending_       |
| AC-6  | SC-6                                            | E2E happy-path                            | major    | _pending_       | _pending_       |
| AC-6  | SC-7                                            | E2E happy-path                            | minor    | _pending_       | _pending_       |
| AC-6  | SC-8                                            | E2E happy-path (idempotency)              | critical | _pending_       | _pending_       |
| AC-6  | SC-9                                            | E2E negative-path (regression)            | critical | _pending_       | _pending_       |
| AC-6  | EC-2                                            | Edge — auth & permissions/data boundaries | critical | _pending_       | _pending_       |
| AC-6  | EC-3                                            | Edge — idempotency                        | major    | _pending_       | _pending_       |
| AC-7  | CT-5                                            | Contract — consumer-driven                | critical | _pending_       | _pending_       |
| AC-8  | Execution Checklist — verifier rollup requested | process                                   | critical | _pending_       | _pending_       |

---

## Notes

**Process-criterion ACs (AC-2, AC-3, AC-5, AC-7, AC-8).**
These are verified primarily by command execution, file/diff inspection, or a subsequent audit request rather than interactive CLI scenarios, consistent with how the issue-34 precedent treated AC-15…AC-18. They still receive scenario/contract coverage where an observable surface exists (AC-2 via CT-1/CT-2/SC-9; AC-3 via CT-4/EC-5; AC-7 via CT-5), and are otherwise tracked through the Execution Checklist.

**AC-1's floor is a hard gate, not advisory (PRD R6).**
Unlike Phase 1's AC-1.5 (which had an OR-clause: ≥80% or ≥baseline+15), AC1 here is a pure `≥ 96.4%` floor with no fallback. SC-1 and CT-3 both assert this literally. If the live number comes in below 96.4%, the phase does not close per R6, and the only sanctioned remediation is the S1-02 sweep methodology on `recency_half_life_days` (EC-4) — any weight change reopens PRD §8.2.

**No new schema migration in this story.**
Per the story's Migration Requirements, no migration artifact is required — `memo_eval`'s migration was already applied and exercised in S2-09. This traceability matrix nonetheless includes SC-8 (migrate second-run `scanned: 0`) as a **verification** step confirming `memo_eval` is fully migrated before the eval run proceeds, per task 11.1's explicit instruction, and EC-3 as the deeper idempotency check behind that verification step. This is opt-out documentation, not opt-out of verification.

---

## Uncovered / Deferred

| Item                                                                    | Reason                                                                                                                                                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Randomized/property-based tactics                                       | Explicitly out of scope at this rollup layer — no new application-code logic or input surface is introduced by this story; randomized coverage belongs to S2-01…S2-10's own Design Mode plans. |
| Input Domain, Timing & Concurrency, Resource Exhaustion edge categories | `N/A` — this story introduces no new user-facing input surface, no new concurrent behavior, and no new resource-bound operation; it only produces docs/ADR/PRD/release-notes changes.          |
| `memo restore --id`, `memo forget --bank --purge`                       | Out of scope — Phase 3 features per PRD §7.3/§2.6; explicitly excluded from this story's smoke script and Definition of Done.                                                                  |
| 1.3.0 tag/publish                                                       | Explicitly excluded from this story per its Context section — human-run via `scripts/release.sh`, a separate decision after PR review.                                                         |

---

## Summary

| Metric                                                           | Value                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| ACs extracted                                                    | 8                                                                                                      |
| ACs with scenario coverage                                       | 3 (AC-1, AC-4, AC-6) fully; 4 (AC-2, AC-3, AC-5, AC-7) via contract/process; 1 (AC-8) via process only |
| ACs as pure process criteria                                     | 3 (AC-5, AC-7 partially, AC-8)                                                                         |
| ACs uncovered                                                    | 0                                                                                                      |
| Coverage rule (≥1 positive + ≥1 negative/edge per behavioral AC) | Satisfied for AC-1, AC-4, AC-6                                                                         |
| Total mapped test cases                                          | 20 distinct (9 SC, 5 CT, 6 EC)                                                                         |
| Traceability links                                               | 25                                                                                                     |
| Randomized tactics                                               | 0 by design — see rationale in test plan                                                               |
| Verdict-blocking clarifications                                  | 2 (F-2 un-migrated-state edge-case scope; F-3 per-category breakdown completeness)                     |
