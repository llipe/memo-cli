# Compliance Test Plan — Issue #85: `memo timeline` (S2-06)

> Produced by **`verifier`** (Design Mode) on 2026-09-21. Pre-implementation. Black-box: all assertions derive from observable CLI behavior, not internal code structure.

## Changelog

| Version | Date       | Summary           | Author   |
| ------- | ---------- | ----------------- | -------- |
| 1.0     | 2026-09-21 | Initial test plan | verifier |

## Source Input Summary

| Field               | Value                                                                                                                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Repository**      | `llipe/memo-cli`                                                                                                                                                                                                                                                                               |
| **GitHub Issue**    | [#85](https://github.com/llipe/memo-cli/issues/85)                                                                                                                                                                                                                                             |
| **Input type**      | `story`                                                                                                                                                                                                                                                                                        |
| **Source artifact** | `workstream/user-stories-prd-004-phase-2.md` — Story S2-06 (`memo timeline`)                                                                                                                                                                                                                   |
| **Also binding**    | `workstream/specification-prd-004-long-lived-agent-memory.md` §18.8 (implementation detail), §6.1 (contract table), §10 (human output), §8.1 (`buildBaseFilter` default exclusions), §13 (error codes); `docs/requirements/prd-004-long-lived-agent-memory.md` §13 AC-2.5 (normative ordering) |
| **Task list**       | `workstream/tasks-prd-004-phase-2-plan.md`, task 6.0 (sub-tasks 6.1–6.16)                                                                                                                                                                                                                      |
| **ACs extracted**   | 6 (AC1 … AC6)                                                                                                                                                                                                                                                                                  |
| **Traceability**    | `workstream/traceability-matrix-issue-85.md`                                                                                                                                                                                                                                                   |

Observable surfaces available to black-box testing:

1. `memo timeline --bank <id> --session <id> [--last <n>] [--json]` — session shape, `seq`-ordered.
2. `memo timeline --bank <id> [--last <n>] [--since <iso>] [--json]` — grouped shape, `timestamp_utc`-desc within groups, groups in most-recent-first order.
3. `memo timeline --json` envelope shape (both shapes).
4. Human-output rendering: `seq  timestamp  lead  id` per line (§10), session headers when grouped.
5. Exit codes and error surfaces (`VALIDATION_FAILED` for invalid `--since`, argument-parsing rejection for `--last 0`).
6. Indirect probes on the mocked repository layer: whether `createEmbeddings`/`rankResults` are invoked (asserted at the unit-test boundary, not purely CLI-observable, but required by AC4 and explicitly named as a testing requirement in the story — included here as a grey-adjacent black-box assertion since it is externally observable via mock call-count, the same technique the story's own Testing Requirements section prescribes).

**Read-only scope confirmation:** per the story's Migration Requirements ("not required — read-only") and the user's explicit instruction, this plan designs **no** migration-apply test scenarios. `memo timeline` never writes.

---

## Pre-Implementation Findings

Design-time analysis surfaced items that affect how the ACs must be tested. All are reported, not fixed — remediation belongs to `developer`; scope questions belong to `product-engineer`.

### F-1 — `--last 0` rejection is asserted by the story's edge-case matrix but not by any AC (Minor, design concern)

The story's Testing Requirements/Edge-Case Matrix states "`--last 0` (rejected)," and task 6.10 repeats it, but none of AC1–AC6 states a validation rule for `--last`. AC3 only defines `VALIDATION_FAILED` for invalid `--since`. This plan treats the `--last 0` rejection as a firm requirement (task list + testing requirements agree), assigns it `VALIDATION_FAILED` as the most consistent error code with the rest of the v2 command surface (§13's catalog reserves `VALIDATION_FAILED` for exactly this class of CLI input error), and flags via **EC-1** that `developer`/`product-engineer` should confirm the exact code/message if it diverges.

### F-2 — Tie-break scope for equal `seq` is narrower than "equal `seq`" edge case implies (Minor)

Spec §18.8 says ties on `seq` are "only possible with explicit `--seq`" and are broken client-side by `timestamp_utc` asc. The story's edge-case matrix separately lists "two entries with equal `seq`" without that qualifier. **EC-4** tests the documented mechanism (explicit-`--seq` collision) as the primary scenario, and separately notes that an auto-assigned `seq` collision should be structurally impossible given S2-02's auto-increment (one scroll ordered `seq desc`, limit 1) — if the implementation ever produces an auto-assigned collision, that is a defect in the auto-`seq` path (S2-04/S2-02), not in `timeline`'s tie-break code, and is flagged as `Undetermined` scope in the traceability notes rather than assigned to this story's pass/fail gate.

### F-3 — `--last 501` "clamped and warned" has no specified warning channel or message (Minor)

Story AC2/Testing Requirements say "clamped to 500, warned" but neither the story nor spec §18.8 specifies whether the warning goes to stderr, what text it contains, or whether `--json` mode still emits it (on stderr, presumably, per §13's "progress on stderr only when not `--json`" pattern used elsewhere — but that convention is stated for `decay`/`consolidate`, not `timeline`, so it is an inference, not a direct requirement). **EC-2** asserts the clamp (a firm requirement) and treats the warning's exact channel/text as `Undetermined` pending `developer`/`product-engineer` confirmation, without blocking a pass verdict on the clamp itself.

### F-4 — Session-id-exists-only-in-another-bank edge case interacts with bank-scoping, not session-scoping

The story's edge-case matrix item "a session id that exists in another bank only (empty)" is a data-isolation assertion (AC4/bank-scoping composition), not a session-ordering assertion. **EC-5** is designed to prove that `--bank` and `--session` are ANDed in the filter (not that `session_id` alone resolves across banks), which is the only way "empty" is the correct expected result — this is called out explicitly because a naive implementation that filtered on `session_id` without also constraining `bank` would return cross-bank data instead of an empty result, silently violating bank isolation (a Critical-severity risk if missed).

---

## Acceptance Criteria Extraction

| ID  | Criterion (condensed)                                                                                                                                                                                 | Source AC          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| AC1 | `memo timeline --bank x --session s-42` returns episodic entries ordered by `seq` asc, then `timestamp_utc` asc, regardless of content/similarity                                                     | AC1 (PRD AC-2.5)   |
| AC2 | Without `--session`: most recent `--last` (default 50, max 500) by `timestamp_utc` desc, grouped by `session_id` — JSON `sessions: [{ session_id, entries }]`, human output with a header per session | AC2                |
| AC3 | `--since <iso>` adds a lower bound on `timestamp_utc`; invalid ISO fails `VALIDATION_FAILED`                                                                                                          | AC3                |
| AC4 | Only `kind = episodic` returned; default archived/superseded exclusions apply; no embeddings adapter constructed; `rankResults` never called (asserted)                                               | AC4                |
| AC5 | Empty bank or session exits 0 with `count: 0`; JSON envelope `{ bank, session_id?, entries                                                                                                            | sessions, count }` | AC5 |
| AC6 | Human output: `seq  timestamp  lead  id` per line (spec §10)                                                                                                                                          | AC6                |

**Non-goals** (must remain untouched — negative-space assertions): `timeline` never ranks or scores (no `similarity`/`final_score`/`confidence_tier` fields in its output, unlike `search`/`recall`); `timeline` never writes (no `setPayload`, `batchSetPayload`, `upsert`, or local-store write of any kind); `timeline` never touches `kind = self` or `kind = semantic` entries; `--bank` resolution reuses B3 unchanged (not re-tested here, only composed with); no migration-apply behavior (explicit user instruction — read-only story).

**Coverage note:** AC4's "no embeddings adapter constructed / `rankResults` never called" clause is a call-count assertion against the mocked repository/embeddings boundary rather than a purely CLI-observable behavior in the way the other ACs are. It is nonetheless included as a first-class scenario (CT-3) because the story's own Testing Requirements name it explicitly as a unit-test assertion, and the technique (asserting zero mock invocations) is the standard black-box-adjacent oracle this codebase already uses for equivalent guarantees elsewhere (e.g., `memo migrate --dry-run` asserting zero `batchSetPayload` calls per spec §18.11).

---

## E2E Black-Box Scenarios

### SC-1: Session shape returns entries in `seq` asc, then `timestamp_utc` asc, ignoring content/similarity

| Field               | Value                                                                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC1                                                                                                                                                                                                                                                                                                           |
| **Type**            | happy-path                                                                                                                                                                                                                                                                                                    |
| **Severity**        | critical                                                                                                                                                                                                                                                                                                      |
| **Preconditions**   | Bank `x` has episodic entries with `session_id = s-42`, `seq` values `3, 1, 2` written/returned by the mocked repo in scrambled order, and content engineered so a naive similarity-based read would reorder them (e.g., one entry's rationale text is near-duplicate of the query bank's most recent write). |
| **Steps**           | 1. Run `memo timeline --bank x --session s-42 --json`. 2. Parse `entries`.                                                                                                                                                                                                                                    |
| **Expected Result** | `entries` is ordered `seq = 1, 2, 3` regardless of the scrambled repo-return order and regardless of any content similarity. No `similarity`/`final_score`/`confidence_tier` field appears on any entry.                                                                                                      |
| **Pass Criteria**   | Exact `seq` ascending order. Zero ranking-related fields present. Human-mode (`memo timeline --bank x --session s-42`, no `--json`) shows the same order in `seq  timestamp  lead  id` lines.                                                                                                                 |

### SC-2: No-`--session` shape groups by `session_id`, most-recent-first, with session headers

| Field               | Value                                                                                                                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC2                                                                                                                                                                                                                                                                                                       |
| **Type**            | happy-path                                                                                                                                                                                                                                                                                                |
| **Severity**        | critical                                                                                                                                                                                                                                                                                                  |
| **Preconditions**   | Bank `x` has episodic entries spanning three sessions with interleaved `timestamp_utc` values (i.e., the repo's raw `timestamp_utc desc` scroll does not return one session's entries contiguously).                                                                                                      |
| **Steps**           | 1. Run `memo timeline --bank x --json`. 2. Parse `sessions`. 3. Run `memo timeline --bank x` (human) and inspect headers.                                                                                                                                                                                 |
| **Expected Result** | JSON: `sessions: [{ session_id, entries }]`, each group's internal entry order preserving the source `timestamp_utc desc` order, and group order preserving first-appearance order from the underlying scroll. Human: one header line per distinct `session_id`, each followed by that session's entries. |
| **Pass Criteria**   | `sessions` array groups every entry under the correct `session_id` with no entry duplicated or dropped. Human output has exactly one header per group, in the same relative order as the JSON `sessions` array.                                                                                           |

### SC-3: `--since` filters entries by `timestamp_utc` lower bound

| Field               | Value                                                                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC3                                                                                                                                                                                                                                           |
| **Type**            | happy-path                                                                                                                                                                                                                                    |
| **Preconditions**   | Bank `x` has entries with `timestamp_utc` spanning several days.                                                                                                                                                                              |
| **Severity**        | critical                                                                                                                                                                                                                                      |
| **Steps**           | 1. Run `memo timeline --bank x --since <iso-mid-range> --json`, with and without `--session`. 2. Compare returned entries against the full unfiltered set.                                                                                    |
| **Expected Result** | Only entries with `timestamp_utc >= since` are present, in both the session shape and the grouped shape. Entries strictly before the bound are absent.                                                                                        |
| **Pass Criteria**   | Zero returned entries have `timestamp_utc < since`. The boundary entry (`timestamp_utc == since` exactly) is included (inclusive lower bound per spec's `must: [{ range: { gte: since } }]`-style semantics implied by "adds a lower bound"). |

### SC-4: Invalid `--since` fails `VALIDATION_FAILED`

| Field               | Value                                                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC3                                                                                                                                                                                                |
| **Type**            | negative-path                                                                                                                                                                                      |
| **Severity**        | critical                                                                                                                                                                                           |
| **Preconditions**   | none                                                                                                                                                                                               |
| **Steps**           | 1. Run `memo timeline --bank x --since not-a-date`. 2. Run `memo timeline --bank x --since "2026-13-40"` (invalid calendar date). 3. Repeat both with `--json`.                                    |
| **Expected Result** | Both invocations exit non-zero with `VALIDATION_FAILED`. With `--json`, stderr carries `{ "error", "code": "VALIDATION_FAILED" }`. No repository call is made before validation fails (fail-fast). |
| **Pass Criteria**   | Exit code matches the documented `VALIDATION_FAILED` exit convention (per §13/existing `--as-of` precedent in `read-flags.ts`). No entries printed.                                                |

### SC-5: Only `kind = episodic` is returned, with default exclusions applied

| Field               | Value                                                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC4                                                                                                                                                                                                              |
| **Type**            | happy-path                                                                                                                                                                                                       |
| **Severity**        | critical                                                                                                                                                                                                         |
| **Preconditions**   | Bank `x` has a mix of `self`, `episodic`, and `semantic` entries, plus episodic entries that are `archived = true` and `superseded = true`.                                                                      |
| **Steps**           | 1. Run `memo timeline --bank x --json` (no session). 2. Run `memo timeline --bank x --session s-42 --json`.                                                                                                      |
| **Expected Result** | No `self` or `semantic` entry ever appears in either shape. No `archived = true` or `superseded = true` episodic entry appears (default exclusions, matching `buildBaseFilter`'s documented `must_not` clauses). |
| **Pass Criteria**   | 100% of returned entries have `kind = episodic`, `archived != true`, `superseded != true`, in both shapes.                                                                                                       |

### SC-6: Empty bank/session exits 0 with `count: 0` and the documented envelope

| Field               | Value                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC5                                                                                                                                                                                                        |
| **Type**            | happy-path (boundary)                                                                                                                                                                                      |
| **Severity**        | critical                                                                                                                                                                                                   |
| **Preconditions**   | Bank `empty-bank` has zero entries; bank `x` has entries but none with `session_id = ghost-session`.                                                                                                       |
| **Steps**           | 1. Run `memo timeline --bank empty-bank --json`. 2. Run `memo timeline --bank x --session ghost-session --json`. 3. Repeat both in human mode.                                                             |
| **Expected Result** | Both exit `0`. JSON: `{ bank, session_id?, entries: [] or sessions: [], count: 0 }` — `session_id` present only in the session-shape call. Human mode prints an empty/no-entries indication, not an error. |
| **Pass Criteria**   | Exit code `0` in all four invocations. `count === 0`. No exception, no non-empty error object.                                                                                                             |

### SC-7: JSON envelope shape matches §6.1 exactly for both query shapes

| Field               | Value                                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC5                                                                                                                                                                                                                                                                                                                                                            |
| **Type**            | happy-path                                                                                                                                                                                                                                                                                                                                                     |
| **Severity**        | critical                                                                                                                                                                                                                                                                                                                                                       |
| **Preconditions**   | Bank `x` seeded with episodic entries across ≥ 2 sessions.                                                                                                                                                                                                                                                                                                     |
| **Steps**           | 1. `memo timeline --bank x --session s-42 --json` → inspect top-level keys. 2. `memo timeline --bank x --json` → inspect top-level keys and each `sessions[i]` shape.                                                                                                                                                                                          |
| **Expected Result** | Session shape: `{ bank, session_id, entries, count }`, no `sessions` key. Grouped shape: `{ bank, entries: undefined/absent, sessions: [{ session_id, entries }], count }`, no top-level `session_id` key. `count` equals the total number of entries returned (summed across sessions in the grouped shape, or the length of `entries` in the session shape). |
| **Pass Criteria**   | Exactly the documented keys are present per shape (no extraneous top-level keys); `count` is arithmetically correct in both shapes.                                                                                                                                                                                                                            |

### SC-8: Human output line format matches `seq  timestamp  lead  id`

| Field               | Value                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC6                                                                                                                                                                                                          |
| **Type**            | happy-path                                                                                                                                                                                                   |
| **Severity**        | major                                                                                                                                                                                                        |
| **Preconditions**   | Bank `x`, session `s-42`, ≥ 2 episodic entries with distinct `seq`/`timestamp_utc`/rationale/id.                                                                                                             |
| **Steps**           | 1. Run `memo timeline --bank x --session s-42` (no `--json`). 2. Snapshot stdout.                                                                                                                            |
| **Expected Result** | Each entry renders as a single line `seq  timestamp  lead  id` (fields in that order, whitespace-separated per the existing output-helper convention), with no score/tier prefix (unlike `search`/`recall`). |
| **Pass Criteria**   | Line-format snapshot matches; `seq` renders as the raw integer; `id` is the last token on the line.                                                                                                          |

---

## Contract Validation Scenarios

Contracts under test:

| Boundary                                                             | Type            | Consumer                                                                 | Provider                                  |
| -------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------ | ----------------------------------------- |
| `memo timeline --json` envelope shape                                | provider-driven | future `recall` (S2-07) `LAST SESSION` reuse, dev-tasks consumer (S2-10) | `timeline.ts`                             |
| CLI flag contract (`--bank`/`--session`/`--last`/`--since`/`--json`) | consumer-driven | CLI users / dev-tasks agents                                             | `timeline.ts` arg parser                  |
| Zero-embeddings / zero-ranking call contract                         | provider-driven | AC4 audit, future `recall` reuse guidance                                | `timeline.ts` internals (mocked boundary) |

### CT-1: `memo timeline --json` envelope is a stable superset for downstream consumers

| Field               | Value                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC5                                                                                                                                                                                                                                                                                                                                                                               |
| **Contract type**   | provider-driven                                                                                                                                                                                                                                                                                                                                                                   |
| **Boundary**        | `memo timeline --json` stdout                                                                                                                                                                                                                                                                                                                                                     |
| **Direction**       | response                                                                                                                                                                                                                                                                                                                                                                          |
| **Input**           | Session shape and grouped shape, each with ≥ 1 and 0 entries.                                                                                                                                                                                                                                                                                                                     |
| **Expected Result** | `{ bank: string, session_id?: string, entries?: Entry[], sessions?: { session_id: string, entries: Entry[] }[], count: number }`. `session_id` and `entries` present together only in session shape; `sessions` present only in grouped shape. Every `Entry` carries at minimum `id`, `seq`, `timestamp_utc`, `rationale` (or the field the story's "lead" concept renders from). |
| **Pass Criteria**   | Type/shape matches for all four input combinations (session×populated, session×empty, grouped×populated, grouped×empty). This is the exact contract §18.9's `LAST SESSION` section (recall, S2-07) will consume via `scrollOrdered` — a shape break here breaks that downstream story silently.                                                                                   |

### CT-2: CLI flag contract — required/optional flags and defaults

| Field               | Value                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC1, AC2, AC3                                                                                                                                                                                                            |
| **Contract type**   | consumer-driven                                                                                                                                                                                                          |
| **Boundary**        | `memo timeline` CLI argument parser                                                                                                                                                                                      |
| **Direction**       | request                                                                                                                                                                                                                  |
| **Input**           | (a) no flags beyond `--bank`; (b) `--last` omitted; (c) `--last` explicit; (d) `--since` omitted; (e) `--json` omitted vs. present.                                                                                      |
| **Expected Result** | (a) works, defaults to grouped shape. (b) defaults `--last` to 50. (c) explicit value is honored (subject to the 500 clamp, see EC-2). (d) no lower bound applied. (e) human output by default, JSON only with `--json`. |
| **Pass Criteria**   | Every default matches the documented value (50 / no lower bound / human output) with zero flags beyond `--bank`.                                                                                                         |

### CT-3: Zero-embeddings, zero-ranking call contract (AC4)

| Field               | Value                                                                                                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC4                                                                                                                                                                                                                                                                        |
| **Contract type**   | provider-driven                                                                                                                                                                                                                                                            |
| **Boundary**        | `createEmbeddings` / `rankResults` call surface, asserted via mocks in `tests/unit/commands/timeline.test.ts`                                                                                                                                                              |
| **Direction**       | response (internal call trace as the "response" under contract)                                                                                                                                                                                                            |
| **Input**           | Both query shapes, with entries whose content is deliberately similarity-clustered (to make a false-positive ranking call detectable if one occurred).                                                                                                                     |
| **Expected Result** | `createEmbeddings` (or the embeddings-adapter constructor) is never invoked. `rankResults` is never invoked. Zero calls in every scenario, not just the happy path.                                                                                                        |
| **Pass Criteria**   | Mock call count for both functions is exactly `0` across SC-1, SC-2, SC-3, SC-5, SC-6. This is the exact technique the codebase already applies to `migrate --dry-run`'s zero-`batchSetPayload` assertion (spec §18.11), reused here per the story's Testing Requirements. |

---

## Edge-Case Catalog

Categories evaluated: Input Domain, State Transitions, Timing, Idempotency, Failure Modes, Data Boundaries. Auth/Permissions, Resource Exhaustion, and API Versioning are declared `N/A` for this read-only, single-command, non-paginated-beyond-`--last` story, with justification below.

### 1. Input Domain

### EC-1: `--last 0` is rejected

| Field               | Value                                                                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC2 (implicit — see **F-1**)                                                                                                                                                                                                                              |
| **Category**        | Input Domain                                                                                                                                                                                                                                              |
| **Input / Setup**   | `memo timeline --bank x --last 0`.                                                                                                                                                                                                                        |
| **Expected Result** | Command rejects with a non-zero exit and a validation error (treated as `VALIDATION_FAILED` per **F-1**'s reasoning; the exact code is confirmed during implementation, not asserted as `undetermined` in the pass gate but documented as an assumption). |
| **Risk if Missed**  | A `--last 0` that silently succeeds with an empty result (rather than being rejected) is indistinguishable from "bank has zero entries," hiding a user input mistake behind a false-negative-looking empty timeline.                                      |

### EC-2: `--last 501` is clamped to 500 with a warning

| Field               | Value                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC2                                                                                                                                                                                                                                   |
| **Category**        | Input Domain, Data Boundaries                                                                                                                                                                                                         |
| **Input / Setup**   | Bank `x` with ≥ 501 episodic entries (mocked). `memo timeline --bank x --last 501`.                                                                                                                                                   |
| **Expected Result** | Effective limit used is `500`, not `501` (verified via the mocked repo call's `limit` argument and/or by returned entry count capping at 500). A warning is emitted (channel/text `undetermined` per **F-3**). Exit code remains `0`. |
| **Pass Criteria**   | Repository call limit argument is `500`. Exit `0`. Presence of _some_ warning signal is checked; exact channel/text is recorded as evidence, not gated, per F-3.                                                                      |

### EC-3: `--last` at exact boundaries `1`, `500`, and default `50`

| Field               | Value                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC2                                                                                                                                                               |
| **Category**        | Data Boundaries                                                                                                                                                   |
| **Input / Setup**   | `--last 1`, `--last 500` (no clamp/warning expected), and omitted `--last` (defaults to 50), each against a bank with more entries than the limit.                |
| **Expected Result** | `--last 1` returns exactly 1 entry (the most recent). `--last 500` returns up to 500 with no warning (500 is the ceiling, not over it). Default returns up to 50. |
| **Pass Criteria**   | Returned counts match the requested/default limit exactly (capped by available data). No spurious clamp warning at exactly `500`.                                 |

### 2. State Transitions / Data Composition

### EC-4: Two entries with equal `seq` (explicit-`--seq` collision) tie-break on `timestamp_utc` asc

| Field               | Value                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC1                                                                                                                                                                                                                                                                                                                                                  |
| **Category**        | State Transitions (data-shape edge)                                                                                                                                                                                                                                                                                                                  |
| **Input / Setup**   | Bank `x`, session `s-42`, two entries both with `seq = 4` (simulating an explicit `--seq` collision per spec §18.8's stated cause) but different `timestamp_utc`.                                                                                                                                                                                    |
| **Expected Result** | The entry with the earlier `timestamp_utc` sorts first among the `seq = 4` pair; overall ordering remains `seq` asc with the tie resolved by `timestamp_utc` asc, per spec §18.8/§13.                                                                                                                                                                |
| **Pass Criteria**   | Deterministic order matching `timestamp_utc` asc for the tied pair, stable across repeated runs (not dependent on the mocked repo's return order for the tied pair). Per **F-2**, an auto-`seq`-assigned collision (rather than explicit `--seq`) is out of this story's tie-break scope and is flagged `Undetermined` if observed, not failed here. |

### EC-5: A session id that exists only in another bank returns empty

| Field               | Value                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC1, AC4, AC5                                                                                                                                                                                    |
| **Category**        | State Transitions / Data Isolation                                                                                                                                                               |
| **Input / Setup**   | Bank `bank-a` has episodic entries with `session_id = shared-session`. Bank `bank-b` has none with that `session_id`. Run `memo timeline --bank bank-b --session shared-session --json`.         |
| **Expected Result** | Empty result: `entries: [], count: 0`, exit `0` — per **F-4**, this proves `--bank` and `--session` are ANDed in the repository filter, not that `session_id` alone is globally unique/resolved. |
| **Pass Criteria**   | Zero entries from `bank-a` leak into the `bank-b` query. This is a Critical-severity data-isolation gate, not merely a cosmetic empty-result check.                                              |

### 3. Timing

### EC-6: `--since` at the exact boundary of an entry's `timestamp_utc`

| Field               | Value                                                                                                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC3                                                                                                                                                                                                                                                               |
| **Category**        | Timing                                                                                                                                                                                                                                                            |
| **Input / Setup**   | An entry with `timestamp_utc` exactly equal to the `--since` value supplied.                                                                                                                                                                                      |
| **Expected Result** | The boundary entry is included (inclusive lower bound), consistent with SC-3's stated inclusive semantics.                                                                                                                                                        |
| **Risk if Missed**  | An off-by-one (exclusive instead of inclusive) bound would silently drop the exact-boundary entry, which is especially likely to be the entry a user is specifically querying for when they picked that `--since` value (e.g., "since the last session started"). |

### 4. Idempotency

### EC-7: Repeated identical invocations return identical output

| Field               | Value                                                                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC1, AC2                                                                                                                                                                                                                               |
| **Category**        | Idempotency                                                                                                                                                                                                                            |
| **Input / Setup**   | Run the same `memo timeline --bank x --session s-42 --json` twice in a row against unchanged mock data.                                                                                                                                |
| **Expected Result** | Byte-identical JSON output (aside from any non-deterministic fields, of which `timeline` should have none — no `query_id`, no timestamps generated at read time).                                                                      |
| **Risk if Missed**  | Since `timeline` is documented as "never ranked," any nondeterminism between identical calls would indicate an accidental ranking/randomization leak (e.g., an unstable sort) — directly contradicting the story's core business rule. |

### 5. Failure Modes

### EC-8: Missing `--bank` / unresolvable bank

| Field               | Value                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC1, AC2 (bank resolution B3 composition)                                                                                                                                                                   |
| **Category**        | Failure Modes                                                                                                                                                                                               |
| **Input / Setup**   | `memo timeline` with no `--bank` flag, no `MEMO_BANK` env var, no `bank.default` config — the B3 resolution chain fully unset.                                                                              |
| **Expected Result** | Falls back to the documented B3 default (per existing bank-resolution behavior, established prior to this story) rather than crashing; this scenario re-verifies composition, not B3 itself.                |
| **Pass Criteria**   | No unhandled exception; either resolves to `kb` (documented B3 default) or surfaces the same validation error B3 already defines elsewhere — behavior consistent with other v2 commands' `--bank` handling. |

### 6. Data Boundaries

### EC-9: Empty `sessions` array vs. absent `sessions` key in the grouped shape with zero entries

| Field               | Value                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC5                                                                                                                                                                                                     |
| **Category**        | Data Boundaries                                                                                                                                                                                         |
| **Input / Setup**   | Grouped-shape call (`memo timeline --bank empty-bank --json`, no `--session`) against a bank with zero episodic entries.                                                                                |
| **Expected Result** | `sessions: []` (an empty array), not `sessions: undefined`/omitted, and not a single group with an empty `entries` array — SC-6/CT-1 constrain this, this case isolates the specific zero-groups shape. |
| **Pass Criteria**   | `sessions` is present and is `[]`. `count: 0`.                                                                                                                                                          |

### 7. Auth & Permissions

**N/A — no new auth surface.** `timeline` reads through the same `QdrantRepository` credential model as every other v2 read command; it introduces no new identity, permission, or credential type.

### 8. Resource Exhaustion

**N/A beyond the `--last` clamp.** `--last` is capped at 500 by design (EC-2/EC-3); there is no other unbounded user-supplied input (`--session`/`--since`/`--bank` are single-value filters, not size-controlling). The 500 clamp is the resource-exhaustion control and is already covered.

### 9. API Versioning

**N/A for this story.** `timeline` is a new command in the 1.3.0 contract (§18.12); there is no prior version of its JSON envelope to remain compatible with. Forward compatibility toward S2-07's `recall` `LAST SESSION` reuse is covered by **CT-1** instead of a versioning edge case.

---

## Randomized Tactics and Seed Policy

Seed format: `<tactic-type>-<AC-id>-<unix-timestamp>-<4-hex>`
Replay: `pnpm test -- --testPathPattern="timeline" --seed=<captured-seed>`

Seeds **MUST** be recorded in the run log and in any failure report. On failure, follow the `verifier` Failure Triage Workflow (capture → replay → minimize → classify → report), with a maximum of 3 reproduction attempts before marking `inconclusive`.

### RT-1: Property — scrambled-order mock input always yields correctly sorted output (session shape)

| Field                  | Value                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**              | AC1                                                                                                                                                                                                                                                                                                                                                        |
| **Tactic type**        | property-based                                                                                                                                                                                                                                                                                                                                             |
| **Input surface**      | Randomly generated arrays of 1–200 synthetic episodic entries with random `seq` (small integer range, with intentional duplicates at low probability), random `timestamp_utc` offsets, random content strings (some near-duplicate to simulate similarity clustering), fed to the mocked repo's `scrollOrdered` return value in a randomly shuffled order. |
| **Property / Oracle**  | The command's output is always sorted by `seq` asc, then `timestamp_utc` asc for ties, regardless of the input array's order and regardless of content similarity. No entry is dropped or duplicated (output length equals input length, subject to `--last`).                                                                                             |
| **Iterations**         | 500                                                                                                                                                                                                                                                                                                                                                        |
| **Seed**               | `prop-AC1-{timestamp}-{hex}`                                                                                                                                                                                                                                                                                                                               |
| **Replay instruction** | `pnpm test -- --testPathPattern="timeline" --seed=<seed> --iterations=1`                                                                                                                                                                                                                                                                                   |
| **Shrink strategy**    | Reduce the entry array to the smallest subset that still produces an out-of-order result; then reduce distinct `seq`/`timestamp_utc` value pairs within that subset.                                                                                                                                                                                       |

### RT-2: Property — scrambled-order mock input always yields correctly sorted-and-grouped output (no-session shape)

| Field                  | Value                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**              | AC2                                                                                                                                                                                                                                                                                                    |
| **Tactic type**        | property-based                                                                                                                                                                                                                                                                                         |
| **Input surface**      | Randomly generated arrays of 1–200 synthetic episodic entries spanning 1–20 distinct `session_id` values, random `timestamp_utc`, fed to the mocked repo's `scroll` return value in random (but internally `timestamp_utc`-desc-respecting, per the documented `scroll()` contract) interleaved order. |
| **Property / Oracle**  | Every output group's `entries` array is internally in the same relative order as the input for that `session_id` (grouping is stable, not re-sorting within group). Every input entry appears in exactly one output group. `count` equals total input length (subject to `--last`).                    |
| **Iterations**         | 500                                                                                                                                                                                                                                                                                                    |
| **Seed**               | `prop-AC2-{timestamp}-{hex}`                                                                                                                                                                                                                                                                           |
| **Replay instruction** | `pnpm test -- --testPathPattern="timeline" --seed=<seed> --iterations=1`                                                                                                                                                                                                                               |
| **Shrink strategy**    | Reduce to the smallest set of sessions (target 2) and smallest per-session entry count that still reproduces a grouping/ordering violation.                                                                                                                                                            |

---

## Execution Checklist

Pre-implementation (test-first — these should fail before code exists):

- [ ] Scaffold `tests/unit/commands/timeline.test.ts` with SC-1/SC-2/SC-5/EC-1/EC-2/CT-3 as failing tests.
- [ ] Scaffold `tests/integration/commands/timeline.test.ts` with the three-entries-in-`seq`-order scenario (SC-1's integration analog) as a failing test.
- [ ] Add RT-1/RT-2 property harnesses with seed capture wired in before `timeline.ts` is implemented.

During implementation:

- [ ] SC-1 … SC-8 pass.
- [ ] CT-1 … CT-3 pass.
- [ ] EC-1 … EC-9 pass, with EC-2's warning channel/text recorded as evidence (not blocking) per F-3, and EC-4's auto-`seq`-collision branch recorded as `Undetermined` per F-2 if ever observed.
- [ ] RT-1, RT-2 executed; seeds recorded in the run log.

Quality gates:

- [ ] `pnpm test -- --testPathPattern="timeline"` — targeted green (unit + integration).
- [ ] `pnpm test`, `pnpm run lint`, `pnpm run format:check`, `pnpm run typecheck`, `pnpm audit` — full quality gate per AGENTS.md/task 6.14.
- [ ] Manual: on `memo_eval`, after S2-04's manual writes, `memo timeline --bank <b> --session <s>` and without `--session` (task 6.9).
- [ ] `README.md` command section and `docs/system-overview.md` updated (task 6.13).
- [ ] `verifier` Audit Mode run (task 6.15, mandatory pre-PR-ready).

Negative-space checks (non-goals stay untouched):

- [ ] No `similarity`/`final_score`/`confidence_tier`/`stale`/`stale_by` field ever appears on a `timeline` entry.
- [ ] No `setPayload`/`batchSetPayload`/`upsert`/local-store write call occurs at any point in any `timeline` invocation (asserted on mocks, same technique as CT-3).
- [ ] No `self` or `semantic`-kind entry ever appears in `timeline` output.
- [ ] No migration-apply behavior tested or implemented for this story (explicit read-only scope).

---

## Recommendations

| #   | Finding                                                                                                    | Owner              | Recommended action                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **F-1** — `--last 0` rejection has no assigned error code in any AC                                        | `product-engineer` | Confirm `VALIDATION_FAILED` is the intended code for `--last 0` (and any other out-of-range `--last`) and state it explicitly in the story/spec.                             |
| 2   | **F-2** — "equal `seq`" edge case in the story's matrix is broader than the mechanism spec §18.8 describes | `developer`        | Confirm auto-assigned `seq` collisions are structurally impossible (guaranteed by S2-02's auto-increment scroll); if not, document the tie-break scope explicitly.           |
| 3   | **F-3** — `--last 501` clamp warning channel/text is unspecified                                           | `product-engineer` | Decide and document the warning's channel (stderr, presumably) and message text so EC-2's `undetermined` branch becomes a firm gate.                                         |
| 4   | **F-4** — Cross-bank session-id isolation is implied but not stated as its own AC                          | `product-engineer` | Consider promoting the bank/session AND-composition guarantee (EC-5) to an explicit acceptance criterion in a future refinement pass, given its Critical severity if broken. |

---

## Output Contract

| Field                  | Value                                                                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mode**               | Design                                                                                                                                                                                                                                   |
| **Phase**              | 4 — Reporting & Publication (complete)                                                                                                                                                                                                   |
| **Source artifact**    | `workstream/user-stories-prd-004-phase-2.md` (Story S2-06)                                                                                                                                                                               |
| **Artifacts produced** | `workstream/test-plan-issue-85.md`, `workstream/traceability-matrix-issue-85.md`                                                                                                                                                         |
| **GitHub issue**       | [#85](https://github.com/llipe/memo-cli/issues/85)                                                                                                                                                                                       |
| **AC coverage**        | 6/6 addressed. AC1–AC6 all covered by ≥ 1 positive + ≥ 1 negative/edge scenario.                                                                                                                                                         |
| **Scenario counts**    | 8 E2E, 3 contract, 9 edge-case, 2 randomized                                                                                                                                                                                             |
| **Blocking gaps**      | None for design. Four items require `product-engineer`/`developer` clarification before a firm pass/fail verdict on specific edge branches: **F-1, F-2, F-3, F-4** — none block AC1–AC6's primary happy-path or negative-path scenarios. |
