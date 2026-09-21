# Compliance Test Plan — Issue #83: `memo write` v2 — banks, kinds, sessions, supersede (S2-04)

> Produced by **`verifier`** (Design Mode) on 2026-09-21. Pre-implementation. Black-box: all assertions derive from observable CLI/JSON behavior, not internal code structure. Current `src/commands/write.ts` (v1.2.0) was read only to ground scenario shape (flag names, error codes, output envelope) in the real command surface — this remains Design Mode, not an audit of delivered code.

## Changelog

| Version | Date       | Summary           | Author   |
| ------- | ---------- | ----------------- | -------- |
| 1.0     | 2026-09-21 | Initial test plan | verifier |

## Source Input Summary

| Field               | Value                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Repository**      | `llipe/memo-cli`                                                                                                                                                                              |
| **GitHub Issue**    | [#83](https://github.com/llipe/memo-cli/issues/83)                                                                                                                                            |
| **Input type**      | `story`                                                                                                                                                                                       |
| **Source artifact** | `workstream/user-stories-prd-004-phase-2.md` — Story S2-04                                                                                                                                    |
| **Also binding**    | `workstream/specification-prd-004-long-lived-agent-memory.md` §8.3 (write path), §18.6 (eleven-step order); `docs/requirements/prd-004-long-lived-agent-memory.md` §2.5 K1–K5, AC-2.1/2.2/2.8 |
| **Task list**       | `workstream/tasks-prd-004-phase-2-plan.md`, task 4.0                                                                                                                                          |
| **Current code**    | `src/commands/write.ts` (v1.2.0 baseline — read for grounding only, not yet modified for this story)                                                                                          |
| **ACs extracted**   | 11 (AC1 … AC11)                                                                                                                                                                               |
| **Traceability**    | `workstream/traceability-matrix-issue-83.md`                                                                                                                                                  |

Observable surfaces available to black-box testing:

1. `memo write [flags]` — exit code, stdout/stderr, human and `--json` output envelopes.
2. `memo write --json` — the result object: full v2 payload plus `created`, `updated`, `duplicate_detected`, `superseded?`, `warnings?`.
3. Follow-up `memo read --id <id>` / direct point retrieval (via `getById`, exercised at the integration layer since `memo read` itself ships in S2-05) — used to observe the target-side effects of `--supersedes` (`valid_to`, `superseded`, `superseded_by`).
4. Repeated `memo write` invocations against the same bank/session — used to observe `nextSeq` and soft-cap behavior across calls.
5. Environment variables `MEMO_BANK`, `QDRANT_URL`, `QDRANT_API_KEY` as write-time bank/collection resolution inputs.
6. Error codes and exit codes: `VALIDATION_FAILED` (1), `REPO_CONTEXT_UNRESOLVED` (1), `ENTRY_NOT_FOUND` (1 or documented equivalent), `QDRANT_OPERATION_FAILED` (2).

---

## Pre-Implementation Findings

Design-time analysis surfaced items that affect how the ACs must be tested. All are reported, not fixed — remediation belongs to `developer`; scope questions belong to `product-engineer`.

### F-1 — `ENTRY_NOT_FOUND` exit code is not stated in the story text (Minor, needs confirmation)

AC7 states a missing `--supersedes` target "fails `ENTRY_NOT_FOUND`" but does not state the exit code, whereas AC1 and AC8 are explicit (`exits 1`, `exits 2`). Every other `*_FAILED`/`*_UNRESOLVED` code in this codebase's existing error taxonomy exits `1`. **SC-9** asserts exit `1` for `ENTRY_NOT_FOUND` as the most-consistent reading, and records the actual exit code as evidence for `product-engineer` confirmation if it differs — this does not block the design-time verdict.

### F-2 — Soft-cap warning count (`<n>`) is ambiguous at count-time (Minor)

AC9 and the Edge-Case Matrix both name the warning text `self entries in <bank>: <n> (soft cap <cap>)` but do not specify whether `<n>` is the count observed _before_ this write (i.e., `count()` result used in the gate check) or _after_ (count + 1, including the entry just stored). Spec §18.6 step 7 runs the `count()` check before the upsert (step 9), which suggests `<n>` is the pre-write count. **SC-7**/**EC-4** assert the pre-write count reading as the primary expectation and record the actual value as evidence if the implementation reads differently.

### F-3 — `--supersedes` self-reference guard has no error code specified (Minor)

The story's Edge-Case Matrix names the guard ("`--supersedes` pointing at itself... guard `target.id === id`") but neither the story nor spec §18.6 states which error code fires. Since the target is fetched by `getById` immediately after the new id is generated and before validation of "same bank/kind," and a self-reference is by definition an impossible pre-write state (the new id does not exist yet when `getById` runs), this can only be reached if a caller passes an id that happens to _equal_ the not-yet-assigned new id — which cannot happen through the CLI's own id generation. **EC-6** treats this as a defensive/unreachable-in-practice guard and records whichever code is emitted (most likely `VALIDATION_FAILED`, consistent with AC7's family of guards) without treating a difference as a hard fail.

### F-4 — v1→v2 migration/read compatibility is out of this story's runtime scope (informational, not a defect)

Per the user story's Migration Requirements, this story does **not** migrate existing v1 points, and no migration-apply test is in scope here (that is S2-09). The only compatibility obligation for S2-04 is a **rollback/compatibility note**: a v2 point written by 1.3.0's `memo write` must remain readable by memo-cli 1.2.x as an ordinary (extra-fields-ignored) entry, since 1.2.x's read paths do not parse `schema_version` or the new v2 fields. This is captured as a documentation/compatibility check in the Execution Checklist, not as a behavioral scenario, since it requires cross-version code that is out of this story's build.

---

## Acceptance Criteria Extraction

| ID   | Criterion (condensed)                                                                                                                                                                                                           | Source AC           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| AC1  | `--kind self` in `kb` → exit 1 `VALIDATION_FAILED`; in `MEMO_BANK=jarvis-memory` (no `--repo`) → succeeds, payload has `bank=jarvis-memory`, `kind=self`, `schema_version="2"`, `valid_from`, no retention fields               | AC-2.1              |
| AC2  | No `--kind`: `episodic` in a private bank, `semantic` in `kb`                                                                                                                                                                   | AC-2.2              |
| AC3  | `kb` missing `repo/org/domain` → `REPO_CONTEXT_UNRESOLVED`; private bank: optional, stored when given                                                                                                                           | K2                  |
| AC4  | Episodic `--session s-42` no `--seq` → `seq = max(existing) + 1`, `0` when none; `expires_at` from policy (30 private / 90 kb) or `--expires-in` (`2d`/`12h`/`30m`; else `VALIDATION_FAILED`)                                   | §18.6 step 4        |
| AC5  | `entry_type` default `observation` (episodic) / `decision` (else); `--manual` forces `source=manual`; `--source scan` accepted                                                                                                  | §18.6 step 3        |
| AC6  | `--kind semantic --source agent` without `--provenance` and without `--manual` → `VALIDATION_FAILED` at `provenance`                                                                                                            | K3                  |
| AC7  | `--supersedes <id>`: new entry stored, then target gets `valid_to=now`, `superseded=true`, `superseded_by=<new id>`; different bank/kind/already-superseded → `VALIDATION_FAILED` before any write; missing → `ENTRY_NOT_FOUND` | AC-2.8 (write half) |
| AC8  | Target update fails post-upsert → exit 2 `QDRANT_OPERATION_FAILED`, message names both new id and target id                                                                                                                     | §18.6 step 10       |
| AC9  | `self` write at `>= soft_cap` non-superseded `self` entries → succeeds, warns `self entries in <bank>: <n> (soft cap <cap>)` (stderr human / `warnings: []` JSON)                                                               | §18.6 step 7        |
| AC10 | Dedupe via `buildDedupeKeyV2`; `kb` semantic also checks v1 key; `self` never dedupes; existing `--on-duplicate`/TTY prompt unchanged                                                                                           | A7, §18.5           |
| AC11 | JSON result = full v2 payload + `created`, `updated`, `duplicate_detected`, `superseded?`, `warnings?`; pre-existing keys unchanged                                                                                             | §18.6 step 11       |

**Non-goals** (must remain untouched — negative-space assertions): no change to read-side commands (`search`, `list`, `tags`, `read`, `timeline`, `recall` — S2-05/S2-08/S2-09 scope); no migration/rewrite of existing v1 points (S2-09); no change to the shipped duplicate-prompt TTY interaction code path itself (only the dedupe _key_ changes, per Technical Notes: "keep the shipped duplicate-prompt code untouched"); no ranking/consolidation behavior change.

**Coverage note:** AC10's "existing `--on-duplicate` actions and TTY prompt behave as before" clause is a regression/non-goal assertion as much as a positive AC — it is covered by both a positive scenario (dedupe v2 key computation) and a negative-space check in the Execution Checklist (unchanged prompt behavior, not independently re-tested end-to-end since that behavior is out of this story's Files-to-Modify list beyond the dedupe key itself).

---

## E2E Black-Box Scenarios

### SC-1: `--kind self` in `kb` is rejected; the same write succeeds in a private bank via `MEMO_BANK`

| Field               | Value                                                                                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC1                                                                                                                                                                                                                                                                            |
| **Type**            | happy-path + negative-path (paired)                                                                                                                                                                                                                                            |
| **Severity**        | critical                                                                                                                                                                                                                                                                       |
| **Preconditions**   | No `MEMO_BANK` set (bank resolves to `kb` by default per B3).                                                                                                                                                                                                                  |
| **Steps**           | 1. Run `memo write --kind self -r "..." -t a,b --json` with no `MEMO_BANK`. 2. Capture exit code and stderr/JSON error. 3. Re-run with `MEMO_BANK=jarvis-memory` and no `--repo`/`--org`/`--domain`. 4. Inspect the stored payload (`--json` result).                          |
| **Expected Result** | Step 1: exit `1`, error code `VALIDATION_FAILED`. Step 3: exit `0`; payload has `bank = "jarvis-memory"`, `kind = "self"`, `schema_version = "2"`, `valid_from` set to an ISO timestamp; no `stability`, `stability_since`, `expires_at`, or retrieval-counter fields present. |
| **Pass Criteria**   | Step 1 error code and exit code match exactly. Step 3's payload has all four named fields and none of the four named-absent retention fields (`stability`, `expires_at`, `retrieval_count`, `used_count` all `undefined`/absent).                                              |

### SC-2: Default `--kind` resolves by bank type

| Field               | Value                                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC2                                                                                                                                                                                             |
| **Type**            | happy-path                                                                                                                                                                                      |
| **Severity**        | critical                                                                                                                                                                                        |
| **Preconditions**   | Two writes, no `--kind` flag on either.                                                                                                                                                         |
| **Steps**           | 1. `MEMO_BANK=jarvis-memory memo write -r "..." -t a,b --json` (private bank, no `--kind`). 2. `memo write -r "..." -t a,b --json` (default bank = `kb`, no `--kind`, with valid repo context). |
| **Expected Result** | Step 1 result payload has `kind = "episodic"`. Step 2 result payload has `kind = "semantic"`.                                                                                                   |
| **Pass Criteria**   | Both `kind` values match exactly; no other flag changes kind resolution.                                                                                                                        |

### SC-3: Repo-context enforcement differs by bank

| Field               | Value                                                                                                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC3                                                                                                                                                                                                                                                      |
| **Type**            | happy-path + negative-path (paired)                                                                                                                                                                                                                      |
| **Severity**        | critical                                                                                                                                                                                                                                                 |
| **Preconditions**   | No config-file `repo`/`org`/`domain` defaults resolvable (simulate a clean/CI environment or explicitly unset via config mock at the integration layer).                                                                                                 |
| **Steps**           | 1. `memo write -r "..." -t a,b --json` targeting `kb` with none of `--repo`/`--org`/`--domain` and no config defaults. 2. `MEMO_BANK=jarvis-memory memo write -r "..." -t a,b --json` with the same omissions. 3. Repeat step 2 but supply `--repo foo`. |
| **Expected Result** | Step 1: exit `1`, `REPO_CONTEXT_UNRESOLVED`. Step 2: exit `0`, payload has no `repo`/`org`/`domain` (all absent, not empty string). Step 3: exit `0`, payload has `repo = "foo"`, `org`/`domain` absent.                                                 |
| **Pass Criteria**   | Step 1 error code exact match. Step 2 fields genuinely absent (not `null`, not `""`). Step 3 stores exactly the supplied optional field and no others.                                                                                                   |

### SC-4: Auto-`seq` increments per bank+session; explicit `--seq` is honored as given

| Field               | Value                                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC4                                                                                                                                                                                                                                                                                                     |
| **Type**            | happy-path                                                                                                                                                                                                                                                                                              |
| **Severity**        | critical                                                                                                                                                                                                                                                                                                |
| **Preconditions**   | A private bank with no prior episodic entries in session `s-42`.                                                                                                                                                                                                                                        |
| **Steps**           | 1. `memo write --kind episodic --session s-42 -r "..." -t a,b --json` (no `--seq`) — capture `seq`. 2. Repeat identically — capture `seq`. 3. Repeat a third time with `--seq 0` explicitly (lower than current max). 4. Repeat once more with no `--seq`.                                              |
| **Expected Result** | Step 1 `seq = 0`. Step 2 `seq = 1`. Step 3 stores `seq = 0` exactly as given (duplicate value allowed, not rejected, not auto-bumped). Step 4 `seq = 2` (computed from the true max of `{0, 1, 0}` = `1`, so next = `2`), independent of step 3's explicit low value having been the most recent write. |
| **Pass Criteria**   | Each `seq` value matches exactly. Step 3 confirms explicit `--seq` is stored verbatim without collision-avoidance logic. Step 4 confirms `nextSeq` computes from the max, not from the most-recently-written entry.                                                                                     |

### SC-5: `--expires-in` overrides bank policy default; policy default applies when omitted

| Field               | Value                                                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC4                                                                                                                                                                                                                                 |
| **Type**            | happy-path                                                                                                                                                                                                                          |
| **Severity**        | critical                                                                                                                                                                                                                            |
| **Preconditions**   | One private-bank episodic write, one `kb` episodic write, each with valid session/repo context as required.                                                                                                                         |
| **Steps**           | 1. Episodic write in a private bank, no `--expires-in`. 2. Episodic write in `kb`, no `--expires-in`. 3. Episodic write in a private bank with `--expires-in 2d`. 4. Same with `--expires-in 12h`. 5. Same with `--expires-in 30m`. |
| **Expected Result** | Step 1: `expires_at ≈ timestamp_utc + 30 days`. Step 2: `expires_at ≈ timestamp_utc + 90 days`. Steps 3–5: `expires_at` offset by exactly 2 days / 12 hours / 30 minutes from `timestamp_utc`, overriding the policy default.       |
| **Pass Criteria**   | Each computed offset matches within a small tolerance (≤ a few seconds, to allow for command execution time) of the expected duration.                                                                                              |

### SC-6: `entry_type` and `source` defaults and overrides

| Field               | Value                                                                                                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC5                                                                                                                                                                                                                                                                                                        |
| **Type**            | happy-path                                                                                                                                                                                                                                                                                                 |
| **Severity**        | critical                                                                                                                                                                                                                                                                                                   |
| **Preconditions**   | —                                                                                                                                                                                                                                                                                                          |
| **Steps**           | 1. Episodic write, no `--entry-type`, no `--source`, no `--manual`. 2. Semantic write, no `--entry-type`, no `--source`, no `--manual`, with `--manual` supplied instead of provenance to satisfy AC6. 3. Any write with `--manual` and `--source agent` both supplied. 4. Any write with `--source scan`. |
| **Expected Result** | Step 1: `entry_type = "observation"`. Step 2: `entry_type = "decision"`. Step 3: `source = "manual"` (manual wins over an explicit conflicting `--source`). Step 4: `source = "scan"`, write succeeds (not rejected as an invalid enum value).                                                             |
| **Pass Criteria**   | Each field matches exactly; step 3 specifically proves `--manual`'s precedence.                                                                                                                                                                                                                            |

### SC-7: Semantic `--source agent` requires provenance unless `--manual`

| Field               | Value                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC6                                                                                                                                                                               |
| **Type**            | negative-path + happy-path (paired)                                                                                                                                               |
| **Severity**        | critical                                                                                                                                                                          |
| **Preconditions**   | —                                                                                                                                                                                 |
| **Steps**           | 1. `--kind semantic --source agent` with no `--provenance`, no `--manual`. 2. Same, with `--provenance <uuid>` supplied. 3. Same, with `--manual` supplied and no `--provenance`. |
| **Expected Result** | Step 1: exit `1`, `VALIDATION_FAILED`, error path/message references `provenance`. Steps 2 and 3: exit `0`, write succeeds.                                                       |
| **Pass Criteria**   | Step 1's error message identifies `provenance` specifically (per the schema's `superRefine` error path in §18.3). Steps 2/3 succeed without error.                                |

### SC-8: `--supersedes` round-trip stores the new entry and updates the target

| Field               | Value                                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC7                                                                                                                                                                                                                                                                      |
| **Type**            | happy-path                                                                                                                                                                                                                                                               |
| **Severity**        | critical                                                                                                                                                                                                                                                                 |
| **Preconditions**   | Entry A exists (any kind, e.g., semantic), not superseded, in a known bank.                                                                                                                                                                                              |
| **Steps**           | 1. Write entry A (`--kind semantic --manual`), capture id `A`. 2. Write entry B with `--supersedes A` (same bank, same kind). 3. Fetch A directly (`getById`, or via a probe such as `memo read --id A` once S2-05 ships — for this story, integration-level `getById`). |
| **Expected Result** | B's write succeeds first. A's record then shows `valid_to` set to approximately the time of B's write, `superseded = true`, `superseded_by = B`'s id.                                                                                                                    |
| **Pass Criteria**   | Order of operations observable via mock call sequence (`upsert` for B before `setPayload` on A) in unit tests; integration test confirms A's final state carries all three fields with correct values.                                                                   |

### SC-9: `--supersedes` guard failures — cross-bank, cross-kind, already-superseded, missing

| Field               | Value                                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC7                                                                                                                                                                                                                                                                                                     |
| **Type**            | negative-path                                                                                                                                                                                                                                                                                           |
| **Severity**        | critical                                                                                                                                                                                                                                                                                                |
| **Preconditions**   | Entry A exists in bank `kb`, kind `semantic`. Entry B exists in a private bank, kind `semantic`. Entry C exists in `kb`, kind `episodic`. Entry D exists in `kb`, kind `semantic`, already superseded by some other entry.                                                                              |
| **Steps**           | 1. `--supersedes B` from a new `kb` write (cross-bank). 2. `--supersedes C` from a new `kb` semantic write (cross-kind). 3. `--supersedes D` from a new `kb` semantic write (already superseded). 4. `--supersedes <random-uuid-not-present>`.                                                          |
| **Expected Result** | Steps 1–3: exit `1`, `VALIDATION_FAILED`, **and no new entry is written** (verify via a subsequent count/probe that no orphan entry was created). Step 3's message notes "already superseded by `<id>`" per spec §18.6 step 6. Step 4: `ENTRY_NOT_FOUND` (exit code per **F-1**, recorded as evidence). |
| **Pass Criteria**   | All four cases fail before any upsert call is made (asserted at the unit level via mock call-count on `upsert`/`embed` = 0 for the failing case). Step 3's message contains the superseding id.                                                                                                         |

### SC-10: Step-10 supersede-update failure is reported without rolling back the new entry

| Field               | Value                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC8                                                                                                                                                                                                                             |
| **Type**            | negative-path (failure injection)                                                                                                                                                                                               |
| **Severity**        | critical                                                                                                                                                                                                                        |
| **Preconditions**   | Entry A exists and is a valid supersede target. Mocked `setPayload` (or `QdrantRepository`'s update call) is configured to throw/reject on this one call only.                                                                  |
| **Steps**           | 1. Write B with `--supersedes A`. 2. Force the target-update call to fail after B's `upsert` has already succeeded. 3. Capture exit code, error code, and message.                                                              |
| **Expected Result** | Exit `2`. Error code `QDRANT_OPERATION_FAILED`. Message contains both B's id (the new entry) and A's id (the target) verbatim. B remains stored (not rolled back) — verifiable by a follow-up `getById(B)` returning the point. |
| **Pass Criteria**   | Exit code exactly `2`. Both ids present in the message text (substring match). B is retrievable after the failure.                                                                                                              |

### SC-11: Soft-cap warning fires at threshold and is silent below it

| Field               | Value                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC9                                                                                                                                                                                                                                                                                                                                              |
| **Type**            | happy-path (boundary)                                                                                                                                                                                                                                                                                                                            |
| **Severity**        | major                                                                                                                                                                                                                                                                                                                                            |
| **Preconditions**   | A bank with `soft_cap - 1` existing non-superseded `self` entries (mocked `count()` result for unit tests; seeded for integration).                                                                                                                                                                                                              |
| **Steps**           | 1. Write one more `self` entry (bringing the bank to exactly `soft_cap`, using the **pre-write** count per **F-2**) — human mode, capture stderr. 2. Repeat the same setup with `soft_cap - 1` and confirm no warning at `soft_cap - 2` non-superseded entries before this write. 3. Repeat step 1 in `--json` mode and inspect `warnings`.      |
| **Expected Result** | Step 1: exit `0`, stderr contains `self entries in <bank>: <n> (soft cap <cap>)` with `<n>` and `<cap>` substituted correctly (per **F-2**, `<n>` is the pre-write count). Step 2 (one below threshold): no warning text emitted, write succeeds silently. Step 3: JSON result has `warnings: ["self entries in <bank>: <n> (soft cap <cap>)"]`. |
| **Pass Criteria**   | Warning text matches the documented format exactly (aside from the `<n>`/`<cap>`/`<bank>` substitutions). Write always succeeds (never blocks) in both cases.                                                                                                                                                                                    |

### SC-12: Dedupe v2 key isolates banks; v1-key fallback catches a pre-migration `kb` semantic duplicate

| Field               | Value                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC10                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Type**            | happy-path + negative-path (paired)                                                                                                                                                                                                                                                                                                                                                                                     |
| **Severity**        | critical                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Preconditions**   | A `kb` semantic point exists written under the v1 dedupe key scheme (`dedupe_key_version: 'v1'`) with a given `repo`/`commit`/`story`/`entry_type`/`source` combination.                                                                                                                                                                                                                                                |
| **Steps**           | 1. Write two semantic entries with identical `bank`/`repo`/`commit`/`story`/`entry_type`/`source` in two **different** banks — confirm neither is flagged a duplicate of the other. 2. Write a `kb` semantic entry whose `repo`/`commit`/`story`/`entry_type`/`source` combination matches the pre-existing v1-keyed point exactly. 3. Write a `self` entry twice with identical content/flags.                         |
| **Expected Result** | Step 1: `duplicate_detected: false` for both (dedupe key includes `bank`, so cross-bank never collides). Step 2: `duplicate_detected: true`, triggering the existing duplicate-resolution flow (`--on-duplicate`, JSON error, or TTY prompt) exactly as v1's own-key duplicates do. Step 3: `duplicate_detected: false` on the second write — `self` never triggers duplicate handling regardless of identical content. |
| **Pass Criteria**   | Cross-bank isolation holds even with otherwise-identical fields. The v1-key check only runs for `kb` + `semantic` (verified via mock call assertion — `getByDedupeKey` called with the v1-style key only in this combination, not for episodic or private-bank semantic writes). `self` shows zero dedupe-lookup side effects that alter its outcome.                                                                   |

### SC-13: JSON envelope carries the full v2 payload plus the documented result fields, with pre-existing keys unchanged

| Field               | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC11                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Type**            | happy-path (contract-adjacent)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Severity**        | critical                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Preconditions**   | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Steps**           | 1. Run a plain semantic `--manual` write with `--json`. 2. Run the same with `--supersedes <valid-id>`. 3. Run a write that triggers the soft-cap warning with `--json`.                                                                                                                                                                                                                                                                                                                                                                        |
| **Expected Result** | Step 1: result object has every v2 payload field applicable to that kind, plus `created: true`, `updated: false`, `duplicate_detected: false`; no `superseded`/`warnings` keys present (optional, omitted when not applicable). Step 2: result additionally has `superseded: "<target-id>"`. Step 3: result additionally has `warnings: [...]` as a non-empty array. All pre-existing v1 keys (`id`, `rationale`, `tags`, `entry_type`, `source`, `confidence`, `timestamp_utc`, `dedupe_key_sha256`, etc.) remain present and typed as before. |
| **Pass Criteria**   | Field-by-field diff against the documented v1 key set shows zero removed/renamed keys; new keys are strictly additive.                                                                                                                                                                                                                                                                                                                                                                                                                          |

---

## Contract Validation Scenarios

Contracts under test:

| Boundary                                                                                                           | Type            | Consumer                                              | Provider                |
| ------------------------------------------------------------------------------------------------------------------ | --------------- | ----------------------------------------------------- | ----------------------- |
| `memo write --json` result envelope                                                                                | provider-driven | scripting/CI callers, `memo read`/`recall` (S2-05/09) | `write.ts`              |
| `EntryPayloadV2Schema` (write-time schema)                                                                         | consumer-driven | `write.ts`                                            | `src/types/entry.ts`    |
| Error-code contract (`VALIDATION_FAILED`, `REPO_CONTEXT_UNRESOLVED`, `ENTRY_NOT_FOUND`, `QDRANT_OPERATION_FAILED`) | provider-driven | CLI callers, `developer`                              | `write.ts`, `errors.ts` |
| `buildDedupeKeyV2` key shape                                                                                       | consumer-driven | `dedupe.ts` callers (`write.ts`)                      | `src/lib/dedupe.ts`     |

### CT-1: JSON error envelope shape is stable across all four error codes

| Field               | Value                                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC1, AC3, AC6, AC7, AC8                                                                                                                                                                                        |
| **Contract type**   | provider-driven                                                                                                                                                                                                |
| **Boundary**        | `memo write --json` error path                                                                                                                                                                                 |
| **Direction**       | response                                                                                                                                                                                                       |
| **Input**           | One trigger per error code: `VALIDATION_FAILED` (AC1/AC6/AC7 guard), `REPO_CONTEXT_UNRESOLVED` (AC3), `ENTRY_NOT_FOUND` (AC7 missing target), `QDRANT_OPERATION_FAILED` (AC8).                                 |
| **Expected Result** | Every error, in `--json` mode, emits a structured object with (at minimum) a stable `code` field matching the documented string and a human-readable `message`. No error is a bare uncaught stack trace.       |
| **Pass Criteria**   | `code` values match exactly (`VALIDATION_FAILED`, `REPO_CONTEXT_UNRESOLVED`, `ENTRY_NOT_FOUND`, `QDRANT_OPERATION_FAILED`). Every case exits non-zero (1 or 2 per AC1/AC8; see **F-1** for `ENTRY_NOT_FOUND`). |

### CT-2: `EntryPayloadV2Schema` rejects the six `superRefine` rule violations independently

| Field               | Value                                                                                                                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC1, AC2, AC6                                                                                                                                                                                                                                                                                  |
| **Contract type**   | consumer-driven                                                                                                                                                                                                                                                                                |
| **Boundary**        | `EntryPayloadV2Schema`                                                                                                                                                                                                                                                                         |
| **Direction**       | request (schema as gate into `write.ts`)                                                                                                                                                                                                                                                       |
| **Input**           | Six isolated payloads, each violating exactly one spec §18.3 rule: K1 (`self` in `kb`), K2 (`kb` missing scope — backstop only, command layer fires first), episodic without `session_id`, K3 (agent semantic no provenance), `self` carrying a retention field, `seq` on a non-episodic kind. |
| **Expected Result** | Each payload is rejected with an issue at the documented error `path` (`kind`, `repo`, `session_id`, `provenance`, `kind`, `seq` respectively).                                                                                                                                                |
| **Pass Criteria**   | `write.test.ts`/`entry.test.ts` unit-level assertion: each violation produces exactly the documented `path`, not a generic top-level error.                                                                                                                                                    |

### CT-3: `buildDedupeKeyV2` produces distinct, deterministic keys per kind

| Field               | Value                                                                                                                                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC10                                                                                                                                                                                                                                                                                                           |
| **Contract type**   | consumer-driven                                                                                                                                                                                                                                                                                                |
| **Boundary**        | `buildDedupeKeyV2({ bank, kind, repo, commit, story, session_id, seq, entry_type, source })`                                                                                                                                                                                                                   |
| **Direction**       | request                                                                                                                                                                                                                                                                                                        |
| **Input**           | One call per kind (`semantic`, `episodic`, `self`) with identical `bank`/`repo`/`commit`/`story`/`entry_type`/`source` inputs, and `session_id`/`seq` supplied only for episodic.                                                                                                                              |
| **Expected Result** | `semantic` key matches `v2\|bank\|repo??na\|commit??na\|story??na\|na\|semantic\|entry_type\|source`; `episodic` matches the same shape with `session\|seq` in place of `na`; `self` is a `sha256('self\|' + randomUUID())`-shaped hash that differs on every call (never matches, even for identical inputs). |
| **Pass Criteria**   | String-shape assertion for semantic/episodic keys (unit test, no live hashing needed). `self` key called twice with identical inputs yields two different values.                                                                                                                                              |

### CT-4: Result envelope's optional fields are genuinely absent, not `null`, when not applicable

| Field               | Value                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC11                                                                                                                                                              |
| **Contract type**   | provider-driven                                                                                                                                                   |
| **Boundary**        | `memo write --json` result envelope                                                                                                                               |
| **Direction**       | response                                                                                                                                                          |
| **Input**           | A plain write with no `--supersedes` and no soft-cap warning triggered.                                                                                           |
| **Expected Result** | `superseded` and `warnings` keys are absent from the serialized JSON (`'superseded' in result === false`), not present with value `null` or `[]` unconditionally. |
| **Pass Criteria**   | `JSON.parse` of stdout shows no `superseded`/`warnings` key when not applicable — matters for downstream consumers doing key-presence checks (S2-05+).            |

---

## Edge-Case Catalog

Nine categories evaluated; two are declared `N/A` for this write-path story with justification.

### 1. Input Domain

### EC-1: `--expires-in` duration string boundary and rejection cases

| Field               | Value                                                                                                                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC4                                                                                                                                                                                                                                                                                |
| **Category**        | Input Domain                                                                                                                                                                                                                                                                       |
| **Input / Setup**   | `--expires-in` values: `2d`, `12h`, `30m` (valid per story text); `0d` (Edge-Case Matrix names this rejected); `1w`, `2y` (unsupported units); `2` (no unit); `-1d` (negative); `2.5d` (fractional); `` (empty string); `2D` (uppercase unit).                                     |
| **Expected Result** | Valid trio parses to the correct millisecond offset. `0d` is rejected (`VALIDATION_FAILED`) per the Edge-Case Matrix. All non-`\d+[dhm]`-conforming strings (`1w`, `2`, `-1d`, `2.5d`, ``, `2D` if case-sensitive per the `\d+[dhm]` regex) are rejected with `VALIDATION_FAILED`. |
| **Risk if Missed**  | A permissive parser that silently accepts `2D` or truncates `2.5d` to `2d` would let entries expire at a different time than the operator intended, undermining the retention contract.                                                                                            |

### EC-2: `--context` repeated with duplicate values is deduplicated

| Field               | Value                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC11 (payload shape)                                                                                                                                                  |
| **Category**        | Input Domain                                                                                                                                                          |
| **Input / Setup**   | `--context foo --context foo --context bar`.                                                                                                                          |
| **Expected Result** | Per the story's own Edge-Case Matrix ("`--context` given twice with the same value (deduplicated)"), stored `contexts = ["foo", "bar"]`, not `["foo", "foo", "bar"]`. |
| **Risk if Missed**  | Duplicate contexts would inflate context-based filtering/matching counts in later Phase 2 read-side stories (S2-05+) without adding real information.                 |

### EC-3: `--provenance` CSV parsing — valid UUIDs, malformed entries, empty string

| Field               | Value                                                                                                                                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC6, AC11                                                                                                                                                                                                                                                                                                                      |
| **Category**        | Input Domain                                                                                                                                                                                                                                                                                                                   |
| **Input / Setup**   | `--provenance <uuid1>,<uuid2>`; `--provenance <uuid1>,not-a-uuid`; `--provenance ""` (empty, treated as no provenance for AC6 purposes).                                                                                                                                                                                       |
| **Expected Result** | Valid CSV parses to a `provenance` array of exactly those UUIDs. A malformed UUID in the list fails schema validation (`VALIDATION_FAILED`, path `provenance`). An empty string is treated as "no provenance supplied," so a semantic `--source agent` write with `--provenance ""` and no `--manual` still fails AC6's guard. |
| **Risk if Missed**  | Silently dropping a malformed UUID instead of rejecting the whole write would corrupt the audit trail K3 exists to preserve.                                                                                                                                                                                                   |

### 2. State Transitions

### EC-4: Soft cap exactly at threshold vs. one below (see F-2)

| Field               | Value                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC9                                                                                                                                                                         |
| **Category**        | State Transitions, Data Boundaries                                                                                                                                          |
| **Input / Setup**   | Pre-existing non-superseded `self` count in the target bank at exactly `soft_cap`, exactly `soft_cap - 1`, and `soft_cap + 5` (well above).                                 |
| **Expected Result** | At `soft_cap` and `soft_cap + 5`: warning fires (per AC9, `>= soft_cap` triggers). At `soft_cap - 1`: no warning. Write always succeeds in every case (never a hard block). |
| **Risk if Missed**  | An off-by-one (`>` instead of `>=`) would silently suppress the warning exactly at the documented threshold, defeating the story's own worked boundary example.             |

### EC-5: `--supersedes` interacting with the soft-cap count for `self`

| Field               | Value                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC7, AC9                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Category**        | State Transitions                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Input / Setup**   | A bank at `soft_cap` non-superseded `self` entries. Write a new `self` entry with `--supersedes <one-of-them>`.                                                                                                                                                                                                                                                                                                                                |
| **Expected Result** | The soft-cap `count()` filter is `{ bank, kind: self, superseded: false }`, evaluated **before** the new write's own supersede step lands (per §18.6 step order: step 7 soft-cap check precedes step 9 upsert and step 10 target update). So the count used for the warning still includes the about-to-be-superseded target — the warning fires (or not) based on the pre-write state, consistent with **F-2**, not the post-supersede state. |
| **Risk if Missed**  | If the soft-cap check ran after step 10, superseding an old `self` entry while adding a new one would always show one fewer than reality, silently under-warning right at the cap boundary.                                                                                                                                                                                                                                                    |

### 3. Timing & Concurrency

### EC-6: `--supersedes` self-reference guard (see F-3)

| Field               | Value                                                                                                                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC7                                                                                                                                                                                                                                                                                           |
| **Category**        | Timing / Defensive Guard                                                                                                                                                                                                                                                                      |
| **Input / Setup**   | A crafted `--supersedes <id>` where `<id>` is forced (via test double, since the CLI cannot naturally produce this) to equal the new entry's freshly generated `id`.                                                                                                                          |
| **Expected Result** | The `target.id === id` guard fires before any write. Per **F-3**, the exact error code is undetermined pending confirmation; `VALIDATION_FAILED` is the most consistent hypothesis and is asserted as the primary expectation, with the actual observed code recorded as evidence either way. |
| **Risk if Missed**  | Without the guard, a contrived self-reference could set `superseded_by` to point at itself, corrupting the lifecycle state machine (§8.4) in a way that never resolves to `archived`.                                                                                                         |

### EC-7: Two `nextSeq` writes racing in the same bank+session (documented as sequential in this story's scope)

| Field               | Value                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC4                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Category**        | Timing & Concurrency                                                                                                                                                                                                                                                                                                                                                                                       |
| **Input / Setup**   | Two `memo write --kind episodic --session s-1` invocations issued concurrently (near-simultaneous process launch) against the same bank+session, no `--seq`.                                                                                                                                                                                                                                               |
| **Expected Result** | Not a hard requirement of this story (spec §18.6 describes a read-then-write `nextSeq`, not a compare-and-swap) — this scenario documents the **known race**: both processes may read the same max and compute the same `seq`, producing a duplicate `seq` within the session. Recorded as `undetermined`/informational, not a blocking defect, since the story's Technical Notes do not describe locking. |
| **Risk if Missed**  | If left completely untested, a future consumer (e.g., `memo timeline`, which sorts by `seq`) could silently rely on `seq` uniqueness that this write path does not actually guarantee under concurrency — flagged as a Recommendation, not failed here.                                                                                                                                                    |

### 4. Idempotency

### EC-8: Re-running the exact same write twice (non-`--supersedes`, non-duplicate-key case)

| Field               | Value                                                                                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC10, AC11                                                                                                                                                                                                                                   |
| **Category**        | Idempotency                                                                                                                                                                                                                                  |
| **Input / Setup**   | Run an identical `memo write` command (same rationale, tags, flags) twice for a **semantic** entry.                                                                                                                                          |
| **Expected Result** | The dedupe key is identical both times (deterministic per `buildDedupeKeyV2`), so the second run is flagged `duplicate_detected: true` and enters the existing `--on-duplicate`/prompt flow — it is not silently a second independent write. |
| **Risk if Missed**  | If the v2 dedupe key accidentally includes a nondeterministic field (e.g., a fresh timestamp), duplicate detection would silently break for every semantic/episodic write, defeating AC10 entirely.                                          |

### 5. Failure Modes

### EC-9: `--supersedes` guard failures leave zero side effects (no orphan writes, no partial state)

| Field               | Value                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC7                                                                                                                                                                                              |
| **Category**        | Failure Modes                                                                                                                                                                                    |
| **Input / Setup**   | Each of the SC-9 guard-failure cases (cross-bank, cross-kind, already-superseded), captured with an `upsert`/`embed` call-count assertion.                                                       |
| **Expected Result** | Zero calls to `embed`, `upsert`, or `setPayload` for any guard failure — validation (step 6) runs strictly before any I/O (step 9/10).                                                           |
| **Risk if Missed**  | An implementation that validates the target lazily (e.g., inside a try/catch around the upsert) could leave an orphaned new entry in the store with no linked supersede relationship on failure. |

### EC-10: `QDRANT_OPERATION_FAILED` message format stability for step-10 failures (see AC8, SC-10)

| Field               | Value                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC8                                                                                                                                                                                       |
| **Category**        | Failure Modes                                                                                                                                                                             |
| **Input / Setup**   | Repeat SC-10's failure injection three times with different new-id/target-id UUID pairs.                                                                                                  |
| **Expected Result** | Every run's message contains that run's specific new id and target id substrings — not a generic templated message that omits the actual ids, and not ids from a previous run leaking in. |
| **Risk if Missed**  | A hardcoded or stale message would defeat the operator's ability to "re-run `memo write --supersedes`" or "repair by hand" as the spec's remediation guidance requires.                   |

### 6. Auth & Permissions

**N/A — no new auth surface.** This story adds no new credential type; it reuses the existing `QDRANT_URL`/`QDRANT_API_KEY`/embeddings-provider model unchanged. Bank resolution (`MEMO_BANK`, `--bank`) is a data-partition selector, not an authorization boundary — the spec does not describe per-bank access control in Phase 2.

### 7. Data Boundaries

### EC-11: Soft-cap boundary exactness (see EC-4, consolidated cross-reference)

Already covered by **EC-4**; listed here only to satisfy the category checklist per the skill's nine-category requirement — no additional scenario needed beyond EC-4's exact-threshold assertion.

### EC-12: `--seq` at its numeric boundaries

| Field               | Value                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC4                                                                                                                                                                      |
| **Category**        | Data Boundaries                                                                                                                                                          |
| **Input / Setup**   | `--seq 0` (minimum allowed per schema, `int >= 0`); `--seq -1` (below minimum); a very large `--seq` value (e.g., `Number.MAX_SAFE_INTEGER`); a non-integer `--seq 1.5`. |
| **Expected Result** | `0` and the large integer both accepted and stored verbatim. `-1` and `1.5` rejected with `VALIDATION_FAILED` at path `seq`.                                             |
| **Risk if Missed**  | Accepting a negative or fractional `seq` would corrupt `memo timeline`'s (S2-08) `scrollOrdered` sort order in ways that are hard to detect after the fact.              |

### 8. Resource Exhaustion

**N/A for this story's scope.** `--context` is repeatable but unbounded only by shell argument-length limits, not by application logic; the story does not introduce a new unbounded-batch or pagination surface (that belongs to `scrollAll`/`scrollOrdered`, covered by S2-01–03). Flagged as a Recommendation (an upper bound on `--context`/`--provenance` count could be considered) rather than a blocking gap.

### 9. API Versioning

### EC-13: v2 point remains readable by memo-cli 1.2.x as an ordinary v1 entry (compatibility note, not a runtime test in this story — see F-4)

| Field               | Value                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | N/A — story's Migration Requirements, not a numbered AC                                                                                                                                          |
| **Category**        | API Versioning                                                                                                                                                                                   |
| **Input / Setup**   | Not executable within this story's build (would require running 1.2.x code against a 1.3.0-written point). Documented as a compatibility assertion to be verified manually/via changelog review. |
| **Expected Result** | A v2 point's extra fields (`bank`, `kind`, `session_id`, `seq`, etc.) are ignored by 1.2.x's read paths, which do not parse `schema_version`; the point still displays as an ordinary entry.     |
| **Pass Criteria**   | Recorded in the Execution Checklist as a documentation/verification item, not a pass/fail scenario, per **F-4**. No migration-apply test is required for this story.                             |

---

## Randomized Tactics and Seed Policy

Seed format: `<tactic-type>-<AC-id>-<unix-timestamp>-<4-hex>`
Replay: `pnpm test -- --testPathPattern="write|duration" --seed=<captured-seed>`

Seeds **MUST** be recorded in the run log and in any failure report. On failure, follow the `verifier` Failure Triage Workflow (capture → replay → minimize → classify → report), with a maximum of 3 reproduction attempts before marking `inconclusive`.

### RT-1: Fuzz — `--expires-in` duration-string parser never crashes and only accepts `\d+[dhm]`

| Field                  | Value                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**              | AC4                                                                                                                                                                                                                                                                                                                                         |
| **Tactic type**        | fuzz                                                                                                                                                                                                                                                                                                                                        |
| **Input surface**      | `src/lib/duration.ts`'s parser, fed random strings: random digit runs + random unit chars (valid and invalid), unicode digit look-alikes, strings with leading/trailing whitespace, empty string, extremely long digit runs, negative signs, decimals, multiple unit suffixes (`2dh`).                                                      |
| **Property / Oracle**  | The parser either (a) returns a valid millisecond/duration value for strings matching `^\d+[dhm]$` exactly, or (b) throws/returns an error signal that `write.ts` maps to `VALIDATION_FAILED` — it never throws an unhandled exception, never returns `NaN`/`Infinity` silently, and never accepts a string not matching the exact pattern. |
| **Iterations**         | 500                                                                                                                                                                                                                                                                                                                                         |
| **Seed**               | `fuzz-AC4-{timestamp}-{hex}`                                                                                                                                                                                                                                                                                                                |
| **Replay instruction** | `pnpm test -- --testPathPattern="duration" --seed=<seed> --iterations=1`                                                                                                                                                                                                                                                                    |
| **Shrink strategy**    | Reduce the failing string to its minimal length while preserving the property violation (e.g., strip trailing characters one at a time).                                                                                                                                                                                                    |

### RT-2: Random tag/context combinations validated against the v2 schema

| Field                  | Value                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**              | AC11 (payload shape), CT-2                                                                                                                                                                                                                                                                                                       |
| **Tactic type**        | property-based / fuzz (schema conformance)                                                                                                                                                                                                                                                                                       |
| **Input surface**      | Randomly generated `tags` (2–5 kebab-case strings, per existing v1 rule) and `contexts` (0–N `KebabString` values, including malformed casing/spacing/unicode), combined with randomly chosen `kind`/`bank`/`source` combinations.                                                                                               |
| **Property / Oracle**  | Every generated payload either validates successfully under `EntryPayloadV2Schema` and round-trips through `normalizeEntry` without loss of the fields it set, or fails validation with an issue whose `path` names the actual offending field — never a payload that "half-validates" (accepted with a silently dropped field). |
| **Iterations**         | 500                                                                                                                                                                                                                                                                                                                              |
| **Seed**               | `prop-AC11-{timestamp}-{hex}`                                                                                                                                                                                                                                                                                                    |
| **Replay instruction** | `pnpm test -- --testPathPattern="write                                                                                                                                                                                                                                                                                           | entry" --seed=<seed> --iterations=1` |
| **Shrink strategy**    | Remove one random field/array element at a time from the failing payload until the minimal invalidating combination remains.                                                                                                                                                                                                     |

### RT-3: Fuzz — auto-`seq` collision surface under randomized existing-`seq` sets

| Field                  | Value                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**              | AC4                                                                                                                                                                                                                                                                                                                      |
| **Tactic type**        | property-based                                                                                                                                                                                                                                                                                                           |
| **Input surface**      | Randomly generated sets of existing `seq` values in a bank+session (including gaps, duplicates from EC-7-style races, a single `0`, an empty set) fed to a stubbed `nextSeq`/`scrollOrdered` mock.                                                                                                                       |
| **Property / Oracle**  | `nextSeq` always returns `max(existing) + 1` when the set is non-empty, and `0` when empty — regardless of gaps or duplicate values in the existing set; it never returns a value already present in the input set unless the input set itself already contained a value at `max + 1` (impossible by definition of max). |
| **Iterations**         | 300                                                                                                                                                                                                                                                                                                                      |
| **Seed**               | `prop-AC4-{timestamp}-{hex}`                                                                                                                                                                                                                                                                                             |
| **Replay instruction** | `pnpm test -- --testPathPattern="write" --seed=<seed> --iterations=1`                                                                                                                                                                                                                                                    |
| **Shrink strategy**    | Reduce the existing-`seq` set to the smallest multiset that still produces an incorrect `nextSeq` result.                                                                                                                                                                                                                |

---

## Execution Checklist

Pre-implementation (test-first — these should fail before code exists):

- [ ] Scaffold `tests/unit/lib/duration.test.ts` with EC-1/RT-1 cases as failing tests.
- [ ] Scaffold `tests/unit/commands/write.test.ts` with AC1–AC11 cases as failing tests, asserting call order (`getById` → `upsert` → `setPayload`) via mock call sequence.
- [ ] Scaffold `tests/integration/commands/write.test.ts` with the SC-8 supersede round-trip and SC-12 v1-fallback case as failing tests.

During implementation:

- [ ] SC-1 … SC-13 pass.
- [ ] CT-1 … CT-4 pass.
- [ ] EC-1 … EC-13 pass, with EC-6/EC-7's `undetermined`/informational branches recorded as evidence (not blocking) per **F-2**/**F-3**.
- [ ] RT-1 … RT-3 executed; seeds recorded in the run log.

Quality gates:

- [ ] `pnpm test -- --testPathPattern="write|duration"` — targeted green.
- [ ] `pnpm run validate` (full quality-gate bundle per AGENTS.md: `test`, `lint`, `format:check`, `typecheck`, `audit`).
- [ ] `write.ts` coverage at or above `jest.config.ts` thresholds (spec §14), per the story's own Definition of Done.
- [ ] Manual: against `memo_eval` (`MEMO_COLLECTION=memo_eval`) — one `self`, three episodic with auto-`seq`, one semantic `--supersedes`; confirm via Qdrant UI or `memo read --id` once S2-05 ships.
- [ ] `README.md` write section and `docs/data-model.md` write-path notes updated per the story's Implementation Steps item 7.

Migration / compatibility check (per **F-4** — no migration-apply test needed):

- [ ] Confirm (by code inspection / changelog note, not a runtime test) that a v2 point written under this story remains readable by memo-cli 1.2.x as an ordinary v1 entry, since 1.2.x's read paths do not parse `schema_version` or new v2 fields. Record this as a rollback/compatibility note in the PR description and/or `docs/data-model.md`, not as a pass/fail test case.
- [ ] Confirm no migration script or `memo migrate` invocation is required or introduced by this story (deferred to S2-09).

Negative-space checks (non-goals stay untouched):

- [ ] No change to `search.ts`/`list.ts`/`tags.ts`/`read.ts`/`timeline.ts`/`recall.ts` behavior (S2-05/08/09 scope).
- [ ] Shipped duplicate-prompt TTY interaction code path is untouched beyond the dedupe key it consumes (per Technical Notes).
- [ ] No existing v1 points are rewritten, migrated, or touched by any `memo write` invocation in this story's scope.

---

## Recommendations

| #   | Finding                                                                                                | Owner              | Recommended action                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **F-1** — `ENTRY_NOT_FOUND` exit code unstated                                                         | `product-engineer` | Confirm exit `1` (consistent with every other `*_FAILED`/`*_UNRESOLVED` code) and state it explicitly in the story/spec.                                                                 |
| 2   | **F-2** — Soft-cap warning's `<n>` reading point (pre- vs post-write) is ambiguous                     | `product-engineer` | Confirm `<n>` is the pre-write `count()` result, consistent with step 7 preceding step 9 in spec §18.6, and state it explicitly.                                                         |
| 3   | **F-3** — `--supersedes` self-reference guard has no stated error code                                 | `product-engineer` | Confirm `VALIDATION_FAILED` is the intended code for the `target.id === id` guard, or specify an alternative.                                                                            |
| 4   | **EC-7** — `nextSeq` has a documented read-then-write race under concurrent writes to the same session | `product-engineer` | Decide whether Phase 2 accepts this race as out of scope (likely, given single-agent-per-session assumptions) or whether a compare-and-swap / retry loop is warranted for a later story. |
| 5   | Resource-exhaustion category — no stated upper bound on `--context`/`--provenance` count               | `product-engineer` | Consider documenting a soft upper bound if unbounded repeatable flags become a practical concern; not blocking for this story.                                                           |

---

## Output Contract

| Field                  | Value                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mode**               | Design                                                                                                                                                                                                                                                                                                                       |
| **Phase**              | 4 — Reporting & Publication (complete)                                                                                                                                                                                                                                                                                       |
| **Source artifact**    | `workstream/user-stories-prd-004-phase-2.md` (Story S2-04)                                                                                                                                                                                                                                                                   |
| **Artifacts produced** | `workstream/test-plan-issue-83.md`, `workstream/traceability-matrix-issue-83.md`                                                                                                                                                                                                                                             |
| **GitHub issue**       | [#83](https://github.com/llipe/memo-cli/issues/83)                                                                                                                                                                                                                                                                           |
| **AC coverage**        | 11/11 addressed with scenario coverage.                                                                                                                                                                                                                                                                                      |
| **Scenario counts**    | 13 E2E, 4 contract, 13 edge-case, 3 randomized                                                                                                                                                                                                                                                                               |
| **Blocking gaps**      | None for design. Three items require `product-engineer` clarification before a firm audit-time verdict: **F-1** (`ENTRY_NOT_FOUND` exit code), **F-2** (soft-cap `<n>` reading point), **F-3** (self-reference guard error code). None of these block implementation from proceeding — each has a stated primary hypothesis. |
