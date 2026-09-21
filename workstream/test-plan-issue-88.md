# Compliance Test Plan — Issue #88: Story S2-09 `memo migrate --to-v2`

> Produced by **`verifier`** (Design Mode) on 2026-09-21. Pre-implementation. Black-box: all assertions derive from observable CLI/planner behavior (stdout/stderr, exit code, mock call assertions on the Qdrant client, and `memo_eval`/`decisions` collection state), not internal code structure. This is the one Phase 2 story with a real data-migration lifecycle, so migration safety receives dedicated coverage beyond the standard scenario set.

## Changelog

| Version | Date       | Summary           | Author   |
| ------- | ---------- | ----------------- | -------- |
| 1.0     | 2026-09-21 | Initial test plan | verifier |

## Source Input Summary

| Field               | Value                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Repository**      | `llipe/memo-cli`                                                                                                                                           |
| **GitHub Issue**    | [#88](https://github.com/llipe/memo-cli/issues/88)                                                                                                         |
| **Input type**      | `story`                                                                                                                                                    |
| **Source artifact** | `workstream/user-stories-prd-004-phase-2.md` — Story S2-09: `memo migrate --to-v2`                                                                         |
| **Also binding**    | `workstream/specification-prd-004-long-lived-agent-memory.md` §5.5, §18.11; `docs/requirements/prd-004-long-lived-agent-memory.md` §7.2 FR-2.8, §13 AC-2.7 |
| **Task list**       | `workstream/tasks-prd-004-phase-2-plan.md`, task 9.0 (sub-tasks 9.1–9.23; Migration sub-tasks 9.12–9.17 explicitly)                                        |
| **ACs extracted**   | 6 (AC1 … AC6)                                                                                                                                              |
| **Traceability**    | `workstream/traceability-matrix-issue-88.md`                                                                                                               |

Observable surfaces available to black-box testing:

1. `src/lib/migrate.ts: planMigration(points, now, rules, policies)` — pure function; observable via its return value (`{ ops, byRule, skipped }`) given input arrays. Treated as black-box because inputs/outputs are the contract, not the internal branching.
2. `memo migrate --to-v2 [--dry-run] [--rules <file>] [--json]` — stdout/stderr, exit code, JSON envelope `{ scanned, migrated, skipped, by_rule, dry_run }`.
3. The mocked Qdrant client — call assertions on `scrollAll`, `batchSetPayload`, `setPayload`, `upsert`, and every `delete*` method, and on whether a vector is ever included in a call payload.
4. `memo search` (no flags) run before vs. after migration — id-set identity (AC6 / PRD AC-2.3).
5. `memo bank list` — post-migration probe that all migrated points land under `bank = kb`.
6. `pnpm run eval:relevance` against `MEMO_COLLECTION=memo_eval` — the 96.4% regression floor established in Phase 1 (S1-01/S1-02), used here as an independent post-migration correctness probe, not re-derived.
7. `--rules <file>` — a user-supplied JSON file, observable as request input to the rules validator/planner.

---

## Pre-Implementation Findings

Design-time analysis surfaced items relevant to how these ACs must be tested. All are reported, not fixed — remediation belongs to `developer`; scope questions belong to `product-engineer`.

### F-1 — "Zero write calls" under `--dry-run` must be asserted as a negative on the mock, not inferred from unchanged data (Critical)

AC2 states dry-run "issues zero `batchSetPayload`, `setPayload`, `upsert`, or `delete*` calls (asserted on the mock)." Because this is the single most safety-critical assertion in the story (a dry-run that silently writes would corrupt `decisions` the first time a user forgets the flag), this plan treats it as a **hard gate assertable only via mock call-count assertions** — not via a secondary read-back of Qdrant state, which could pass even if a write raced with a read in a live-database manual test. **SC-1** and **EC-8** are unit/integration-level (mocked) and are the only tests that satisfy AC2's parenthetical; the manual `memo_eval` dry-run (Migration Verification, MV-1) is corroborating evidence, not the primary oracle.

### F-2 — "No `delete*` call ever occurs" spans dry-run, first real run, and second real run, and must be asserted across all three, not just the real run (Critical)

AC3 says "no `delete*` call ever occurs," but the sentence structure could be read as scoped only to the real-run half of AC3. Per FR-2.8/AC-2.7 ("nothing is archived or deleted by migration") and Business Rules ("Migration never archives, deletes, or re-embeds"), this plan treats the no-delete guarantee as spanning **every** invocation mode covered by this story — dry-run, first real run, and idempotent second run. **EC-9** asserts zero delete calls across all three phases of a single scenario run, not just the real-run phase.

### F-3 — Rule-2 default-to-`semantic` interacts with the exhaustiveness check in a way the story does not fully specify for custom `--rules` files (Major)

AC4 requires a custom rules file to fail `VALIDATION_FAILED` if it has no catch-all (empty `when`) rule. The default rules (§18.11) satisfy this because rule 2's `when: {}` is exhaustive. The story does not state whether a custom rules file's catch-all rule is _required_ to set `kind: semantic` (mirroring the safety rationale in the Business Rules — "a wrong episodic classification can be re-tagged, a wrong expiry cannot be undone once purged") or whether any `set.kind` value is acceptable for the catch-all as long as one exists syntactically. **EC-5** tests a custom rules file whose catch-all sets `kind: episodic` and records the observed behavior (accepted vs. rejected) as evidence; it is `undetermined` pending `product-engineer` confirmation, not a hard fail, since AC4's literal text only requires _a_ catch-all rule to exist.

### F-4 — "Already partially v2" (has `bank` but no `schema_version`) is named as an edge case but its precise field-preservation contract is only partially specified (Minor)

The story's Edge-Case Matrix says such a point is "migrated, existing `bank` preserved." AC1 separately says every migrated point gets `bank = kb` unconditionally. These two statements only agree if the point's pre-existing `bank` value already equals `kb` (the only bank that existed pre-Phase-2, since bank as a concept is new in this phase) — in which case "preserved" and "set to `kb`" are indistinguishable. If a test double is constructed with a bank value other than `kb` (which should not occur in real v1 data, but is testable), the two statements diverge. **EC-3** exercises the case with `bank` already `= "kb"` (the realistic case) as the firm assertion, and separately probes an out-of-domain pre-existing `bank` value as an `undetermined` clarification item, since v1 data has no `bank` field at all and this scenario may be untestable in practice.

---

## Acceptance Criteria Extraction

| ID  | Criterion (condensed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Source AC |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| AC1 | `planMigration(points, now, rules, policies)` is pure; `schema_version = "2"` points are skipped; rule 1 (tags contain `intent`/`outcome`) sets `kind = episodic`, `session_id = story ?? 'legacy'`, `expires_at = timestamp_utc + banks.kb.episodic.expires_in_days`; rule 2 (everything else) sets `kind = semantic`, `valid_from = timestamp_utc`; every migrated point additionally gets `bank = kb`, `schema_version = "2"`, `consolidated/archived/superseded/pinned = false`, `retrieval_count = used_count = 0`, `stability` from policy, `stability_since = now`, `dedupe_key_version` unchanged | AC1       |
| AC2 | `--dry-run` scans via `scrollAll` over `is_empty schema_version`, prints `{ scanned, migrated, skipped, by_rule, dry_run: true }`, issues **zero** `batchSetPayload`/`setPayload`/`upsert`/`delete*` calls (mock-asserted)                                                                                                                                                                                                                                                                                                                                                                                | AC2       |
| AC3 | A real run issues **one** `batchSetPayload` per page; a **second** run reports `scanned: 0`, `migrated: 0`; **no** `delete*` call ever occurs; vectors are never sent                                                                                                                                                                                                                                                                                                                                                                                                                                     | AC3       |
| AC4 | `--rules <file>` replaces default rules with the §18.11 JSON shape (`when`: `tags_any`, `tags_all`, `entry_type_in`, `source_in`, `repo_in`; `set.kind` required; `session_from`/`expires_in_days` episodic-only); a rule set with no catch-all fails `VALIDATION_FAILED` **before any scan**                                                                                                                                                                                                                                                                                                             | AC4       |
| AC5 | Progress printed to stderr per page unless `--json`; exit `0` on no-op                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | AC5       |
| AC6 | After migration, `memo search` with no flags returns the same ids as before migration (PRD AC-2.3 holds across the rewrite), verified by the replay identity test with migrated payloads                                                                                                                                                                                                                                                                                                                                                                                                                  | AC6       |

**Non-goals** (must remain untouched — negative-space assertions): the `decisions` collection's contents in this story (apply-to-`decisions` is an explicit user step post-release, not part of this story's scope); any vector/embedding change (payload-only migration per spec §5.5); any archive/delete/re-embed action of any kind (Business Rules); `dedupe_key_version` on migrated points (unchanged); existing `memo search`/`memo list`/`memo read` v1 behavior outside the payload rewrite itself.

**Coverage note:** AC4's "before any scan" clause is a timing/ordering guarantee, not purely a data-shape one — it is covered by **CT-6** (asserting `scrollAll` is never invoked when rules validation fails) in addition to the schema-shape contract tests (CT-1…CT-5). AC5's "exit 0 on no-op" is covered by **EC-4** (empty collection) rather than a dedicated E2E scenario, since it is a boundary condition of the same scan-and-report flow SC-1/SC-3 already exercise.

---

## E2E Black-Box Scenarios

### SC-1: Full CLI flow — dry-run → review counts → confirm → real run → second run

| Field               | Value                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC1, AC2, AC3, AC5                                                                                                                                                                                                                                                                                                                                                                                 |
| **Type**            | happy-path                                                                                                                                                                                                                                                                                                                                                                                         |
| **Severity**        | critical                                                                                                                                                                                                                                                                                                                                                                                           |
| **Preconditions**   | Mocked Qdrant client with three pages of v1 points (mixed rule-1/rule-2 fixtures) lacking `schema_version`.                                                                                                                                                                                                                                                                                        |
| **Steps**           | 1. Run `memo migrate --to-v2 --dry-run`. 2. Assert zero write-family mock calls; capture printed `by_rule` counts. 3. (Human gate, simulated) confirm the counts are as expected. 4. Run `memo migrate --to-v2` (real). 5. Assert one `batchSetPayload` call per page. 6. Run `memo migrate --to-v2` again (second real run). 7. Assert `scanned: 0`, `migrated: 0`, and zero further write calls. |
| **Expected Result** | Step 2: zero calls to `batchSetPayload`/`setPayload`/`upsert`/any `delete*` method; stdout/JSON shows `dry_run: true` and non-zero `by_rule` counts matching the fixture. Step 5: exactly one `batchSetPayload` per page (3 total for 3 pages), no `delete*` call. Step 7: `scanned: 0`, `migrated: 0`, zero additional write calls. Every invocation exits `0`.                                   |
| **Pass Criteria**   | All three phases match their expected call counts exactly (not "at most"). `by_rule` counts are stable between the dry-run preview and the real run's actual classification (same fixture, same result). This scenario is the CLI-flow backbone the story's own confirmation-gated apply flow describes end to end.                                                                                |

### SC-2: Progress reporting to stderr, suppressed under `--json`

| Field               | Value                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC5                                                                                                                                                               |
| **Type**            | happy-path                                                                                                                                                        |
| **Severity**        | major                                                                                                                                                             |
| **Preconditions**   | Mocked client with ≥ 2 pages of v1 points.                                                                                                                        |
| **Steps**           | 1. Run `memo migrate --to-v2` (human mode). 2. Capture stderr. 3. Run `memo migrate --to-v2 --json` against a fresh equivalent fixture. 4. Capture stdout/stderr. |
| **Expected Result** | Step 2: stderr contains one progress line per scanned page. Step 4: stderr contains no progress lines; stdout is the single JSON envelope only.                   |
| **Pass Criteria**   | Human mode: ≥ 1 stderr line per page. `--json` mode: zero stderr progress lines, stdout is valid parseable JSON with exactly the documented top-level keys.       |

### SC-3: Exit 0 on no-op (nothing left to migrate)

| Field               | Value                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC5                                                                                                                                                                               |
| **Type**            | happy-path (boundary)                                                                                                                                                             |
| **Severity**        | major                                                                                                                                                                             |
| **Preconditions**   | Mocked client returns zero points matching `is_empty schema_version` (already fully migrated collection, or empty collection).                                                    |
| **Steps**           | 1. Run `memo migrate --to-v2`.                                                                                                                                                    |
| **Expected Result** | `scanned: 0`, `migrated: 0`, `skipped: 0`, exit `0`, zero write calls.                                                                                                            |
| **Pass Criteria**   | Exit code `0` (not a non-zero "nothing to do" error). No write-family call. This overlaps EC-4 (empty collection) but tests the no-op case broadly, including "already fully v2." |

### SC-4: `--rules <file>` with the full §18.11 custom rule set

| Field               | Value                                                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC1, AC4                                                                                                                                                                                                               |
| **Type**            | happy-path                                                                                                                                                                                                             |
| **Severity**        | critical                                                                                                                                                                                                               |
| **Preconditions**   | A valid custom rules JSON file with 3 rules ordered: `tags_any`, `entry_type_in`, and a catch-all `{ "name": "3", "when": {}, "set": { "kind": "semantic" } }`.                                                        |
| **Steps**           | 1. Run `memo migrate --to-v2 --dry-run --rules <file>` against fixture points that each match exactly one of the three rules. 2. Inspect `by_rule` output.                                                             |
| **Expected Result** | `by_rule` reflects the custom rule names (`"1"`, `"2"`, `"3"`), not the default rule numbering's semantics; each fixture point is attributed to exactly the rule it matches; the default rules are not applied at all. |
| **Pass Criteria**   | `by_rule` count sums to `scanned`. Each fixture point's resulting payload matches the `set` block of the rule it matched, including `session_from`/`expires_in_days` only where the matching rule is episodic-shaped.  |

### SC-5: `memo bank list` shows all migrated points under `kb` after apply

| Field               | Value                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC1                                                                                                                                       |
| **Type**            | happy-path                                                                                                                                |
| **Severity**        | major                                                                                                                                     |
| **Preconditions**   | Real run of SC-1 has completed against the mocked/seeded fixture.                                                                         |
| **Steps**           | 1. Run `memo bank list`. 2. Inspect the `kb` bank's reported count.                                                                       |
| **Expected Result** | `kb`'s count includes every migrated point (all points scanned by the migration, since default rules classify everyone into `kb`).        |
| **Pass Criteria**   | Count matches the number of points migrated in SC-1's real run. This is the story's own documented "Verification after apply" checkpoint. |

---

## Contract Validation Scenarios

Contracts under test:

| Boundary                                                 | Type            | Consumer                                   | Provider                     |
| -------------------------------------------------------- | --------------- | ------------------------------------------ | ---------------------------- |
| Rules-file JSON schema (`when`/`set` shape)              | consumer-driven | `src/lib/migrate.ts` rules validator (Zod) | user-authored `--rules` file |
| Exhaustiveness-rejection contract                        | consumer-driven | rules validator                            | user-authored `--rules` file |
| `planMigration` return-shape contract                    | provider-driven | `src/commands/migrate.ts`                  | `src/lib/migrate.ts`         |
| `memo migrate --to-v2 --json` envelope                   | provider-driven | CI / operator tooling / this test suite    | `src/commands/migrate.ts`    |
| Qdrant write-call contract (which methods may be called) | provider-driven | this test suite (safety oracle)            | `src/commands/migrate.ts`    |

### CT-1: `when.tags_any` operator

| Field               | Value                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC4                                                                                                                                                                   |
| **Contract type**   | consumer-driven                                                                                                                                                       |
| **Boundary**        | Rules-file schema — `tags_any`                                                                                                                                        |
| **Direction**       | request (rules file as input to the validator/planner)                                                                                                                |
| **Input**           | Rule `{ "when": { "tags_any": ["a", "b"] } }` against points with `tags: ["a"]`, `tags: ["b"]`, `tags: ["c"]`, `tags: []`.                                            |
| **Expected Result** | The rule matches points with `tags` containing `a` **or** `b` (union, not intersection); `tags: ["c"]` and `tags: []` fall through to the next rule.                  |
| **Pass Criteria**   | Exactly the union-matching points are attributed to this rule in `by_rule`; non-matching points are attributed to a later rule or fail exhaustiveness if none exists. |

### CT-2: `when.tags_all` operator

| Field               | Value                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC4                                                                                                                                              |
| **Contract type**   | consumer-driven                                                                                                                                  |
| **Boundary**        | Rules-file schema — `tags_all`                                                                                                                   |
| **Direction**       | request                                                                                                                                          |
| **Input**           | Rule `{ "when": { "tags_all": ["a", "b"] } }` against points with `tags: ["a","b"]`, `tags: ["a"]` only, `tags: ["a","b","c"]`.                  |
| **Expected Result** | Matches only when **all** listed tags are present (intersection semantics), regardless of extra tags; `tags: ["a"]` alone does not match.        |
| **Pass Criteria**   | `tags: ["a","b"]` and `tags: ["a","b","c"]` match; `tags: ["a"]` does not. Distinguishes this operator from `tags_any` (CT-1) at the test level. |

### CT-3: `when.entry_type_in`, `when.source_in`, `when.repo_in` operators

| Field               | Value                                                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC4                                                                                                                                                                                                                          |
| **Contract type**   | consumer-driven                                                                                                                                                                                                              |
| **Boundary**        | Rules-file schema — `entry_type_in` / `source_in` / `repo_in`                                                                                                                                                                |
| **Direction**       | request                                                                                                                                                                                                                      |
| **Input**           | Three separate rules, each isolating one operator: `entry_type_in: ["decision"]`, `source_in: ["manual"]`, `repo_in: ["memo-cli"]`, each tested against matching and non-matching payload values.                            |
| **Expected Result** | Each operator matches on membership of the point's corresponding field in the listed set, independent of the other two operators (no cross-field leakage — an `entry_type_in` rule must not accidentally match on `source`). |
| **Pass Criteria**   | Each operator's matching/non-matching cases resolve independently; combining two operators in one rule's `when` (AND semantics across operator keys) is exercised at least once and matches only the intersection.           |

### CT-4: `set.kind` is required; `session_from`/`expires_in_days` are episodic-only

| Field               | Value                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC4                                                                                                                                                                                                                                                                       |
| **Contract type**   | consumer-driven                                                                                                                                                                                                                                                           |
| **Boundary**        | Rules-file schema — `set` block                                                                                                                                                                                                                                           |
| **Direction**       | request                                                                                                                                                                                                                                                                   |
| **Input**           | (a) a rule with `set: {}` (missing `kind`); (b) a rule with `set: { kind: "semantic", session_from: "story" }` (episodic-only field on a semantic rule); (c) a valid episodic rule with `session_from`/`expires_in_days`.                                                 |
| **Expected Result** | (a) fails `VALIDATION_FAILED` before any scan. (b) either rejected as invalid combination, or the episodic-only fields are silently ignored on a `semantic` `set` — record whichever is observed (see note below); (c) accepted and applied.                              |
| **Pass Criteria**   | (a) is a firm gate: `VALIDATION_FAILED`, zero `scrollAll` calls. (c) is a firm gate: fields applied as specified. (b) is recorded as `undetermined` behavior evidence since the story does not specify reject-vs-ignore for episodic-only fields on a non-episodic `set`. |

### CT-5: Exhaustiveness-rejection contract

| Field               | Value                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC4                                                                                                                                                                                                           |
| **Contract type**   | consumer-driven                                                                                                                                                                                               |
| **Boundary**        | Exhaustiveness-rejection contract                                                                                                                                                                             |
| **Direction**       | request                                                                                                                                                                                                       |
| **Input**           | A rules file with two rules, neither of which has an empty `when` (no catch-all).                                                                                                                             |
| **Expected Result** | Validation fails with `VALIDATION_FAILED` (exact error code per spec §18.11: "rule set is not exhaustive: add a final rule with empty `when`"), **before any scan is attempted**.                             |
| **Pass Criteria**   | Exit code matching the `VALIDATION_FAILED` catalog entry. Zero `scrollAll` calls (this is the request-side half of CT-6/AC4's "before any scan" clause). Error message names the missing catch-all condition. |

### CT-6: `scrollAll` is never invoked when rules validation fails (ordering contract)

| Field               | Value                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC4                                                                                                                                                        |
| **Contract type**   | provider-driven                                                                                                                                            |
| **Boundary**        | `planMigration`/command ordering contract ("before any scan")                                                                                              |
| **Direction**       | response (behavioral ordering)                                                                                                                             |
| **Input**           | Non-exhaustive rules file (same as CT-5), and separately a rules file that is not a JSON array.                                                            |
| **Expected Result** | In both cases, the Qdrant client's `scrollAll` mock is asserted to have zero calls — validation happens strictly before the network-scanning phase begins. |
| **Pass Criteria**   | Zero `scrollAll` invocations in both failure modes. This is distinct from CT-5 in that it asserts the _mock call count_, not just the exit code/message.   |

### CT-7: `planMigration` return-shape contract

| Field               | Value                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC1                                                                                                                                                                                                          |
| **Contract type**   | provider-driven                                                                                                                                                                                              |
| **Boundary**        | `planMigration` return-shape contract                                                                                                                                                                        |
| **Direction**       | response                                                                                                                                                                                                     |
| **Input**           | A mixed fixture array of v1 points (rule-1, rule-2, already-v2).                                                                                                                                             |
| **Expected Result** | `{ ops: { id, payload }[], byRule: Record<string, number>, skipped: number }`. `ops.length + skipped === points.length`. Every `payload` in `ops` includes the full "all" field set from AC1.                |
| **Pass Criteria**   | Shape matches exactly; `src/commands/migrate.ts` can consume `ops` directly as `batchSetPayload` input without further transformation (this is what makes the command a thin wrapper over the pure planner). |

### CT-8: `--json` envelope shape

| Field               | Value                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC2, AC5                                                                                                                                                       |
| **Contract type**   | provider-driven                                                                                                                                                |
| **Boundary**        | `memo migrate --to-v2 --json` envelope                                                                                                                         |
| **Direction**       | response                                                                                                                                                       |
| **Input**           | `--dry-run --json` and (real) `--json`, each against a small fixture.                                                                                          |
| **Expected Result** | `{ scanned: number, migrated: number, skipped: number, by_rule: Record<string, number>, dry_run: boolean }` exactly, per spec §6.1's documented JSON contract. |
| **Pass Criteria**   | All five keys present with correct types; no extra undocumented top-level keys; `dry_run` correctly reflects the flag in both modes.                           |

---

## Edge-Case Catalog

The FR-2.8 rule table is the central edge-case surface for this story; category 5 (Failure Modes) and category 4 (Idempotency) carry the migration-safety negative assertions that matter most.

### 1. Input Domain

### EC-1: Point with both `intent` and `outcome` tags matches rule 1 exactly once

| Field               | Value                                                                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC1                                                                                                                                                                                                                                    |
| **Category**        | Input Domain (FR-2.8 rule table)                                                                                                                                                                                                       |
| **Input / Setup**   | A point with `tags: ["intent", "outcome"]`.                                                                                                                                                                                            |
| **Expected Result** | Matched by rule 1 a single time (not double-counted in `by_rule["1"]`, not matched by rule 2 as well). `kind = episodic`.                                                                                                              |
| **Risk if Missed**  | A planner bug that evaluates rules non-exclusively (e.g., accumulating matches instead of first-match-wins) could double-count this point in `by_rule`, corrupting the printed counts the user relies on before confirming a real run. |

### EC-2: `intent`-tagged point with no `story` field resolves `session_id` to `'legacy'`

| Field               | Value                                                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC1                                                                                                                                                                                                             |
| **Category**        | Input Domain (FR-2.8 rule table)                                                                                                                                                                                |
| **Input / Setup**   | A point with `tags: ["intent"]` and no `story` field (and, separately, `story: ""` and `story: null`).                                                                                                          |
| **Expected Result** | `session_id = 'legacy'` in all three absent/empty/null variants — the "or absent" clause in AC1 is not limited to strictly-`undefined`.                                                                         |
| **Risk if Missed**  | If only strict `undefined` triggers the `'legacy'` fallback, a point with `story: ""` from a v1 write bug would get `session_id: ""`, silently breaking timeline/session grouping in Phase 2's `memo timeline`. |

### EC-3: Point already partially v2 — has `bank` but no `schema_version`

| Field               | Value                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC1                                                                                                                                                                                                                                                                |
| **Category**        | Input Domain / State Transitions (FR-2.8 rule table)                                                                                                                                                                                                               |
| **Input / Setup**   | A point with `bank: "kb"` already set (e.g., from a hand-edited fixture or a prior partial write) but `schema_version` absent.                                                                                                                                     |
| **Expected Result** | Point is migrated (not skipped, since the skip condition is keyed on `schema_version`, not `bank`); resulting `bank` remains `"kb"` (identical outcome whether read as "preserved" or "set unconditionally," per **F-4**). All other AC1 "all" fields are applied. |
| **Pass Criteria**   | Point appears in `ops`, not counted in `skipped`. `bank === "kb"` post-migration. A pre-existing `bank` value other than `"kb"` is `undetermined` per **F-4** and does not block the verdict.                                                                      |

### 2. State Transitions

### EC-4: Empty collection

| Field               | Value                                                                                                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC2, AC3, AC5                                                                                                                                                                                                                                                   |
| **Category**        | State Transitions                                                                                                                                                                                                                                               |
| **Input / Setup**   | Mocked `scrollAll` returns zero pages / zero points.                                                                                                                                                                                                            |
| **Expected Result** | `{ scanned: 0, migrated: 0, skipped: 0, by_rule: {}, dry_run: <flag> }`; exit `0`; zero write calls in any mode.                                                                                                                                                |
| **Risk if Missed**  | A planner or command that assumes at least one page could throw on an empty result set instead of reporting a clean no-op, breaking AC5's "exit 0 on no-op" guarantee and the story's own idempotency claim (empty is the terminal state after full migration). |

### EC-5: Custom rules file whose catch-all sets `kind: episodic` (see F-3)

| Field               | Value                                                                                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC4                                                                                                                                                                                                                                                                                                   |
| **Category**        | Input Domain / Failure Modes                                                                                                                                                                                                                                                                          |
| **Input / Setup**   | Rules file `[{ "name": "1", "when": {}, "set": { "kind": "episodic", "session_from": "legacy", "expires_in_days": 30 } }]` (single catch-all rule, episodic).                                                                                                                                         |
| **Expected Result** | Per **F-3**: record whichever is observed — accepted (since a syntactic catch-all exists) or rejected (if the implementation additionally enforces "catch-all must be semantic," mirroring the safety rationale). Not a hard fail either way pending `product-engineer` confirmation.                 |
| **Risk if Missed**  | If accepted silently, every point in a migration run using this rules file becomes episodic with an expiry — the exact "wrong episodic classification... cannot be undone once purged" risk the Business Rules section warns about, but via a user-supplied rules file rather than the default rules. |

### 3. Timing & Concurrency

### EC-6: Page boundary exactly at 256

| Field               | Value                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC1, AC2, AC3                                                                                                                                                                              |
| **Category**        | Timing / Data Boundaries                                                                                                                                                                   |
| **Input / Setup**   | Exactly 256 unmigrated points (one full page under the documented `scrollAll` batch size), and separately 257 points (one full page + 1).                                                  |
| **Expected Result** | 256-point case: exactly one `batchSetPayload` call covering all 256. 257-point case: exactly two `batchSetPayload` calls (256 + 1), not a dropped or duplicated point at the boundary.     |
| **Risk if Missed**  | An off-by-one in the pagination loop could drop the 256th or 257th point silently — a point that is neither migrated nor reported as skipped, undetectable without an exact boundary test. |

### 4. Idempotency

### EC-7: Second real run reports zero scanned and issues zero write calls

| Field               | Value                                                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC3                                                                                                                                                                                                                                              |
| **Category**        | Idempotency                                                                                                                                                                                                                                      |
| **Input / Setup**   | A fixture that has already had a real migration run applied (all points now carry `schema_version: "2"`).                                                                                                                                        |
| **Expected Result** | `scanned: 0`, `migrated: 0`; **zero** `batchSetPayload`/`setPayload`/`upsert`/`delete*` calls on the second run — not merely "the same points are unaffected," but a literal zero-call assertion on the mock.                                    |
| **Pass Criteria**   | Full mock call-count assertion, matching **AC3**'s explicit wording. This is the idempotency half of the story's core safety guarantee and is asserted independently of SC-1 (which exercises the same flow but as one continuous E2E scenario). |

### 5. Failure Modes

### EC-8: Dry-run issues literally zero write calls, even with rule-1/rule-2 mixed data and a custom `--rules` file (see F-1)

| Field               | Value                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC2                                                                                                                                                                                                  |
| **Category**        | Failure Modes (negative assertion, migration safety)                                                                                                                                                 |
| **Input / Setup**   | Three variants of `--dry-run`: (a) default rules, mixed rule-1/rule-2 fixture; (b) custom `--rules` file; (c) empty collection (overlaps EC-4).                                                      |
| **Expected Result** | In all three variants: zero calls to `batchSetPayload`, `setPayload`, `upsert`, and every `delete*` method on the mock. No exceptions for "small" fixtures or single-page results.                   |
| **Pass Criteria**   | This is the story's single most safety-critical assertion (per **F-1**); it must pass identically regardless of rule set or fixture size. Treated as a release-blocking gate, not merely a scenario. |

### EC-9: No `delete*` call occurs across dry-run, first real run, and second real run in one continuous scenario (see F-2)

| Field               | Value                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC2, AC3                                                                                                                                                       |
| **Category**        | Failure Modes (negative assertion, migration safety)                                                                                                           |
| **Input / Setup**   | Same fixture and sequence as SC-1 (dry-run → real → second real), with an assertion checkpoint after **each** phase rather than only at the end.               |
| **Expected Result** | Zero `delete*` calls of any kind at every checkpoint — not just a final aggregate check that could mask a delete call that happened but was later "corrected." |
| **Pass Criteria**   | Per **F-2**, the no-delete guarantee is checked after each of the three phases independently, not only cumulatively at the end of the scenario.                |

### EC-10: Non-array rules file

| Field               | Value                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC4                                                                                                                                                                        |
| **Category**        | Failure Modes                                                                                                                                                              |
| **Input / Setup**   | `--rules` points to a file containing a JSON object (`{...}`) instead of an array, and separately a file containing invalid JSON.                                          |
| **Expected Result** | `VALIDATION_FAILED` before any scan (same ordering guarantee as CT-5/CT-6); malformed JSON produces a distinct, clear parse error, not an unhandled exception/stack trace. |
| **Pass Criteria**   | Both variants exit non-zero with an intelligible message; zero `scrollAll` calls in either case.                                                                           |

### 6. Auth & Permissions

**N/A — no new auth surface.** `memo migrate --to-v2` reuses the existing Qdrant credential model (`QDRANT_URL`/`QDRANT_API_KEY`) unchanged; it introduces no new identity, role, or permission concept. The "confirmation gate" in this story's Migration Requirements is a **human process control** (the developer must ask the user before applying), not an authentication/authorization mechanism, so it is covered under Migration Verification below rather than this edge-case category.

### 7. Data Boundaries

### EC-11: `by_rule` counts sum exactly to `scanned` across boundary-sized fixtures

| Field               | Value                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC1, AC2                                                                                                                                                                                                                        |
| **Category**        | Data Boundaries                                                                                                                                                                                                                 |
| **Input / Setup**   | Fixtures of size 0, 1, 256, and 257, each with a deliberate mix of rule-1/rule-2/already-v2 points.                                                                                                                             |
| **Expected Result** | `sum(by_rule.values()) + skipped === scanned` holds exactly at every size, including the zero case (all sums are `0`).                                                                                                          |
| **Risk if Missed**  | A silent arithmetic drift (e.g., a point counted in `scanned` but not attributed to any rule) would misreport the dry-run preview the human confirmation step relies on, undermining the entire confirmation-gate safety model. |

### 8. Resource Exhaustion

**N/A for this story's scope.** Pagination is fixed at batch size 256 via `scrollAll`; there is no user-controllable unbounded input analogous to a `--limit` flag. A migration over an arbitrarily large collection is bounded by the number of pages processed sequentially, not by any single in-memory structure sized to the whole collection — flagged as a Recommendation (very large collections' wall-clock time) rather than a resource-exhaustion vector.

### 9. API Versioning

### EC-12: Rules-file schema must tolerate future additive `when`/`set` keys without breaking existing files

| Field               | Value                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC4                                                                                                                                                                                                                         |
| **Category**        | API Versioning                                                                                                                                                                                                              |
| **Input / Setup**   | A valid §18.11-shaped rules file with one extra, unrecognized key inside a rule object (e.g., `"note": "internal comment"`).                                                                                                |
| **Expected Result** | The extra key is either ignored (additive-tolerant Zod schema) or explicitly rejected with a clear "unknown key" error — either is acceptable, but a silent misinterpretation of the unknown key as a real operator is not. |
| **Pass Criteria**   | The rule still matches/behaves per its recognized `when`/`set` fields; the unknown key does not alter matching semantics for any point.                                                                                     |

---

## Randomized Tactics and Seed Policy

Seed format: `<tactic-type>-<AC-id>-<unix-timestamp>-<4-hex>`
Replay: `pnpm test -- --testPathPattern="migrate" --seed=<captured-seed>`

Seeds **MUST** be recorded in the run log and in any failure report. On failure, follow the `verifier` Failure Triage Workflow (capture → replay → minimize → classify → report), with a maximum of 3 reproduction attempts before marking `inconclusive`.

### RT-1: Property — every randomized point lands in exactly one rule (default rules)

| Field                  | Value                                                                                                                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**              | AC1                                                                                                                                                                                                                                                       |
| **Tactic type**        | property-based                                                                                                                                                                                                                                            |
| **Input surface**      | Randomly generated points with varying `tags` (random subsets of `["intent", "outcome", "decision", "structure", "note", ...]`, including empty), `entry_type`, `source`, presence/absence of `story`, presence/absence of pre-existing `schema_version`. |
| **Property / Oracle**  | Every point is attributed to **exactly one** entry in `by_rule` (never zero, never more than one) unless it is `schema_version === "2"`, in which case it is counted in `skipped` and appears in **no** rule bucket. `sum(by_rule) + skipped === total`.  |
| **Iterations**         | 1000                                                                                                                                                                                                                                                      |
| **Seed**               | `prop-AC1-{timestamp}-{hex}`                                                                                                                                                                                                                              |
| **Replay instruction** | `pnpm test -- --testPathPattern="migrate" --seed=<seed> --iterations=1`                                                                                                                                                                                   |
| **Shrink strategy**    | Reduce the random point's field set to the minimal combination (fewest tags, simplest `entry_type`/`source`) that still produces a double-count or zero-count violation.                                                                                  |

### RT-2: Property — every randomized point lands in exactly one rule (custom rules with all five `when` operators)

| Field                  | Value                                                                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**              | AC1, AC4                                                                                                                                                                                                         |
| **Tactic type**        | property-based                                                                                                                                                                                                   |
| **Input surface**      | A fixed 4-rule custom rules file exercising `tags_any`, `tags_all`, `entry_type_in`, `source_in`/`repo_in` combined, plus a catch-all; randomly generated points varying `tags`, `entry_type`, `source`, `repo`. |
| **Property / Oracle**  | Same as RT-1's exactly-one-rule property, but against the custom rule set, confirming first-match-wins ordering holds under randomized inputs that could match multiple rules if evaluated out of order.         |
| **Iterations**         | 800                                                                                                                                                                                                              |
| **Seed**               | `prop-AC4-{timestamp}-{hex}`                                                                                                                                                                                     |
| **Replay instruction** | `pnpm test -- --testPathPattern="migrate" --seed=<seed> --iterations=1`                                                                                                                                          |
| **Shrink strategy**    | Reduce to the minimal point whose field set matches ≥ 2 of the 4 rules simultaneously, to isolate an ordering bug from a genuine exclusivity bug.                                                                |

### RT-3: Fuzz — malformed points passed to `planMigration` never throw an unhandled exception

| Field                  | Value                                                                                                                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**              | AC1                                                                                                                                                                                                                                                                                 |
| **Tactic type**        | fuzz                                                                                                                                                                                                                                                                                |
| **Input surface**      | Randomly mutated point objects: `tags` as a string instead of array, `tags: null`, missing `id`, `story` as a number, deeply nested unexpected payload shapes.                                                                                                                      |
| **Property / Oracle**  | `planMigration` either handles the malformed point gracefully (typed validation error surfaced per-point) or the whole call fails with a typed, catchable error — never an unhandled exception that would abort a real migration run mid-page and leave partial state undocumented. |
| **Iterations**         | 500                                                                                                                                                                                                                                                                                 |
| **Seed**               | `fuzz-AC1-{timestamp}-{hex}`                                                                                                                                                                                                                                                        |
| **Replay instruction** | `pnpm test -- --testPathPattern="migrate" --seed=<seed> --iterations=1`                                                                                                                                                                                                             |
| **Shrink strategy**    | Remove/mutate one field at a time until the minimal offending field is isolated.                                                                                                                                                                                                    |

---

## Migration Verification

This is the one Phase 2 story with a real migration lifecycle (spec §5.5, PRD FR-2.8/AC-2.7, story Migration Requirements, task-list sub-tasks 9.12–9.17). This section mirrors that lifecycle exactly and is the primary evidence source for the manual/`memo_eval` half of AC2/AC3/AC6, distinct from the mocked unit/integration coverage above.

### MV-1: Dry-run against `memo_eval` first

| Field                  | Value                                                                                                                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**              | AC2                                                                                                                                                                                                                         |
| **Sequencing**         | Step 1 of the migration lifecycle — **must** run before any real-apply step.                                                                                                                                                |
| **Command**            | `MEMO_COLLECTION=memo_eval pnpm exec node dist/index.js migrate --to-v2 --dry-run` (task 9.14).                                                                                                                             |
| **Expected Result**    | Printed `by_rule` counts reflect the 44 fixture points' actual tags (per the story's Manual/UI Testing note). `decisions` collection is never touched — this command targets `memo_eval` exclusively via `MEMO_COLLECTION`. |
| **Evidence to record** | The printed `{ scanned, migrated, skipped, by_rule }` output, verbatim, in the PR body (task 9.14 requirement).                                                                                                             |

### MV-2: Review counts and obtain human-confirmed sign-off before any real apply

| Field                  | Value                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**              | N/A — process gate, not a behavioral AC, but load-bearing for the story's "human-confirmation-gated apply flow"                                                                                                                      |
| **Sequencing**         | Step 2 — between MV-1 and MV-3.                                                                                                                                                                                                      |
| **Actions**            | The developer presents MV-1's dry-run counts to the user and explicitly asks for confirmation before running the real migration against `memo_eval` (task 9.15). The user's response is the gate — no automated bypass is permitted. |
| **Expected Result**    | No real-apply command is executed until the user has responded affirmatively. This is the same class of guard as a blocked git-guard hook: it is a decision point, not a formality to route around.                                  |
| **Evidence to record** | The confirmation exchange (or its absence, if the developer proceeds without it) is a fidelity-audit finding, not a design-time pass/fail — Audit Mode will check this against the actual PR/session transcript.                     |

### MV-3: Human-confirmed real run against `memo_eval` only — never `decisions`

| Field               | Value                                                                                                                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC3                                                                                                                                                                                                                                                                                      |
| **Sequencing**      | Step 3 — only after MV-2's confirmation.                                                                                                                                                                                                                                                 |
| **Command**         | `MEMO_COLLECTION=memo_eval pnpm exec node dist/index.js migrate --to-v2` (task 9.16). **This story explicitly must never run this command, or any variant of it, against `decisions`.**                                                                                                  |
| **Expected Result** | All unmigrated `memo_eval` points are rewritten with v2 payloads per the FR-2.8 rule table; `decisions` collection point count and payloads are provably unchanged (probe both before and after via `memo inspect`/`memo bank list` scoped to a `decisions`-targeted `MEMO_COLLECTION`). |
| **Pass Criteria**   | `memo_eval` migrated-point count matches the dry-run's `migrated` figure exactly. `decisions` is untouched — this is checked as a negative-space assertion, not assumed from "we only set `MEMO_COLLECTION=memo_eval`."                                                                  |

### MV-4: Second-run idempotency check

| Field               | Value                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC3                                                                                                                                        |
| **Sequencing**      | Step 4 — immediately after MV-3.                                                                                                           |
| **Command**         | `MEMO_COLLECTION=memo_eval pnpm exec node dist/index.js migrate --to-v2` (run a second time; task 9.16).                                   |
| **Expected Result** | `scanned: 0`, `migrated: 0`. No error, no unexpected re-classification, no `delete*` call.                                                 |
| **Pass Criteria**   | Output matches EC-7's mocked-level assertion, now confirmed against a real `memo_eval` collection rather than a mock — the two must agree. |

### MV-5: Post-migration `pnpm run eval:relevance` regression check (96.4% floor)

| Field                | Value                                                                                                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**            | AC6                                                                                                                                                                                                                                                                                                    |
| **Sequencing**       | Step 5 — final verification, after MV-4 confirms idempotency.                                                                                                                                                                                                                                          |
| **Command**          | `MEMO_COLLECTION=memo_eval pnpm run eval:relevance` (task 9.17; story's Manual/UI Testing note; also referenced by S2-11's exit gate at line 929 of the story doc, which explicitly expects `scanned: 0` to already hold from this story).                                                             |
| **Expected Result**  | Overall top-3 hit rate remains **≥ 96.4%** (the S1-01/S1-02-established floor) — the migration's payload rewrite must not degrade `memo search`'s existing ranking behavior. This is the same floor referenced by AC6's replay-identity requirement, applied here as a live, non-replay corroboration. |
| **Pass Criteria**    | Reported overall hit rate `≥ 96.4%`. Any drop below the floor is a **release-blocking** finding for this story specifically (distinct from ordinary drift, because AC6 makes ranking-identity-preservation an explicit acceptance criterion, not just a nice-to-have regression check).                |
| **Additional check** | `memo bank list` shows `kb` with all points (task 9.17's second clause) — corroborates MV-3/SC-5.                                                                                                                                                                                                      |

**Explicit non-goal restated:** at no point in MV-1 through MV-5 is `memo migrate --to-v2` (dry-run or real) run against the `decisions` collection. Applying to `decisions` is a separate, user-run step after the 1.3.0 release, per the story's Migration Requirements and task 9.23's PR-description requirement. Any test evidence, PR content, or session transcript showing a real-apply invocation against `decisions` within this story's scope is an automatic **Critical** fidelity finding in a later Audit Mode pass, not something this Design Mode plan can pre-empt beyond flagging it here.

---

## Execution Checklist

Pre-implementation (test-first — these should fail before code exists):

- [ ] Scaffold `tests/unit/lib/migrate.test.ts` with EC-1, EC-2, EC-3, RT-1 as failing tests against `planMigration`.
- [ ] Scaffold `tests/unit/commands/migrate.test.ts` with EC-8 (dry-run zero-write assertion) as a failing test before `src/commands/migrate.ts` exists.
- [ ] Scaffold `tests/integration/commands/migrate.test.ts` with SC-1's three-phase flow (dry-run → real → second real) as a failing integration test.

During implementation:

- [ ] SC-1 … SC-5 pass.
- [ ] CT-1 … CT-8 pass, with CT-4(b) recorded as `undetermined` evidence per F-3.
- [ ] EC-1 … EC-12 pass, with EC-3's out-of-domain `bank` probe and EC-5 recorded as `undetermined` per F-4/F-3.
- [ ] RT-1 … RT-3 executed; seeds recorded in the run log.

Migration lifecycle (mandatory, non-skippable per the story's Definition of Done):

- [ ] MV-1: dry-run against `memo_eval`; `by_rule` counts recorded in the PR body.
- [ ] MV-2: explicit user confirmation obtained before any real apply.
- [ ] MV-3: real run against `memo_eval` only; `decisions` proven untouched.
- [ ] MV-4: second run confirms `scanned: 0`.
- [ ] MV-5: `pnpm run eval:relevance` against `memo_eval` confirms ≥ 96.4%; `memo bank list` confirms `kb` coverage.

Quality gates:

- [ ] `pnpm test -- --testPathPattern="migrate|replay"` — targeted green.
- [ ] `pnpm run lint`, `pnpm run format:check`, `pnpm run typecheck`, `pnpm test`, `pnpm audit` — full quality gate per AGENTS.md.
- [ ] `pnpm run validate`.
- [ ] `README.md` migration section updated (dry-run first, what changes, what does not, `decisions` apply is a separate post-release user step); `docs/data-model.md` updated.

Negative-space checks (non-goals stay untouched):

- [ ] No vector/embedding is ever sent in any `migrate` call, in any mode.
- [ ] No `delete*` method is ever called, in any mode, at any point in the checklist (F-2).
- [ ] `decisions` collection is never targeted by any `migrate --to-v2` invocation performed as part of this story's own execution.
- [ ] `dedupe_key_version` is left unchanged on every migrated point.

---

## Recommendations

| #   | Finding                                                                                                                 | Owner              | Recommended action                                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **F-1** — AC2's zero-write guarantee is the story's single most safety-critical assertion                               | `developer`        | Treat EC-8 as a release-blocking gate, not an ordinary test case; assert exact mock call counts (`toHaveBeenCalledTimes(0)`), not "not called with a specific arg."              |
| 2   | **F-2** — "No delete ever" should be checked per-phase, not only cumulatively                                           | `developer`        | Implement EC-9 as three independent checkpoints within one test, so a delete call that occurs then gets "corrected" by a later assertion reset cannot slip through.              |
| 3   | **F-3** — Custom rules file catch-all `kind` constraint is unspecified                                                  | `product-engineer` | Confirm whether a catch-all rule setting `kind: episodic` should be accepted or rejected, given the Business Rules' stated asymmetry between mis-episodic and mis-semantic risk. |
| 4   | **F-4** — Pre-existing `bank` value other than `kb` on a v1 point is untestable against real data but ambiguous in spec | `product-engineer` | Confirm this is genuinely unreachable in practice (v1 payloads have no `bank` field) so EC-3's out-of-domain probe can be marked N/A rather than left `undetermined`.            |
| 5   | Very large collections' wall-clock migration time is unbounded by this design                                           | `product-engineer` | Consider whether a progress/ETA enhancement is warranted for a future story, given `memo_eval` is only 44 points and does not exercise this at scale.                            |

---

## Output Contract

| Field                  | Value                                                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mode**               | Design                                                                                                                                                                                                                        |
| **Phase**              | 4 — Reporting & Publication (complete)                                                                                                                                                                                        |
| **Source artifact**    | `workstream/user-stories-prd-004-phase-2.md` (Story S2-09)                                                                                                                                                                    |
| **Artifacts produced** | `workstream/test-plan-issue-88.md`, `workstream/traceability-matrix-issue-88.md`                                                                                                                                              |
| **GitHub issue**       | [#88](https://github.com/llipe/memo-cli/issues/88)                                                                                                                                                                            |
| **AC coverage**        | 6/6 addressed (AC1 … AC6), each with ≥ 1 positive and ≥ 1 negative/edge scenario.                                                                                                                                             |
| **Scenario counts**    | 5 E2E, 8 contract, 12 edge-case, 3 randomized, 5 Migration Verification steps                                                                                                                                                 |
| **Blocking gaps**      | None for design. Three items require `product-engineer` clarification before a firm audit-time verdict: **F-3/EC-5/CT-4(b)**, **F-4/EC-3**, and MV-2's human-confirmation evidence (an audit-time, not design-time, concern). |
