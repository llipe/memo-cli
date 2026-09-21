# Traceability Matrix — Issue #83: `memo write` v2 — banks, kinds, sessions, supersede (S2-04)

> Produced by **`verifier`** (Design Mode) on 2026-09-21. Companion to `workstream/test-plan-issue-83.md`.

## Changelog

| Version | Date       | Summary                     | Author   |
| ------- | ---------- | --------------------------- | -------- |
| 1.0     | 2026-09-21 | Initial traceability matrix | verifier |

## Scope

| Field               | Value                                                      |
| ------------------- | ---------------------------------------------------------- |
| **Repository**      | `llipe/memo-cli`                                           |
| **GitHub Issue**    | [#83](https://github.com/llipe/memo-cli/issues/83)         |
| **Source artifact** | `workstream/user-stories-prd-004-phase-2.md` (Story S2-04) |
| **Test plan**       | `workstream/test-plan-issue-83.md`                         |

`Observed-Result` and `Pass/Fail/Drift` columns are intentionally unfilled — they are populated by `verifier` **Audit Mode** after implementation.

---

## Coverage Rule Compliance

Every acceptance criterion (AC1 … AC11) maps to **at least one positive** and **at least one negative or edge** test case.

| AC   | Positive coverage | Negative / edge coverage                  | Rule satisfied |
| ---- | ----------------- | ----------------------------------------- | -------------- |
| AC1  | SC-1              | CT-1, CT-2, RT-2                          | Yes            |
| AC2  | SC-2              | CT-2, RT-2                                | Yes            |
| AC3  | SC-3              | CT-1                                      | Yes            |
| AC4  | SC-4, SC-5        | EC-1, EC-4, EC-5, EC-7, EC-12, RT-1, RT-3 | Yes            |
| AC5  | SC-6              | CT-2                                      | Yes            |
| AC6  | SC-7              | CT-2, EC-3, RT-2                          | Yes            |
| AC7  | SC-8              | SC-9, CT-1, EC-5, EC-6, EC-9              | Yes            |
| AC8  | SC-10             | CT-1, EC-10                               | Yes            |
| AC9  | SC-11             | EC-4, EC-5, EC-11                         | Yes            |
| AC10 | SC-12             | CT-3, EC-8                                | Yes            |
| AC11 | SC-13             | CT-4, EC-2, EC-3, EC-12, RT-2             | Yes            |

---

## Full Traceability Table

| AC-ID | Test-Case-ID | Type                               | Severity | Observed-Result | Pass/Fail/Drift                 |
| ----- | ------------ | ---------------------------------- | -------- | --------------- | ------------------------------- |
| AC1   | SC-1         | E2E happy-path + negative-path     | critical | _pending_       | _pending_                       |
| AC1   | CT-1         | Contract — provider-driven         | major    | _pending_       | _pending_                       |
| AC1   | CT-2         | Contract — consumer-driven         | major    | _pending_       | _pending_                       |
| AC1   | RT-2         | Random — property/fuzz             | major    | _pending_       | _pending_                       |
| AC2   | SC-2         | E2E happy-path                     | critical | _pending_       | _pending_                       |
| AC2   | CT-2         | Contract — consumer-driven         | major    | _pending_       | _pending_                       |
| AC2   | RT-2         | Random — property/fuzz             | major    | _pending_       | _pending_                       |
| AC3   | SC-3         | E2E happy-path + negative-path     | critical | _pending_       | _pending_                       |
| AC3   | CT-1         | Contract — provider-driven         | major    | _pending_       | _pending_                       |
| AC4   | SC-4         | E2E happy-path                     | critical | _pending_       | _pending_                       |
| AC4   | SC-5         | E2E happy-path                     | critical | _pending_       | _pending_                       |
| AC4   | EC-1         | Edge — input domain                | major    | _pending_       | _pending_                       |
| AC4   | EC-4         | Edge — state transitions           | major    | _pending_       | _pending_                       |
| AC4   | EC-5         | Edge — state transitions           | major    | _pending_       | _pending_                       |
| AC4   | EC-7         | Edge — timing & concurrency        | major    | _pending_       | **`undetermined`** — see note A |
| AC4   | EC-12        | Edge — data boundaries             | major    | _pending_       | _pending_                       |
| AC4   | RT-1         | Random — fuzz                      | critical | _pending_       | _pending_                       |
| AC4   | RT-3         | Random — property                  | major    | _pending_       | _pending_                       |
| AC5   | SC-6         | E2E happy-path                     | critical | _pending_       | _pending_                       |
| AC5   | CT-2         | Contract — consumer-driven         | major    | _pending_       | _pending_                       |
| AC6   | SC-7         | E2E negative-path + happy-path     | critical | _pending_       | _pending_                       |
| AC6   | CT-2         | Contract — consumer-driven         | major    | _pending_       | _pending_                       |
| AC6   | EC-3         | Edge — input domain                | major    | _pending_       | _pending_                       |
| AC6   | RT-2         | Random — property/fuzz             | major    | _pending_       | _pending_                       |
| AC7   | SC-8         | E2E happy-path                     | critical | _pending_       | _pending_                       |
| AC7   | SC-9         | E2E negative-path                  | critical | _pending_       | _pending_                       |
| AC7   | CT-1         | Contract — provider-driven         | major    | _pending_       | _pending_                       |
| AC7   | EC-5         | Edge — state transitions           | major    | _pending_       | _pending_                       |
| AC7   | EC-6         | Edge — timing / defensive guard    | major    | _pending_       | **`undetermined`** — see note B |
| AC7   | EC-9         | Edge — failure modes               | critical | _pending_       | _pending_                       |
| AC8   | SC-10        | E2E negative-path (failure inj.)   | critical | _pending_       | _pending_                       |
| AC8   | CT-1         | Contract — provider-driven         | major    | _pending_       | _pending_                       |
| AC8   | EC-10        | Edge — failure modes               | critical | _pending_       | _pending_                       |
| AC9   | SC-11        | E2E happy-path (boundary)          | major    | _pending_       | _pending_                       |
| AC9   | EC-4         | Edge — state transitions           | major    | _pending_       | _pending_                       |
| AC9   | EC-5         | Edge — state transitions           | major    | _pending_       | _pending_                       |
| AC9   | EC-11        | Edge — data boundaries (xref EC-4) | major    | _pending_       | _pending_                       |
| AC10  | SC-12        | E2E happy-path + negative-path     | critical | _pending_       | _pending_                       |
| AC10  | CT-3         | Contract — consumer-driven         | major    | _pending_       | _pending_                       |
| AC10  | EC-8         | Edge — idempotency                 | major    | _pending_       | _pending_                       |
| AC11  | SC-13        | E2E happy-path (contract-adjacent) | critical | _pending_       | _pending_                       |
| AC11  | CT-4         | Contract — provider-driven         | major    | _pending_       | _pending_                       |
| AC11  | EC-2         | Edge — input domain                | major    | _pending_       | _pending_                       |
| AC11  | EC-3         | Edge — input domain                | major    | _pending_       | _pending_                       |
| AC11  | EC-12        | Edge — data boundaries             | major    | _pending_       | _pending_                       |
| AC11  | RT-2         | Random — property/fuzz             | major    | _pending_       | _pending_                       |

---

## Notes Blocking a Firm Verdict

**Note A — AC4 auto-`seq` uniqueness under concurrent writes is undetermined (EC-7).**
Spec §18.6's `nextSeq` is a read-then-write operation with no described locking/compare-and-swap. Two concurrent writes to the same bank+session may compute the same `seq`. This is documented as a known race, not a specification violation, since the story's Technical Notes describe no concurrency control. EC-7 is `undetermined`/informational; it does not block AC4's firm pass/fail for the sequential case (SC-4).

**Note B — AC7 self-reference guard error code is undetermined (EC-6, F-3).**
The story's Edge-Case Matrix names the guard (`target.id === id`) but not its error code. `VALIDATION_FAILED` is the primary hypothesis (consistent with AC7's other guard failures), but EC-6 records the actual observed code as evidence rather than treating a difference as a hard fail, pending `product-engineer` confirmation.

Two further items are recorded as evidence-only (not verdict-blocking) per the test plan's Pre-Implementation Findings:

- **F-1** (AC7, `ENTRY_NOT_FOUND` exit code) — SC-9 asserts exit `1` as the primary hypothesis; a difference is recorded, not failed.
- **F-2** (AC9, soft-cap `<n>` pre- vs post-write reading) — SC-11/EC-4 assert the pre-write reading as the primary hypothesis; a difference is recorded, not failed.

---

## Uncovered / Deferred

| Item                                 | Reason                                                                                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth & permissions edge category     | `N/A` — no new credential type introduced; bank resolution (`MEMO_BANK`, `--bank`) is a data-partition selector, not an authorization boundary in Phase 2.                                         |
| Resource Exhaustion edge category    | `N/A` — no unbounded application-level input surface introduced by this story beyond shell argument limits on repeatable flags; flagged as a Recommendation instead.                               |
| API Versioning / v1↔v2 compatibility | Documented as a compatibility note (EC-13) in the test plan's Execution Checklist, not a runtime scenario — no migration-apply test is required or in scope for this story (S2-09 owns migration). |
| Non-goal negative-space checks       | Tracked in the test plan's Execution Checklist (no read-side command changes, duplicate-prompt TTY code untouched, no v1 point rewrites) rather than as numbered ACs.                              |

---

## Summary

| Metric                                                | Value                                  |
| ----------------------------------------------------- | -------------------------------------- |
| ACs extracted                                         | 11                                     |
| ACs with scenario coverage                            | 11 (AC1…AC11)                          |
| ACs uncovered                                         | 0                                      |
| Coverage rule (≥1 positive + ≥1 negative/edge per AC) | Satisfied for all 11                   |
| Total mapped test cases                               | 33 distinct (13 SC, 4 CT, 13 EC, 3 RT) |
| Traceability links                                    | 44                                     |
| Verdict-blocking clarifications                       | 2 (Note A, Note B)                     |
| Evidence-only (non-blocking) clarifications           | 2 (F-1, F-2, see test plan)            |
