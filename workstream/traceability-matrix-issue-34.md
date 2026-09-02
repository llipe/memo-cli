# Traceability Matrix — Issue #34: Composite Ranking Score for Search Results

> Produced by **`verifier`** (Design Mode) on 2026-08-25. Companion to `workstream/test-plan-issue-34.md`.

## Changelog

| Version | Date       | Summary                     | Author   |
| ------- | ---------- | --------------------------- | -------- |
| 1.0     | 2026-08-25 | Initial traceability matrix | verifier |

## Scope

| Field               | Value                                                       |
| ------------------- | ----------------------------------------------------------- |
| **Repository**      | `llipe/memo-cli`                                            |
| **GitHub Issue**    | [#34](https://github.com/llipe/memo-cli/issues/34)          |
| **Source artifact** | `workstream/issue-34-composite-ranking-score-refinement.md` |
| **Test plan**       | `workstream/test-plan-issue-34.md`                          |

`Observed-Result` and `Pass/Fail/Drift` columns are intentionally unfilled — they are populated by `verifier` **Audit Mode** after implementation.

---

## Coverage Rule Compliance

Every behavioral AC (AC-1 … AC-14) maps to **at least one positive** and **at least one negative or edge** test case.

| AC    | Positive coverage | Negative / edge coverage | Rule satisfied |
| ----- | ----------------- | ------------------------ | -------------- |
| AC-1  | SC-1              | SC-11, EC-9, EC-10, RT-2, RT-4 | Yes |
| AC-2  | SC-1              | EC-1, EC-7, EC-8, RT-3   | Yes |
| AC-3  | SC-2              | EC-4, RT-3               | Yes |
| AC-4  | SC-1              | EC-2, EC-3, EC-14, EC-15, CT-9, RT-1, RT-6 | Yes |
| AC-5  | SC-4, CT-1        | CT-2, EC-19, EC-20, RT-6 | Yes |
| AC-6  | SC-3              | SC-11                    | Yes |
| AC-7  | SC-4, CT-1        | CT-3, SC-11, EC-19       | Yes |
| AC-8  | CT-4, SC-5        | EC-11, CT-6              | Yes |
| AC-9  | CT-4              | SC-6, SC-13, CT-6, CT-10, EC-11, EC-16, EC-17, RT-5 | Yes |
| AC-10 | SC-5, CT-5, CT-7, CT-8 | EC-6, EC-11         | Yes |
| AC-11 | CT-5              | SC-8, EC-6               | Yes |
| AC-12 | —                 | SC-7, SC-13, CT-10, EC-6, RT-5 | Yes (negative-only AC by nature) |
| AC-13 | SC-9              | EC-5, EC-12, EC-13, EC-18, RT-2, RT-5 | Yes |
| AC-14 | SC-10             | EC-5, EC-18, RT-5        | Yes |
| AC-15 | Execution Checklist | —                      | Process criterion |
| AC-16 | Execution Checklist | —                      | Process criterion |
| AC-17 | Execution Checklist | —                      | Process criterion |
| AC-18 | Execution Checklist | —                      | Process criterion |

> AC-12 is inherently a failure-mode criterion ("must fail fast"), so its "positive" case is a correctly-produced error. SC-7 serves both roles.

---

## Full Traceability Table

| AC-ID | Test-Case-ID | Type | Severity | Observed-Result | Pass/Fail/Drift |
| ----- | ------------ | ---- | -------- | --------------- | --------------- |
| AC-1 | SC-1 | E2E happy-path | critical | _pending_ | _pending_ |
| AC-1 | SC-11 | E2E negative-path | major | _pending_ | _pending_ |
| AC-1 | SC-12 | E2E abuse-case | major | _pending_ | _pending_ |
| AC-1 | EC-9 | Edge — idempotency | major | _pending_ | _pending_ |
| AC-1 | EC-10 | Edge — idempotency | major | _pending_ | _pending_ |
| AC-1 | RT-2 | Random — property | critical | _pending_ | _pending_ |
| AC-1 | RT-4 | Random — property | major | _pending_ | _pending_ |
| AC-2 | SC-1 | E2E happy-path | critical | _pending_ | _pending_ |
| AC-2 | EC-1 | Edge — input domain | critical | _pending_ | _pending_ |
| AC-2 | EC-7 | Edge — timing | major | _pending_ | _pending_ |
| AC-2 | EC-8 | Edge — timing | major | _pending_ | _pending_ |
| AC-2 | RT-3 | Random — property | major | _pending_ | _pending_ |
| AC-3 | SC-2 | E2E happy-path | major | _pending_ | _pending_ |
| AC-3 | EC-4 | Edge — input domain | major | _pending_ | _pending_ |
| AC-3 | RT-3 | Random — property | major | _pending_ | _pending_ |
| AC-4 | SC-1 | E2E happy-path | critical | _pending_ | _pending_ |
| AC-4 | EC-2 | Edge — input domain | major | _pending_ | _pending_ |
| AC-4 | EC-3 | Edge — input domain | critical | _pending_ | _pending_ |
| AC-4 | EC-14 | Edge — data boundaries | critical | _pending_ | _pending_ |
| AC-4 | EC-15 | Edge — data boundaries | major | _pending_ | _pending_ |
| AC-4 | CT-9 | Contract — schema-compat | major | _pending_ | _pending_ |
| AC-4 | RT-1 | Random — property | critical | _pending_ | _pending_ |
| AC-4 | RT-6 | Random — fuzz | major | _pending_ | _pending_ |
| AC-5 | SC-4 | E2E happy-path | critical | _pending_ | _pending_ |
| AC-5 | CT-1 | Contract — provider-driven | critical | _pending_ | _pending_ |
| AC-5 | CT-2 | Contract — schema-compat | critical | _pending_ | _pending_ |
| AC-5 | EC-19 | Edge — API versioning | major | _pending_ | _pending_ |
| AC-5 | EC-20 | Edge — API versioning | major | _pending_ | _pending_ |
| AC-5 | RT-6 | Random — fuzz | major | _pending_ | _pending_ |
| AC-6 | SC-3 | E2E happy-path | major | _pending_ | _pending_ |
| AC-6 | SC-11 | E2E negative-path | major | _pending_ | _pending_ |
| AC-7 | SC-4 | E2E happy-path | critical | _pending_ | _pending_ |
| AC-7 | CT-1 | Contract — provider-driven | critical | _pending_ | _pending_ |
| AC-7 | CT-3 | Contract — schema-compat | critical | _pending_ | _pending_ |
| AC-7 | SC-11 | E2E negative-path | major | _pending_ | _pending_ |
| AC-7 | EC-19 | Edge — API versioning | major | _pending_ | _pending_ |
| AC-8 | CT-4 | Contract — consumer-driven | critical | _pending_ | _pending_ |
| AC-8 | SC-5 | E2E happy-path | critical | _pending_ | _pending_ |
| AC-8 | EC-11 | Edge — failure modes | **critical** | _pending_ | _pending_ |
| AC-8 | CT-6 | Contract — consumer-driven | major | _pending_ | _pending_ |
| AC-9 | SC-6 | E2E negative-path | critical | _pending_ | _pending_ |
| AC-9 | SC-13 | E2E abuse-case | major | _pending_ | _pending_ |
| AC-9 | CT-4 | Contract — consumer-driven | critical | _pending_ | _pending_ |
| AC-9 | CT-6 | Contract — consumer-driven | major | _pending_ | _pending_ |
| AC-9 | CT-10 | Contract — provider-driven | major | _pending_ | _pending_ |
| AC-9 | EC-11 | Edge — failure modes | **critical** | _pending_ | _pending_ |
| AC-9 | EC-16 | Edge — data boundaries | major | _pending_ | _pending_ |
| AC-9 | EC-17 | Edge — data boundaries | critical | _pending_ | _pending_ |
| AC-9 | RT-5 | Random — fuzz | major | _pending_ | _pending_ |
| AC-10 | SC-5 | E2E happy-path | critical | _pending_ | _pending_ |
| AC-10 | CT-5 | Contract — consumer-driven | critical | _pending_ | _pending_ |
| AC-10 | CT-7 | Contract — schema-compat | major | _pending_ | _pending_ |
| AC-10 | CT-8 | Contract — schema-compat | major | _pending_ | _pending_ |
| AC-10 | EC-6 | Edge — state transitions | critical | _pending_ | _pending_ |
| AC-10 | EC-11 | Edge — failure modes | **critical** | _pending_ | _pending_ |
| AC-11 | SC-8 | E2E negative-path | major | _pending_ | _pending_ |
| AC-11 | CT-5 | Contract — consumer-driven | critical | _pending_ | **`undetermined`** — see note A |
| AC-11 | EC-6 | Edge — state transitions | critical | _pending_ | _pending_ |
| AC-12 | SC-7 | E2E negative-path | critical | _pending_ | _pending_ |
| AC-12 | SC-13 | E2E abuse-case | major | _pending_ | _pending_ |
| AC-12 | CT-10 | Contract — provider-driven | major | _pending_ | _pending_ |
| AC-12 | EC-6 | Edge — state transitions | critical | _pending_ | _pending_ |
| AC-12 | RT-5 | Random — fuzz | major | _pending_ | _pending_ |
| AC-13 | SC-9 | E2E happy-path | major | _pending_ | _pending_ |
| AC-13 | EC-5 | Edge — input domain | major | _pending_ | _pending_ |
| AC-13 | EC-12 | Edge — failure modes | major | _pending_ | _pending_ |
| AC-13 | EC-13 | Edge — data boundaries | major | _pending_ | _pending_ |
| AC-13 | EC-18 | Edge — resource exhaustion | **major** | _pending_ | **`undetermined`** — see note B |
| AC-13 | RT-2 | Random — property | critical | _pending_ | _pending_ |
| AC-13 | RT-5 | Random — fuzz | major | _pending_ | _pending_ |
| AC-14 | SC-10 | E2E boundary | major | _pending_ | _pending_ |
| AC-14 | EC-5 | Edge — input domain | major | _pending_ | _pending_ |
| AC-14 | EC-18 | Edge — resource exhaustion | **major** | _pending_ | **`undetermined`** — see note B |
| AC-14 | RT-5 | Random — fuzz | major | _pending_ | _pending_ |
| AC-15 | Execution Checklist — `pnpm test` | process | major | _pending_ | _pending_ |
| AC-16 | Execution Checklist — `ranking.test.ts` completeness | process | major | _pending_ | _pending_ |
| AC-17 | Execution Checklist — `pnpm run test:coverage` | process | major | _pending_ | _pending_ |
| AC-18 | Execution Checklist — lint/format/typecheck/audit | process | major | _pending_ | _pending_ |

---

## Notes Blocking a Verdict

**Note A — AC-11 semantics undetermined.**
AC-11 requires a partial `ranking` block to be "rejected by weight-sum validation rather than silently mixing a partial override with defaults." CT-5(c) supplies `{ recency_half_life_days: 30 }` only — a partial block whose resolved weights still sum to `1.0`. Two readings conflict:

- **(i) Strict:** any partial weight override is rejected outright.
- **(ii) Defaults-then-validate:** defaults fill the gaps, then the sum is checked — so (c) legitimately passes.

Reading (ii) is more coherent with AC-10's default-resolution behavior and is what the test plan asserts. `product-engineer` must confirm before Audit Mode can issue a pass/fail on AC-11.

**Note B — F-1: AC-13 and AC-14 are mutually inconsistent with the stated cap.**
AC-13's formula `max(limit, min(limit * 3, 50))` is unbounded above, because the outer `max` defeats the cap for any `limit > 50`. Verified: `limit = 1_000_000` → over-fetch `1_000_000`. AC-14 explicitly *requires* this (`--limit 100` must fetch `100`, not `50`), so the issue body's "capped at 50" intent cannot hold simultaneously. This is a requirement conflict, not an implementation defect. EC-18 stays `undetermined` until `product-engineer` decides whether to add an absolute ceiling or bound `--limit` itself.

---

## Uncovered / Deferred

| Item | Reason |
| ---- | ------ |
| AC-15 … AC-18 | Process and meta criteria. Verified by command execution in the Execution Checklist, not by behavioral scenarios. Declared per the E2E skill's requirement to flag ACs not coverable by scenario. |
| Auth & permissions edge category | `N/A` — Memo has no auth layer in v1; ranking adds no auth surface. Credential-leak adjacency is covered by SC-13. |
| Non-goal negative-space checks | Tracked in the test plan's Execution Checklist (no `confidence_tier`, no tag boost, no `stale` flag, `memo list` unchanged, payload `confidence` inert) rather than as numbered ACs. |

---

## Summary

| Metric | Value |
| ------ | ----- |
| ACs extracted | 18 |
| ACs with scenario coverage | 14 (AC-1 … AC-14) |
| ACs as process criteria | 4 (AC-15 … AC-18) |
| ACs uncovered | 0 |
| Coverage rule (≥1 positive + ≥1 negative/edge per behavioral AC) | Satisfied for all 14 |
| Total mapped test cases | 49 distinct (13 SC, 10 CT, 20 EC, 6 RT) |
| Traceability links | 80 |
| Verdict-blocking clarifications | 2 (Note A, Note B) |
