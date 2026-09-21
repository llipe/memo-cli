# Traceability Matrix — Issue #88: Story S2-09 `memo migrate --to-v2`

> Produced by **`verifier`** (Design Mode) on 2026-09-21. Companion to `workstream/test-plan-issue-88.md`.

## Changelog

| Version | Date       | Summary                     | Author   |
| ------- | ---------- | --------------------------- | -------- |
| 1.0     | 2026-09-21 | Initial traceability matrix | verifier |

## Scope

| Field               | Value                                                                              |
| ------------------- | ---------------------------------------------------------------------------------- |
| **Repository**      | `llipe/memo-cli`                                                                   |
| **GitHub Issue**    | [#88](https://github.com/llipe/memo-cli/issues/88)                                 |
| **Source artifact** | `workstream/user-stories-prd-004-phase-2.md` (Story S2-09: `memo migrate --to-v2`) |
| **Test plan**       | `workstream/test-plan-issue-88.md`                                                 |

`Observed-Result` and `Pass/Fail/Drift` columns are intentionally unfilled — they are populated by `verifier` **Audit Mode** after implementation.

---

## Coverage Rule Compliance

Every acceptance criterion (AC1 … AC6) maps to **at least one positive** and **at least one negative/edge** test case.

| AC  | Positive coverage            | Negative / edge coverage                                               | Rule satisfied |
| --- | ---------------------------- | ---------------------------------------------------------------------- | -------------- |
| AC1 | SC-1, SC-4, SC-5, CT-7       | EC-1, EC-2, EC-3, EC-6, EC-11, RT-1, RT-2, RT-3                        | Yes            |
| AC2 | SC-1, SC-2, SC-3, CT-8       | EC-4, EC-6, EC-8, EC-9, EC-11, MV-1                                    | Yes            |
| AC3 | SC-1                         | EC-4, EC-6, EC-7, EC-9, MV-3, MV-4                                     | Yes            |
| AC4 | SC-4, CT-1, CT-2, CT-3, CT-4 | CT-5, CT-6, EC-5, EC-10, EC-12, RT-2                                   | Yes            |
| AC5 | SC-2, SC-3, CT-8             | EC-4                                                                   | Yes            |
| AC6 | SC-5, MV-5                   | MV-3, MV-4 (indirect: identity must survive the idempotent second run) | Yes            |

---

## Full Traceability Table

| AC-ID | Test-Case-ID | Type                               | Severity | Observed-Result | Pass/Fail/Drift                                              |
| ----- | ------------ | ---------------------------------- | -------- | --------------- | ------------------------------------------------------------ |
| AC1   | SC-1         | E2E happy-path                     | critical | _pending_       | _pending_                                                    |
| AC1   | SC-4         | E2E happy-path                     | critical | _pending_       | _pending_                                                    |
| AC1   | SC-5         | E2E happy-path                     | major    | _pending_       | _pending_                                                    |
| AC1   | CT-7         | Contract — provider-driven         | major    | _pending_       | _pending_                                                    |
| AC1   | EC-1         | Edge — input domain                | major    | _pending_       | _pending_                                                    |
| AC1   | EC-2         | Edge — input domain                | major    | _pending_       | _pending_                                                    |
| AC1   | EC-3         | Edge — input domain / state        | major    | _pending_       | **`undetermined`** (out-of-domain `bank` probe) — see Note A |
| AC1   | EC-6         | Edge — timing / data boundaries    | major    | _pending_       | _pending_                                                    |
| AC1   | EC-11        | Edge — data boundaries             | major    | _pending_       | _pending_                                                    |
| AC1   | RT-1         | Random — property                  | critical | _pending_       | _pending_                                                    |
| AC1   | RT-2         | Random — property                  | major    | _pending_       | _pending_                                                    |
| AC1   | RT-3         | Random — fuzz                      | major    | _pending_       | _pending_                                                    |
| AC2   | SC-1         | E2E happy-path                     | critical | _pending_       | _pending_                                                    |
| AC2   | SC-2         | E2E happy-path                     | major    | _pending_       | _pending_                                                    |
| AC2   | SC-3         | E2E happy-path (boundary)          | major    | _pending_       | _pending_                                                    |
| AC2   | CT-8         | Contract — provider-driven         | major    | _pending_       | _pending_                                                    |
| AC2   | EC-4         | Edge — state transitions           | major    | _pending_       | _pending_                                                    |
| AC2   | EC-6         | Edge — timing / data boundaries    | major    | _pending_       | _pending_                                                    |
| AC2   | EC-8         | Edge — failure modes (safety gate) | critical | _pending_       | _pending_                                                    |
| AC2   | EC-9         | Edge — failure modes (safety gate) | critical | _pending_       | _pending_                                                    |
| AC2   | EC-11        | Edge — data boundaries             | major    | _pending_       | _pending_                                                    |
| AC2   | MV-1         | Migration Verification             | critical | _pending_       | _pending_                                                    |
| AC3   | SC-1         | E2E happy-path                     | critical | _pending_       | _pending_                                                    |
| AC3   | EC-4         | Edge — state transitions           | major    | _pending_       | _pending_                                                    |
| AC3   | EC-6         | Edge — timing / data boundaries    | major    | _pending_       | _pending_                                                    |
| AC3   | EC-7         | Edge — idempotency (safety gate)   | critical | _pending_       | _pending_                                                    |
| AC3   | EC-9         | Edge — failure modes (safety gate) | critical | _pending_       | _pending_                                                    |
| AC3   | MV-3         | Migration Verification             | critical | _pending_       | _pending_                                                    |
| AC3   | MV-4         | Migration Verification             | critical | _pending_       | _pending_                                                    |
| AC4   | SC-4         | E2E happy-path                     | critical | _pending_       | _pending_                                                    |
| AC4   | CT-1         | Contract — consumer-driven         | major    | _pending_       | _pending_                                                    |
| AC4   | CT-2         | Contract — consumer-driven         | major    | _pending_       | _pending_                                                    |
| AC4   | CT-3         | Contract — consumer-driven         | major    | _pending_       | _pending_                                                    |
| AC4   | CT-4         | Contract — consumer-driven         | major    | _pending_       | **`undetermined`** (branch b) — see Note B                   |
| AC4   | CT-5         | Contract — consumer-driven         | critical | _pending_       | _pending_                                                    |
| AC4   | CT-6         | Contract — provider-driven         | critical | _pending_       | _pending_                                                    |
| AC4   | EC-5         | Edge — input domain / failure      | major    | _pending_       | **`undetermined`** — see Note C                              |
| AC4   | EC-10        | Edge — failure modes               | major    | _pending_       | _pending_                                                    |
| AC4   | EC-12        | Edge — API versioning              | minor    | _pending_       | _pending_                                                    |
| AC4   | RT-2         | Random — property                  | major    | _pending_       | _pending_                                                    |
| AC5   | SC-2         | E2E happy-path                     | major    | _pending_       | _pending_                                                    |
| AC5   | SC-3         | E2E happy-path (boundary)          | major    | _pending_       | _pending_                                                    |
| AC5   | CT-8         | Contract — provider-driven         | major    | _pending_       | _pending_                                                    |
| AC5   | EC-4         | Edge — state transitions           | major    | _pending_       | _pending_                                                    |
| AC6   | SC-5         | E2E happy-path                     | major    | _pending_       | _pending_                                                    |
| AC6   | MV-5         | Migration Verification             | critical | _pending_       | _pending_                                                    |
| AC6   | MV-3         | Migration Verification (indirect)  | critical | _pending_       | _pending_                                                    |
| AC6   | MV-4         | Migration Verification (indirect)  | critical | _pending_       | _pending_                                                    |

---

## Migration Verification Sequence (mirrors story Migration Requirements)

| Step | Test-Case-ID | Sequencing constraint                                      | Observed-Result | Pass/Fail/Drift |
| ---- | ------------ | ---------------------------------------------------------- | --------------- | --------------- |
| 1    | MV-1         | Must run before any real-apply step                        | _pending_       | _pending_       |
| 2    | MV-2         | Must run after MV-1, before MV-3 (human confirmation gate) | _pending_       | _pending_       |
| 3    | MV-3         | Must run only after MV-2's confirmation; `memo_eval` only  | _pending_       | _pending_       |
| 4    | MV-4         | Must run immediately after MV-3                            | _pending_       | _pending_       |
| 5    | MV-5         | Must run after MV-4 confirms idempotency                   | _pending_       | _pending_       |

This sequence directly mirrors task-list sub-tasks 9.12–9.17 and the story's Migration Requirements section. Any reordering, skipping, or evidence gap in this sequence is a **release-blocking finding for this story specifically** (not ordinary drift), because AC2/AC3/AC6 are worded to require exactly this lifecycle.

---

## Notes Blocking a Verdict

**Note A — Pre-existing non-`kb` `bank` value on a v1 point (F-4).**
AC1 says every migrated point gets `bank = kb` unconditionally; the story's Edge-Case Matrix separately says an already-partially-v2 point (has `bank`, no `schema_version`) is "migrated, existing `bank` preserved." These agree only when the pre-existing value is already `kb`. EC-3's realistic case (`bank: "kb"`) is a firm pass/fail gate; its out-of-domain probe (a different pre-existing `bank` value) is `undetermined` pending `product-engineer` confirmation of whether this is reachable in practice.

**Note B — Episodic-only `set` fields on a non-episodic rule (F-3, CT-4 branch b).**
The rules-file schema does not specify whether `session_from`/`expires_in_days` on a `set.kind: "semantic"` rule should be rejected or silently ignored. CT-4(a) and CT-4(c) are firm gates; CT-4(b) is recorded as `undetermined` evidence.

**Note C — Custom-rules catch-all setting `kind: episodic` (F-3, EC-5).**
AC4's literal text only requires a catch-all rule to exist syntactically; it does not require the catch-all to default to `semantic` the way the _default_ rules do. EC-5 records the observed accept/reject behavior as `undetermined` pending `product-engineer` confirmation of whether the safety rationale in the Business Rules section (rule 2 defaults to `semantic`) should be enforced on user-supplied rule sets too.

---

## Uncovered / Deferred

| Item                                      | Reason                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auth & permissions edge category          | `N/A` — no new credential/identity concept introduced by `migrate`; reuses the existing Qdrant credential model. The human-confirmation gate (MV-2) is a process control, not an auth mechanism. |
| Resource Exhaustion edge category         | `N/A` — pagination is fixed at 256 per page; no unbounded user-controlled input analogous to a `--limit` flag. Flagged as a Recommendation (large-collection wall-clock time) instead.           |
| Applying `migrate --to-v2` to `decisions` | Explicitly out of scope for this story — a separate, user-run step after the 1.3.0 release per the story's Migration Requirements. Not tested here by design, not by omission.                   |

---

## Summary

| Metric                                                | Value                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| ACs extracted                                         | 6                                                                                      |
| ACs with scenario coverage                            | 6 (AC1 … AC6)                                                                          |
| ACs uncovered                                         | 0                                                                                      |
| Coverage rule (≥1 positive + ≥1 negative/edge per AC) | Satisfied for all 6                                                                    |
| Total mapped test cases                               | 33 distinct (5 SC, 8 CT, 12 EC, 3 RT, 5 MV)                                            |
| Traceability links                                    | 47                                                                                     |
| Verdict-blocking clarifications                       | 3 (Note A, Note B, Note C) — none block PR completion; all route to `product-engineer` |
| Migration-lifecycle sequencing checks                 | 5 (MV-1 … MV-5), all release-blocking for this story specifically                      |
