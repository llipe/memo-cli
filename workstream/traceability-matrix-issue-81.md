# Traceability Matrix — Issue #81: `QdrantRepository` Extensions and v2 Payload Indexes (S2-02)

> Produced by **`verifier`** (Design Mode) on 2026-09-21. Companion to `workstream/test-plan-issue-81.md`.

## Changelog

| Version | Date       | Summary                     | Author   |
| ------- | ---------- | --------------------------- | -------- |
| 1.0     | 2026-09-21 | Initial traceability matrix | verifier |

## Scope

| Field               | Value                                                      |
| ------------------- | ---------------------------------------------------------- |
| **Repository**      | `llipe/memo-cli`                                           |
| **GitHub Issue**    | [#81](https://github.com/llipe/memo-cli/issues/81)         |
| **Source artifact** | `workstream/user-stories-prd-004-phase-2.md` (Story S2-02) |
| **Test plan**       | `workstream/test-plan-issue-81.md`                         |

`Observed-Result` and `Pass/Fail/Drift` columns are intentionally unfilled — they are populated by `verifier` **Audit Mode** after implementation.

---

## Coverage Rule Compliance

Every acceptance criterion (AC1 … AC7) maps to **at least one positive** and **at least one negative or edge** test case.

| AC  | Positive coverage | Negative / edge coverage     | Rule satisfied |
| --- | ----------------- | ---------------------------- | -------------- |
| AC1 | SC-1, CT-6        | EC-2, EC-3, EC-4             | Yes            |
| AC2 | CT-1              | EC-1, EC-5, EC-8, EC-9, RT-1 | Yes            |
| AC3 | CT-2              | EC-12                        | Yes            |
| AC4 | CT-3              | EC-6, EC-13                  | Yes            |
| AC5 | CT-4              | EC-6, EC-7, RT-2             | Yes            |
| AC6 | CT-5              | EC-10, EC-14, EC-15          | Yes            |
| AC7 | CT-8              | EC-16                        | Yes            |

---

## Full Traceability Table

| AC-ID | Test-Case-ID | Type                       | Severity | Observed-Result | Pass/Fail/Drift                              |
| ----- | ------------ | -------------------------- | -------- | --------------- | -------------------------------------------- |
| AC1   | SC-1         | E2E happy-path             | critical | _pending_       | _pending_                                    |
| AC1   | CT-6         | Contract — consumer-driven | critical | _pending_       | _pending_                                    |
| AC1   | EC-2         | Edge — state transitions   | major    | _pending_       | _pending_                                    |
| AC1   | EC-3         | Edge — state transitions   | major    | _pending_       | _pending_                                    |
| AC1   | EC-4         | Edge — idempotency         | major    | _pending_       | _pending_                                    |
| AC2   | CT-1         | Contract — consumer-driven | critical | _pending_       | _pending_                                    |
| AC2   | EC-1         | Edge — input domain        | major    | _pending_       | _pending_                                    |
| AC2   | EC-5         | Edge — failure modes       | critical | _pending_       | **`undetermined`** (error type) — see note A |
| AC2   | EC-8         | Edge — data boundaries     | major    | _pending_       | _pending_                                    |
| AC2   | EC-9         | Edge — resource exhaustion | minor    | _pending_       | _pending_                                    |
| AC2   | RT-1         | Random — property          | critical | _pending_       | _pending_                                    |
| AC3   | CT-2         | Contract — consumer-driven | critical | _pending_       | _pending_                                    |
| AC3   | EC-12        | Edge — input domain        | critical | _pending_       | _pending_                                    |
| AC4   | CT-3         | Contract — consumer-driven | major    | _pending_       | _pending_                                    |
| AC4   | EC-6         | Edge — failure modes       | major    | _pending_       | _pending_                                    |
| AC4   | EC-13        | Edge — data boundaries     | minor    | _pending_       | _pending_                                    |
| AC5   | CT-4         | Contract — consumer-driven | critical | _pending_       | _pending_                                    |
| AC5   | EC-6         | Edge — failure modes       | major    | _pending_       | _pending_                                    |
| AC5   | EC-7         | Edge — data boundaries     | critical | _pending_       | _pending_                                    |
| AC5   | RT-2         | Random — property          | critical | _pending_       | _pending_                                    |
| AC6   | CT-5         | Contract — consumer-driven | critical | _pending_       | _pending_                                    |
| AC6   | EC-10        | Edge — API versioning      | major    | _pending_       | **`deferred`** (cross-story) — see note B    |
| AC6   | EC-14        | Edge — input domain        | major    | _pending_       | _pending_                                    |
| AC6   | EC-15        | Edge — input domain        | major    | _pending_       | _pending_                                    |
| AC7   | CT-8         | Contract — provider-driven | critical | _pending_       | _pending_                                    |
| AC7   | EC-16        | Edge — API versioning      | major    | _pending_       | _pending_                                    |

---

## Notes Blocking a Verdict

**Note A — AC2/AC5 error-mapping type for a mid-`scrollAll` failure undetermined (F-1).**
The story's edge-case matrix requires that a client error mid-`scrollAll` "propagates" and that "pages already delivered are not retried," but does not specify whether the propagated error is the raw client error or wrapped as `MemoError('QDRANT_OPERATION_FAILED', ...)` (the pattern every other method in this story and the shipped class uses). EC-5 records the observed behavior; it is `undetermined` (not `fail`) pending `product-engineer` confirmation of the intended error-mapping contract for `scrollAll` specifically.

**Note B — AC6's `fetchByRepo` removal is a cross-story gate, not fully verifiable from this PR alone.**
AC6 explicitly allows either S2-02 or S2-05 to carry the removal of `fetchByRepo`, requiring only that it "must not survive Phase 2." EC-10 is therefore `deferred` to the S2-11 Phase 2 exit gate rather than scored as `pass`/`fail` against this PR in isolation, unless this PR happens to also carry the `search.ts` call-site change.

---

## Uncovered / Deferred

| Item                               | Reason                                                                                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timing & Concurrency edge category | `N/A` — no new concurrent-caller scenario in this story's scope; `scrollAll`/`batchSetPayload` are sequential, single-invocation, single-threaded operations.                     |
| Auth & Permissions edge category   | `N/A` — no new credential, identity, or permission surface; every new method reuses the existing constructor-scoped `QdrantClient`.                                               |
| Migration-apply behavior           | Out of scope per the prompt and the story's own Migration Requirements ("not required — indexes are additive and reconciled at runtime; no payload rewritten").                   |
| Non-goal negative-space checks     | Tracked in the test plan's Execution Checklist (no direct `@qdrant/js-client-rest` import in commands, `scroll()` unchanged, `ranking.ts` untouched) rather than as numbered ACs. |

---

## Summary

| Metric                                                | Value                                     |
| ----------------------------------------------------- | ----------------------------------------- |
| ACs extracted                                         | 7                                         |
| ACs with scenario coverage                            | 7 (AC1…AC7)                               |
| ACs uncovered                                         | 0                                         |
| Coverage rule (≥1 positive + ≥1 negative/edge per AC) | Satisfied for all 7                       |
| Total mapped test cases                               | 27 distinct (1 SC, 8 CT, 16 EC, 2 RT)     |
| Traceability links                                    | 26                                        |
| Verdict-blocking clarifications                       | 1 firm (Note A)                           |
| Cross-story deferrals                                 | 1 (Note B, AC6/EC-10 — deferred to S2-11) |
