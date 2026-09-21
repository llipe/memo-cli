# Traceability Matrix — Issue #53: Config v2 and Payload Schema v2 (S2-01)

> Produced by **`verifier`** (Design Mode) on 2026-09-21. Companion to `workstream/test-plan-issue-53.md`.

## Changelog

| Version | Date       | Summary                     | Author   |
| ------- | ---------- | --------------------------- | -------- |
| 1.0     | 2026-09-21 | Initial traceability matrix | verifier |

## Scope

| Field               | Value                                                      |
| ------------------- | ---------------------------------------------------------- |
| **Repository**      | `llipe/memo-cli`                                           |
| **GitHub Issue**    | [#53](https://github.com/llipe/memo-cli/issues/53)         |
| **Source artifact** | `workstream/user-stories-prd-004-phase-2.md` (Story S2-01) |
| **Test plan**       | `workstream/test-plan-issue-53.md`                         |

`Observed-Result` and `Pass/Fail/Drift` columns are intentionally unfilled — they are populated by `verifier` **Audit Mode** after implementation.

---

## Coverage Rule Compliance

Every behavioral AC (AC1–AC7, AC9) maps to **at least one positive** and **at least one negative or edge** test case. AC8 has both a positive E2E path (SC-8/SC-9/SC-10) and an implicit negative case (SC-8's "without `--v2` keeps writing `'1'`" is itself the negative/contrast case for SC-9's `--v2` path), so it also satisfies the pairing rule without treating it as process-only.

| AC  | Positive coverage                                             | Negative / edge coverage                                                   | Rule satisfied                                                                                                 |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| AC1 | CT-1, CT-2, SC-11                                             | CT-4, CT-5, RT-2                                                           | Yes                                                                                                            |
| AC2 | CT-1 (private rows), EC-13                                    | —                                                                          | Yes (EC-13 covers both the absent→undefined and explicit→kept branches, functioning as both positive and edge) |
| AC3 | CT-1 (self row)                                               | EC-8, EC-9, EC-10                                                          | Yes                                                                                                            |
| AC4 | CT-1 (implicit via `recall.max_tokens` default)               | EC-11, EC-12                                                               | Yes                                                                                                            |
| AC5 | CT-6, CT-7, CT-8, CT-9                                        | EC-1, EC-2, EC-3, EC-4, EC-5, EC-6, EC-7, EC-18, RT-1                      | Yes                                                                                                            |
| AC6 | CT-10, CT-11                                                  | RT-1 (source/entry_type combinations exercised in the decision-table fuzz) | Yes                                                                                                            |
| AC7 | EC-17, entry-normalize AC7 mapping case (Execution Checklist) | EC-16                                                                      | Yes                                                                                                            |
| AC8 | SC-8, SC-9, SC-10                                             | SC-8 vs SC-9 contrast (with/without `--v2`)                                | Yes                                                                                                            |
| AC9 | CT-2, CT-13, SC-11                                            | Full-suite regression gate (`pnpm test`, `pnpm run validate`)              | Yes                                                                                                            |

---

## Full Traceability Table

| AC-ID | Test-Case-ID | Type                                                 | Severity | Observed-Result | Pass/Fail/Drift |
| ----- | ------------ | ---------------------------------------------------- | -------- | --------------- | --------------- |
| AC1   | CT-1         | Contract — schema defaults                           | critical | _pending_       | _pending_       |
| AC1   | CT-2         | Contract — regression (v1 unchanged)                 | critical | _pending_       | _pending_       |
| AC1   | CT-4         | Contract — passthrough                               | minor    | _pending_       | _pending_       |
| AC1   | CT-5         | Contract — UUID bank id                              | minor    | _pending_       | _pending_       |
| AC1   | SC-11        | E2E manual regression                                | major    | _pending_       | _pending_       |
| AC1   | RT-2         | Random — kebab/UUID fuzz                             | minor    | _pending_       | _pending_       |
| AC2   | CT-1         | Contract — private policy defaults                   | critical | _pending_       | _pending_       |
| AC2   | EC-13        | Edge — data boundaries                               | critical | _pending_       | _pending_       |
| AC2   | CT-3         | Contract — partial override                          | major    | _pending_       | _pending_       |
| AC3   | CT-1         | Contract — self soft_cap default                     | critical | _pending_       | _pending_       |
| AC3   | EC-8         | Edge — data boundaries (`0`)                         | critical | _pending_       | _pending_       |
| AC3   | EC-9         | Edge — data boundaries (non-integer)                 | critical | _pending_       | _pending_       |
| AC3   | EC-10        | Edge — data boundaries (negative)                    | major    | _pending_       | _pending_       |
| AC4   | EC-11        | Edge — data boundaries (`0`)                         | critical | _pending_       | _pending_       |
| AC4   | EC-12        | Edge — data boundaries (negative/fractional)         | major    | _pending_       | _pending_       |
| AC5   | CT-6         | Contract — positive (`self`)                         | critical | _pending_       | _pending_       |
| AC5   | CT-7         | Contract — positive (`episodic`)                     | critical | _pending_       | _pending_       |
| AC5   | CT-8         | Contract — positive (`semantic` agent)               | critical | _pending_       | _pending_       |
| AC5   | CT-9         | Contract — positive (`semantic` manual)              | major    | _pending_       | _pending_       |
| AC5   | EC-1         | Edge — input domain (K1 self-in-kb)                  | critical | _pending_       | _pending_       |
| AC5   | EC-2         | Edge — input domain (episodic no session)            | critical | _pending_       | _pending_       |
| AC5   | EC-3         | Edge — input domain (empty provenance)               | critical | _pending_       | _pending_       |
| AC5   | EC-4         | Edge — input domain (absent provenance)              | major    | _pending_       | _pending_       |
| AC5   | EC-5         | Edge — input domain (self retention fields)          | critical | _pending_       | _pending_       |
| AC5   | EC-6         | Edge — input domain (seq on non-episodic)            | critical | _pending_       | _pending_       |
| AC5   | EC-7         | Edge — input domain (K2 scope, F-1)                  | major    | _pending_       | _pending_       |
| AC5   | EC-18        | Edge — failure modes (multi-rule violation)          | minor    | _pending_       | _pending_       |
| AC5   | RT-1         | Random — decision-table fuzz                         | major    | _pending_       | _pending_       |
| AC6   | CT-10        | Contract — positive (`entry_type`)                   | major    | _pending_       | _pending_       |
| AC6   | CT-11        | Contract — positive (`source: scan`)                 | major    | _pending_       | _pending_       |
| AC6   | RT-1         | Random — decision-table fuzz                         | minor    | _pending_       | _pending_       |
| AC6   | (unit)       | `sourceToConfidence('scan') === 'low'`               | major    | _pending_       | _pending_       |
| AC7   | EC-17        | Edge — state (v2 payload untouched)                  | critical | _pending_       | _pending_       |
| AC7   | EC-16        | Edge — state (missing timestamp_utc, F-5)            | minor    | _pending_       | _pending_       |
| AC7   | (unit)       | v1 → full default mapping (Execution Checklist item) | critical | _pending_       | _pending_       |
| AC8   | SC-8         | E2E happy-path (no `--v2`)                           | major    | _pending_       | _pending_       |
| AC8   | SC-9         | E2E happy-path (`--v2`)                              | critical | _pending_       | _pending_       |
| AC8   | SC-10        | E2E happy-path (init + validate round-trip)          | critical | _pending_       | _pending_       |
| AC9   | CT-2         | Contract — regression                                | critical | _pending_       | _pending_       |
| AC9   | CT-13        | Contract — v1 schema unchanged                       | critical | _pending_       | _pending_       |
| AC9   | SC-11        | E2E manual regression                                | major    | _pending_       | _pending_       |
| AC9   | (gate)       | Full-suite `pnpm test` / `pnpm run validate` green   | critical | _pending_       | _pending_       |

---

## Non-Goals Verified as Untouched (negative-space checks, no dedicated AC)

| Non-goal                                                                                     | Verification approach                                                      | Observed-Result | Pass/Fail/Drift |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------- | --------------- |
| No shipped command calls `EntryPayloadV2Schema`/`normalizeEntry` yet                         | Diff review during Audit Mode; grep for call sites outside test files      | _pending_       | _pending_       |
| No Qdrant index changes (S2-02 scope)                                                        | Diff review — `src/lib/qdrant.ts` untouched by this story's PR             | _pending_       | _pending_       |
| No migration artifact/command touched (explicit opt-out, story's own Migration Requirements) | Diff review — no `src/lib/migrate.ts` or `migrate` command changes         | _pending_       | _pending_       |
| No bank-resolution/filter logic added (S2-03 scope)                                          | Diff review — no `src/lib/bank.ts`/`src/lib/filters.ts` in this story's PR | _pending_       | _pending_       |
| `ranking`/`retention`/`consolidation` config blocks unchanged                                | `config.test.ts` regression assertions for those blocks stay green         | _pending_       | _pending_       |

---

## AC8 Process Note

AC8's `setup.ts` behavior additionally carries a coverage-threshold Definition-of-Done item ("`setup.ts` coverage at or above `jest.config.ts` thresholds") that is not a functional AC but is tracked here since `qa-engineer`'s coverage gate is evidence this audit will consume rather than reproduce.
