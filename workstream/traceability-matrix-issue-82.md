# Traceability Matrix — Issue #82 (Story S2-03: Bank resolution, base filter, and dedupe v2)

**Mode:** Design (pre-implementation) · **Agent:** verifier
**Companion artifact:** `workstream/test-plan-issue-82.md`

## Document Changelog

| Date       | Change                      | Author   |
| ---------- | --------------------------- | -------- |
| 2026-09-21 | Initial traceability matrix | verifier |

## AC-ID -> Test-Case-ID -> Observed-Result -> Pass/Fail/Drift

Legend: `Test-File` names are the planned files per Testing Requirements / task 3.1–3.4. `Observed-Result` and `Pass/Fail/Drift` columns are populated by `verifier` Audit Mode once code + tests exist; they are `Pending` at Design Mode time.

| AC-ID | Statement (short)                                                                                | Positive Test-Case-ID(s)                                                                  | Negative/Edge Test-Case-ID(s)                                                                | Test-File                                                                      | Observed-Result | Pass/Fail/Drift |
| ----- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------- | --------------- |
| AC1   | `resolveBank` precedence flag > env > config > `'kb'`; invalid value fails naming its source     | EC-1, EC-2, EC-3, EC-4, EC-11, EC-12                                                      | EC-5, EC-6, EC-7, EC-8, EC-9, EC-10                                                          | `tests/unit/lib/bank.test.ts`                                                  | Pending         | Pending         |
| AC2   | `defaultKind('kb')==='semantic'`; else `'episodic'`; `isPrivateBank`                             | EC-13, EC-14, EC-15, EC-16                                                                | (no negative branch — total function over `string`; boundary is EC-14's "anything else" set) | `tests/unit/lib/bank.test.ts`                                                  | Pending         | Pending         |
| AC3   | `policyFor` returns `banks.kb.*`/`banks.private.*`; `policyFor(_, 'kb', 'self')` throws          | EC-17, EC-18, EC-20, EC-21, EC-22                                                         | EC-19                                                                                        | `tests/unit/lib/bank.test.ts`                                                  | Pending         | Pending         |
| AC4   | `buildBaseFilter` shape per bank/kind/exclusions/session/asOf                                    | EC-23, EC-25, EC-26, EC-27, EC-28, EC-29, EC-31, EC-34; CT-1, CT-2                        | EC-24, EC-30, EC-32, EC-33, EC-35                                                            | `tests/unit/lib/filters.test.ts`                                               | Pending         | Pending         |
| AC5   | `buildSearchFilters`/`buildListFilters` merge `base` by concatenation; conditional `repo` clause | EC-37, EC-38, EC-40; CT-3, CT-4                                                           | EC-36, EC-39, EC-41; CT-5                                                                    | `tests/unit/lib/search-filters.test.ts`, `tests/unit/lib/list-filters.test.ts` | Pending         | Pending         |
| AC6   | `buildDedupeKeyV2` §18.5 keys per kind; `self` never collides                                    | EC-42, EC-45, EC-46, EC-47; CT-8; randomized 1,000-call `self` property (§5 of test plan) | EC-43, EC-44, EC-50                                                                          | `tests/unit/lib/dedupe.test.ts`                                                | Pending         | Pending         |
| AC7   | `seq` 0 vs 1 → different keys; same `seq` → same key                                             | EC-47                                                                                     | EC-48, EC-49                                                                                 | `tests/unit/lib/dedupe.test.ts`                                                | Pending         | Pending         |

## Coverage Summary

- Every AC (AC1–AC7) has at least one positive and at least one negative/edge test case mapped, satisfying Non-Negotiable Operating Rule 4.
  - Exception noted: AC2 has no true "negative" input (the function is total over any string), so its edge coverage is the boundary partition itself (`'kb'` vs. everything else) rather than a failure case — this is called out explicitly rather than silently omitted.
- CT-6 (`buildLexicalScrollFilter` base propagation) is **deferred** — it is a downstream consumer contract owned by Story S2-07 (`search.ts`), not testable against this story's deliverables in isolation. Recorded here so the S2-07 test plan/audit can pick it up; it does not block this story's AC coverage.
- Business rules BR-1 (v1 points belong to `kb`), BR-2 (`self` excluded by default), BR-3 (archived/superseded excluded pre-ranking) are exercised indirectly through EC-34/EC-35 (BR-1), EC-23 (BR-2), EC-23/EC-25–27 (BR-3) — they are not separately numbered ACs but are traced here for completeness since they are called out explicitly in the story.

## Status

**Status: Design complete — not blocked.** All 7 ACs are mapped to ≥1 positive and ≥1 negative/edge test case. No missing evidence at Design Mode time. `Observed-Result`/`Pass/Fail/Drift` columns will be populated by `verifier` Audit Mode after `developer` delivers the implementation and test suite for issue #82.
