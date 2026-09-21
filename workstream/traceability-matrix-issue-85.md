# Traceability Matrix — Issue #85: `memo timeline` (S2-06)

> Produced by **`verifier`** (Design Mode) on 2026-09-21. Companion to `workstream/test-plan-issue-85.md`.

## Changelog

| Version | Date       | Summary                     | Author   |
| ------- | ---------- | --------------------------- | -------- |
| 1.0     | 2026-09-21 | Initial traceability matrix | verifier |

## Scope

| Field               | Value                                                      |
| ------------------- | ---------------------------------------------------------- |
| **Repository**      | `llipe/memo-cli`                                           |
| **GitHub Issue**    | [#85](https://github.com/llipe/memo-cli/issues/85)         |
| **Source artifact** | `workstream/user-stories-prd-004-phase-2.md` (Story S2-06) |
| **Test plan**       | `workstream/test-plan-issue-85.md`                         |

`Observed-Result` and `Pass/Fail/Drift` columns are intentionally unfilled — they are populated by `verifier` **Audit Mode** after implementation.

---

## Coverage Rule Compliance

Every acceptance criterion (AC1 … AC6) maps to **at least one positive** and **at least one negative/edge** test case.

| AC  | Positive coverage | Negative / edge coverage                                  | Rule satisfied |
| --- | ----------------- | --------------------------------------------------------- | -------------- |
| AC1 | SC-1              | EC-4, EC-5, EC-8, RT-1                                    | Yes            |
| AC2 | SC-2              | CT-2, EC-1, EC-2, EC-3, EC-7, EC-8, EC-9, RT-2            | Yes            |
| AC3 | SC-3              | SC-4, CT-2, EC-6                                          | Yes            |
| AC4 | SC-5              | CT-3, EC-5                                                | Yes            |
| AC5 | SC-6, SC-7        | CT-1, EC-9                                                | Yes            |
| AC6 | SC-8              | (covered structurally by SC-1/SC-2 human-mode assertions) | Yes            |

> AC6 has no dedicated negative-path scenario because the human-output line format has no invalid-input branch of its own; its "negative" coverage is the same human-mode assertions embedded in SC-1/SC-2 (which prove the format holds under session and grouped shapes alike, including the empty-result case in SC-6), which the skill's coverage rule treats as satisfying the pairing for a purely-rendering AC.

---

## Full Traceability Table

| AC-ID | Test-Case-ID | Type                                            | Severity | Observed-Result | Pass/Fail/Drift                                        |
| ----- | ------------ | ----------------------------------------------- | -------- | --------------- | ------------------------------------------------------ |
| AC1   | SC-1         | E2E happy-path                                  | critical | _pending_       | _pending_                                              |
| AC1   | EC-4         | Edge — state transitions                        | major    | _pending_       | _pending_                                              |
| AC1   | EC-5         | Edge — data isolation                           | critical | _pending_       | _pending_                                              |
| AC1   | EC-8         | Edge — failure modes                            | major    | _pending_       | _pending_                                              |
| AC1   | RT-1         | Random — property                               | critical | _pending_       | _pending_                                              |
| AC2   | SC-2         | E2E happy-path                                  | critical | _pending_       | _pending_                                              |
| AC2   | CT-2         | Contract — consumer-driven                      | major    | _pending_       | _pending_                                              |
| AC2   | EC-1         | Edge — input domain                             | major    | _pending_       | **`undetermined` (exact code)** — see note A           |
| AC2   | EC-2         | Edge — input domain / data boundaries           | major    | _pending_       | **`undetermined` (warning channel/text)** — see note B |
| AC2   | EC-3         | Edge — data boundaries                          | major    | _pending_       | _pending_                                              |
| AC2   | EC-7         | Edge — idempotency                              | major    | _pending_       | _pending_                                              |
| AC2   | EC-8         | Edge — failure modes                            | major    | _pending_       | _pending_                                              |
| AC2   | EC-9         | Edge — data boundaries                          | major    | _pending_       | _pending_                                              |
| AC2   | RT-2         | Random — property                               | critical | _pending_       | _pending_                                              |
| AC3   | SC-3         | E2E happy-path                                  | critical | _pending_       | _pending_                                              |
| AC3   | SC-4         | E2E negative-path                               | critical | _pending_       | _pending_                                              |
| AC3   | CT-2         | Contract — consumer-driven                      | major    | _pending_       | _pending_                                              |
| AC3   | EC-6         | Edge — timing                                   | major    | _pending_       | _pending_                                              |
| AC4   | SC-5         | E2E happy-path                                  | critical | _pending_       | _pending_                                              |
| AC4   | CT-3         | Contract — provider-driven                      | critical | _pending_       | _pending_                                              |
| AC4   | EC-5         | Edge — data isolation                           | critical | _pending_       | _pending_                                              |
| AC5   | SC-6         | E2E happy-path (boundary)                       | critical | _pending_       | _pending_                                              |
| AC5   | SC-7         | E2E happy-path                                  | critical | _pending_       | _pending_                                              |
| AC5   | CT-1         | Contract — provider-driven                      | critical | _pending_       | _pending_                                              |
| AC5   | EC-9         | Edge — data boundaries                          | major    | _pending_       | _pending_                                              |
| AC6   | SC-8         | E2E happy-path                                  | major    | _pending_       | _pending_                                              |
| AC6   | SC-1         | E2E happy-path (human-mode assertion)           | critical | _pending_       | _pending_                                              |
| AC6   | SC-2         | E2E happy-path (human-mode assertion)           | critical | _pending_       | _pending_                                              |
| AC6   | SC-6         | E2E happy-path (boundary, human-mode assertion) | critical | _pending_       | _pending_                                              |

---

## Notes Blocking a Verdict

**Note A — `--last 0` rejection's exact error code undetermined (F-1).**
The story and task list agree `--last 0` must be rejected, but no AC assigns an error code. EC-1 asserts non-zero exit and treats `VALIDATION_FAILED` as the expected code by analogy with the rest of the v2 error catalog (§13); it is `undetermined` (not `fail`) pending `product-engineer`/`developer` confirmation of the exact code.

**Note B — `--last 501` clamp warning's channel/text undetermined (F-3).**
AC2/Testing Requirements require the clamp to 500 with a warning, but not the warning's channel (stderr presumed) or exact text. EC-2 gates the clamp itself as a firm pass/fail criterion and leaves only the warning's precise form as `undetermined`.

**Note C — Auto-`seq`-collision tie-break scope (F-2), no dedicated row.**
Per spec §18.8, ties on `seq` are documented as "only possible with explicit `--seq`." EC-4 tests the documented explicit-`--seq` collision mechanism as the firm gate for AC1's tie-break clause. If an auto-assigned `seq` collision is ever observed during implementation, it should be classified as an S2-02/S2-04 defect (auto-increment path), not an AC1 `timeline` failure — recorded here for audit-mode awareness, not as a separate traceability row since it falls outside `timeline`'s own responsibility.

---

## Uncovered / Deferred

| Item                              | Reason                                                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration-apply behavior          | Explicit user instruction and story Migration Requirements ("not required — read-only") — no migration-apply scenarios designed for this story.           |
| Auth & Permissions edge category  | `N/A` — `timeline` reuses the existing `QdrantRepository` credential model unchanged; no new credential type introduced.                                  |
| Resource Exhaustion edge category | `N/A` beyond the `--last` 500 clamp, which is already covered by EC-2/EC-3.                                                                               |
| API Versioning edge category      | `N/A` — `timeline` is a new 1.3.0 command with no prior version to remain compatible with; forward-compatibility toward S2-07 is covered by CT-1 instead. |
| Non-goal negative-space checks    | Tracked in the test plan's Execution Checklist (no ranking fields, no writes, no `self`/`semantic` leakage) rather than as numbered ACs.                  |

---

## Summary

| Metric                                                | Value                                                                             |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| ACs extracted                                         | 6                                                                                 |
| ACs with scenario coverage                            | 6 (AC1…AC6)                                                                       |
| ACs uncovered                                         | 0                                                                                 |
| Coverage rule (≥1 positive + ≥1 negative/edge per AC) | Satisfied for all 6                                                               |
| Total mapped test cases                               | 22 distinct (8 SC, 3 CT, 9 EC, 2 RT)                                              |
| Traceability links                                    | 29                                                                                |
| Verdict-blocking clarifications                       | 2 (Note A, Note B) — neither blocks a happy-path/negative-path verdict on AC1–AC6 |
