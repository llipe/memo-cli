# Traceability Matrix — Issue #61: Relevance Evaluation Harness and Recorded Baseline (S1-01)

> Produced by **`verifier`** (Design Mode) on 2026-09-19. Companion to `workstream/test-plan-issue-61.md`.

## Changelog

| Version | Date       | Summary                     | Author   |
| ------- | ---------- | --------------------------- | -------- |
| 1.0     | 2026-09-19 | Initial traceability matrix | verifier |

## Scope

| Field               | Value                                                      |
| ------------------- | ---------------------------------------------------------- |
| **Repository**      | `llipe/memo-cli`                                           |
| **GitHub Issue**    | [#61](https://github.com/llipe/memo-cli/issues/61)         |
| **Source artifact** | `workstream/user-stories-prd-004-phase-1.md` (Story S1-01) |
| **Test plan**       | `workstream/test-plan-issue-61.md`                         |

`Observed-Result` and `Pass/Fail/Drift` columns are intentionally unfilled — they are populated by `verifier` **Audit Mode** after implementation.

---

## Coverage Rule Compliance

Every behavioral AC (AC1 … AC7, AC9) maps to **at least one positive** and **at least one negative or edge** test case. AC8 is a documentation/process criterion (see note below).

| AC  | Positive coverage           | Negative / edge coverage                               | Rule satisfied    |
| --- | --------------------------- | ------------------------------------------------------ | ----------------- |
| AC1 | SC-1                        | CT-3, EC-10, RT-2                                      | Yes               |
| AC2 | SC-2                        | CT-3, EC-2, EC-3, EC-10, RT-2                          | Yes               |
| AC3 | SC-3                        | EC-4, EC-8                                             | Yes               |
| AC4 | SC-4, SC-5                  | EC-1, EC-4, EC-6                                       | Yes               |
| AC5 | SC-6                        | CT-1, CT-2, EC-5, EC-11                                | Yes               |
| AC6 | SC-7                        | CT-1, CT-2, CT-5, EC-2, EC-3, EC-9, EC-11, EC-12, RT-1 | Yes               |
| AC7 | SC-4                        | SC-8, SC-9, CT-4, EC-4, EC-7                           | Yes               |
| AC8 | Execution Checklist / SC-10 | —                                                      | Process criterion |
| AC9 | SC-7                        | CT-5                                                   | Yes               |

> AC8 is verified by diff inspection (SC-10) rather than by a positive/negative behavioral pair; it is a documentation criterion, not a runtime behavior, so the coverage rule's positive/negative pairing does not strictly apply. SC-10 is listed as its sole scenario per the skill's requirement to declare ACs not coverable by the standard E2E pairing.

---

## Full Traceability Table

| AC-ID | Test-Case-ID | Type                           | Severity | Observed-Result | Pass/Fail/Drift                                |
| ----- | ------------ | ------------------------------ | -------- | --------------- | ---------------------------------------------- |
| AC1   | SC-1         | E2E happy-path                 | critical | _pending_       | _pending_                                      |
| AC1   | CT-3         | Contract — consumer-driven     | major    | _pending_       | _pending_                                      |
| AC1   | EC-10        | Edge — data boundaries         | major    | _pending_       | _pending_                                      |
| AC1   | RT-2         | Random — fuzz                  | major    | _pending_       | _pending_                                      |
| AC2   | SC-2         | E2E happy-path                 | critical | _pending_       | _pending_                                      |
| AC2   | CT-3         | Contract — consumer-driven     | major    | _pending_       | _pending_                                      |
| AC2   | EC-2         | Edge — input domain            | major    | _pending_       | _pending_                                      |
| AC2   | EC-3         | Edge — input domain            | major    | _pending_       | _pending_                                      |
| AC2   | EC-10        | Edge — data boundaries         | major    | _pending_       | _pending_                                      |
| AC2   | RT-2         | Random — fuzz                  | major    | _pending_       | _pending_                                      |
| AC3   | SC-3         | E2E happy-path                 | critical | _pending_       | _pending_                                      |
| AC3   | EC-4         | Edge — state transitions       | major    | _pending_       | _pending_                                      |
| AC3   | EC-8         | Edge — failure modes           | critical | _pending_       | _pending_                                      |
| AC4   | SC-4         | E2E happy-path                 | critical | _pending_       | _pending_                                      |
| AC4   | SC-5         | E2E happy-path                 | critical | _pending_       | _pending_                                      |
| AC4   | EC-1         | Edge — input domain / timing   | major    | _pending_       | _pending_                                      |
| AC4   | EC-4         | Edge — state transitions       | major    | _pending_       | _pending_                                      |
| AC4   | EC-6         | Edge — idempotency             | major    | _pending_       | **`undetermined`** — see note A                |
| AC5   | SC-6         | E2E happy-path                 | critical | _pending_       | _pending_                                      |
| AC5   | CT-1         | Contract — provider-driven     | critical | _pending_       | _pending_                                      |
| AC5   | CT-2         | Contract — provider-driven     | critical | _pending_       | _pending_                                      |
| AC5   | EC-5         | Edge — timing                  | major    | _pending_       | _pending_                                      |
| AC5   | EC-11        | Edge — data boundaries         | major    | _pending_       | _pending_                                      |
| AC6   | SC-7         | E2E happy-path                 | critical | _pending_       | _pending_                                      |
| AC6   | CT-1         | Contract — provider-driven     | critical | _pending_       | _pending_                                      |
| AC6   | CT-2         | Contract — provider-driven     | critical | _pending_       | _pending_                                      |
| AC6   | CT-5         | Contract — provider-driven     | critical | _pending_       | _pending_                                      |
| AC6   | EC-2         | Edge — input domain            | major    | _pending_       | _pending_                                      |
| AC6   | EC-3         | Edge — input domain            | major    | _pending_       | _pending_                                      |
| AC6   | EC-9         | Edge — failure modes           | critical | _pending_       | _pending_                                      |
| AC6   | EC-11        | Edge — data boundaries         | major    | _pending_       | _pending_                                      |
| AC6   | EC-12        | Edge — API versioning          | major    | _pending_       | _pending_                                      |
| AC6   | RT-1         | Random — property              | critical | _pending_       | _pending_                                      |
| AC7   | SC-4         | E2E happy-path                 | critical | _pending_       | _pending_                                      |
| AC7   | SC-8         | E2E negative-path              | critical | _pending_       | _pending_                                      |
| AC7   | SC-9         | E2E negative-path (boundary)   | major    | _pending_       | _pending_                                      |
| AC7   | CT-4         | Contract — consumer-driven     | major    | _pending_       | _pending_                                      |
| AC7   | EC-4         | Edge — state transitions       | major    | _pending_       | _pending_                                      |
| AC7   | EC-7         | Edge — failure modes           | critical | _pending_       | **`undetermined`** (b,c branches) — see note B |
| AC8   | SC-10        | E2E happy-path (documentation) | major    | _pending_       | _pending_                                      |
| AC9   | SC-7         | E2E happy-path                 | critical | _pending_       | _pending_                                      |
| AC9   | CT-5         | Contract — provider-driven     | critical | _pending_       | _pending_                                      |

---

## Notes Blocking a Verdict

**Note A — AC4 idempotency semantics undetermined (F-1).**
AC4 requires `--seed` to be "idempotent (fixed ids, re-runnable)," but does not specify overwrite-vs-skip behavior when a fixture entry's content changes between seed runs while keeping the same `id`. EC-6 exercises this and records the observed behavior; it is `undetermined` (not `fail`) pending `product-engineer` confirmation that upsert-overwrite is the intended semantics.

**Note B — `MEMO_COLLECTION` unset behavior for non-`--seed` modes undetermined (F-3).**
AC7 and task 1.10 firmly require `--seed` to refuse when `MEMO_COLLECTION` is unset (EC-7 branch (a), and SC-8, are firm pass/fail gates). Whether plain `run` (branch b) or `--record` (branch c) must also refuse, versus being allowed to proceed read-only against `decisions`, is not specified. EC-7(b) and EC-7(c) are `undetermined` until `product-engineer` confirms; EC-7(a) and SC-8/SC-9 remain firm gates.

---

## Uncovered / Deferred

| Item                              | Reason                                                                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC8                               | Documentation/process criterion (PRD changelog row). Verified by diff inspection (SC-10) rather than a behavioral positive/negative pair.                        |
| Auth & permissions edge category  | `N/A` — the harness reuses existing Qdrant/embeddings credentials and introduces no new credential type. `MEMO_COLLECTION` is a name selector, not a secret.     |
| Resource Exhaustion edge category | `N/A` — no unbounded user-supplied input in this story's scope; fixture size is authored/reviewed, not attacker-controlled. Flagged as a Recommendation instead. |
| Non-goal negative-space checks    | Tracked in the test plan's Execution Checklist (no ranking-behavior change, no `ranking` config block, `decisions` untouched) rather than as numbered ACs.       |

---

## Summary

| Metric                                                           | Value                                  |
| ---------------------------------------------------------------- | -------------------------------------- |
| ACs extracted                                                    | 9                                      |
| ACs with scenario coverage                                       | 8 (AC1…AC7, AC9)                       |
| ACs as process/documentation criteria                            | 1 (AC8)                                |
| ACs uncovered                                                    | 0                                      |
| Coverage rule (≥1 positive + ≥1 negative/edge per behavioral AC) | Satisfied for all 8                    |
| Total mapped test cases                                          | 29 distinct (10 SC, 5 CT, 12 EC, 2 RT) |
| Traceability links                                               | 40                                     |
| Verdict-blocking clarifications                                  | 2 (Note A, Note B)                     |
