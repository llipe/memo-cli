# Compliance Test Plan — Issue #61: Relevance Evaluation Harness and Recorded Baseline (S1-01)

> Produced by **`verifier`** (Design Mode) on 2026-09-19. Pre-implementation. Black-box: all assertions derive from observable CLI/script behavior, not internal code structure.

## Changelog

| Version | Date       | Summary           | Author   |
| ------- | ---------- | ----------------- | -------- |
| 1.0     | 2026-09-19 | Initial test plan | verifier |

## Source Input Summary

| Field               | Value                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Repository**      | `llipe/memo-cli`                                                                                                                          |
| **GitHub Issue**    | [#61](https://github.com/llipe/memo-cli/issues/61)                                                                                        |
| **Input type**      | `story`                                                                                                                                   |
| **Source artifact** | `workstream/user-stories-prd-004-phase-1.md` v1.0 — Story S1-01                                                                           |
| **Also binding**    | `docs/requirements/prd-004-long-lived-agent-memory.md` v1.4 (FR-1.1, AC-1.1, AC-1.5); spec §14 ("Relevance replay"/"Relevance live" rows) |
| **Task list**       | `workstream/tasks-prd-004-phase-1-plan.md`, task 1.0 (sub-tasks 1.1–1.26)                                                                 |
| **ACs extracted**   | 9 (AC1 … AC9)                                                                                                                             |
| **Traceability**    | `workstream/traceability-matrix-issue-61.md`                                                                                              |

Observable surfaces available to black-box testing:

1. `pnpm run eval:relevance` (default/run mode) — stdout, exit code.
2. `pnpm run eval:relevance --seed` — stdout, exit code, Qdrant collection state (`memo_eval` vs `decisions`).
3. `pnpm run eval:relevance --record` — stdout, exit code, and the written artifacts `tests/fixtures/relevance/candidates.json` / `baseline.json`.
4. `tests/relevance/replay.test.ts` under `pnpm test` — pass/fail, no network.
5. `memo inspect` — used as an independent probe to confirm collection isolation (AC7).
6. `src/lib/qdrant.ts` collection-name resolution — observable indirectly via `--seed`/`--record` targeting `MEMO_COLLECTION` and via unit tests exercising `QdrantRepository` construction.

---

## Pre-Implementation Findings

Design-time analysis surfaced items that affect how the ACs must be tested. All are reported, not fixed — remediation belongs to `developer`; scope questions belong to `product-engineer`.

### F-1 — "Idempotent" (AC4) is stated but the collision semantics are unspecified (Major, design concern)

AC4 requires `--seed` to be "idempotent (fixed ids, re-runnable)" but neither the story nor the task list specifies whether a second `--seed` run must (a) upsert-overwrite existing points with identical payloads, (b) skip points that already exist, or (c) error if a point exists with a different payload than what would be written. All three satisfy "re-runnable without duplicating points," but they are observably different behaviors if a fixture entry's content changes between two `--seed` runs without a corresponding point deletion. Test **EC-6** exercises re-seeding after a fixture edit and records the actual behavior as evidence; it does not fail the story if the resulting behavior is upsert-overwrite (the most common interpretation), but flags any silent data drift for `product-engineer` confirmation.

### F-2 — "Exits 0 regardless of score" (AC3) could mask a broken harness (Minor)

AC3 says the run mode "exits 0 regardless of score (it reports, it does not gate)." Taken literally, a run that computes `0%` hit rate across every category (e.g., because Qdrant returned nothing) is still exit `0`. This is intentional per the business rule ("the baseline is a floor... AC-1.5 compares at phase exit"), but it means a badly broken harness looks identical, at the exit-code level, to a working one with poor ranking. **SC-3** and **EC-8** therefore assert on the _stdout content_ (numeric hit rates present, no `NaN`/`undefined`) in addition to the exit code, since exit code alone is not a sufficient oracle for AC3.

### F-3 — `MEMO_COLLECTION` unset behavior differs between `--seed` and plain `run`/`--record` (Minor, needs confirmation)

AC7 states a run with no `MEMO_COLLECTION` "never writes fixtures into `decisions`," and the task list (1.10) separately requires `--seed` to refuse and exit 1 when `MEMO_COLLECTION` is unset. It does not say whether the default **run** mode (no `--seed`, no `--record`, read-only queries) must also refuse when `MEMO_COLLECTION` is unset, or whether a read-only run against the default `decisions` collection is tolerated (it would read production data, not write it, so AC7's "never writes" clause would technically still hold). **EC-7** tests both modes separately and records the observed behavior; only the `--seed` refusal is a firm pass/fail gate (task 1.10 makes it explicit), the plain-run case is `undetermined` pending confirmation.

---

## Acceptance Criteria Extraction

| ID  | Criterion (condensed)                                                                                                                                                  | Source AC |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| AC1 | `entries.json` holds ≥ 40 seed entries, stable UUIDs, covering architectural/integration/structure/intent-outcome entry types, file-naming entries, ≥ 2 repos          | AC1       |
| AC2 | `queries.json` holds 20–30 `{ id, query, expected_ids[], category }` objects across `concept`/`identifier`/`cross-repo`/`recency`, ≥ 6 `identifier`                    | AC2       |
| AC3 | `pnpm run eval:relevance` runs every query live, prints per-category and overall top-3 hit rate, always exits 0                                                        | AC3       |
| AC4 | `pnpm run eval:relevance --seed` upserts fixtures into the eval collection, idempotent (fixed ids, re-runnable)                                                        | AC4       |
| AC5 | `--record` writes `candidates.json` (per-query candidate id/score/payload fields) and `baseline.json` (`recorded_at`, `overall_top3`, `by_category`, `ranking_config`) | AC5       |
| AC6 | `tests/relevance/replay.test.ts` replays `candidates.json` offline, no network, asserts hit rate ≥ `baseline.json.overall_top3`                                        | AC6       |
| AC7 | Eval collection isolated via `MEMO_COLLECTION` (default `decisions`); eval script sets `memo_eval`; unset `MEMO_COLLECTION` never writes into `decisions`              | AC7       |
| AC8 | Measured baseline recorded as a new changelog row in the PRD-004 doc, overall + per-category hit rate                                                                  | AC8       |
| AC9 | `pnpm test` passes with the replay test included; replay test requires no `QDRANT_URL`/`EMBEDDINGS_API_KEY`                                                            | AC9       |

**Non-goals** (must remain untouched — negative-space assertions): no ranking behavior change in `src/commands/search.ts` (the story explicitly changes no production ranking; `rankResults` is still identity-by-`similarity` until S1-02); the `decisions` collection's contents; existing `memo search`/`memo list`/`memo read` behavior; no `ranking` config block exists yet (that is S1-02).

**Coverage note:** AC8 is a documentation/process criterion (a PRD changelog row), verified by diff inspection rather than a behavioral scenario; it is covered in the Execution Checklist and traceability matrix, not by an SC/EC scenario. This is flagged per the skill's requirement to declare ACs not coverable by E2E scenarios. AC1 and AC2 are primarily static-fixture-shape criteria; they are covered by schema-validation scenarios (SC-1, SC-2) rather than CLI-behavior scenarios, since the fixtures themselves are the observable artifact.

---

## E2E Black-Box Scenarios

### SC-1: `entries.json` satisfies the fixture-shape contract

| Field               | Value                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC1                                                                                                                                                                                                                                                                                                                                  |
| **Type**            | happy-path                                                                                                                                                                                                                                                                                                                           |
| **Severity**        | critical                                                                                                                                                                                                                                                                                                                             |
| **Preconditions**   | `tests/fixtures/relevance/entries.json` exists.                                                                                                                                                                                                                                                                                      |
| **Steps**           | 1. Load the file and validate against the entry-seed Zod schema defined in `scripts/eval-relevance.ts`. 2. Tally entry categories, `files_modified` presence, repos, `source` spread.                                                                                                                                                |
| **Expected Result** | ≥ 40 entries, all with stable UUIDs (re-running validation twice yields identical ids). At least one entry per: architectural decision, integration point, structure entry, intent/outcome style, an entry naming a specific file in `files_modified`. ≥ 2 distinct repos represented. `source` values span `agent`/`manual`/`scan`. |
| **Pass Criteria**   | Schema validation passes with zero issues. All category/repo/source counts meet their stated minimums.                                                                                                                                                                                                                               |

### SC-2: `queries.json` satisfies the fixture-shape contract

| Field               | Value                                                                                                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC2                                                                                                                                                                                                                                                              |
| **Type**            | happy-path                                                                                                                                                                                                                                                       |
| **Severity**        | critical                                                                                                                                                                                                                                                         |
| **Preconditions**   | `tests/fixtures/relevance/queries.json` exists.                                                                                                                                                                                                                  |
| **Steps**           | 1. Load and validate against the query Zod schema (`{ id, query, expected_ids[], category }`). 2. Count total queries and per-category counts.                                                                                                                   |
| **Expected Result** | 20–30 total queries. Categories restricted to `concept`/`identifier`/`cross-repo`/`recency`. ≥ 6 `identifier` queries, each naming a file, flag, or issue reference in its `query` text. Every `expected_ids` entry resolves to an id present in `entries.json`. |
| **Pass Criteria**   | Schema validation passes. Count bounds hold. Zero dangling `expected_ids` references (every referenced id exists in `entries.json`).                                                                                                                             |

### SC-3: Default run mode reports hit rates and always exits 0

| Field               | Value                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC3                                                                                                                                                                               |
| **Type**            | happy-path                                                                                                                                                                        |
| **Severity**        | critical                                                                                                                                                                          |
| **Preconditions**   | `MEMO_COLLECTION=memo_eval`, fixtures seeded (post-SC-4), live Qdrant + embeddings provider reachable.                                                                            |
| **Steps**           | 1. Run `pnpm run eval:relevance`. 2. Capture stdout and exit code.                                                                                                                |
| **Expected Result** | stdout prints a per-category hit rate for each of the four categories and an overall top-3 hit rate, all as finite numbers (no `NaN`/`undefined`). Exit code `0`.                 |
| **Pass Criteria**   | Exit `0`. stdout matches a per-category line for each of `concept`/`identifier`/`cross-repo`/`recency` plus one overall figure. Per F-2, content is asserted, not just exit code. |

### SC-4: `--seed` upserts fixtures into the isolated eval collection

| Field               | Value                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC4, AC7                                                                                                                                                                                       |
| **Type**            | happy-path                                                                                                                                                                                     |
| **Severity**        | critical                                                                                                                                                                                       |
| **Preconditions**   | `MEMO_COLLECTION=memo_eval` set. Collection empty or absent.                                                                                                                                   |
| **Steps**           | 1. Run `memo inspect` (or equivalent point-count probe) against `decisions`, record count. 2. Run `MEMO_COLLECTION=memo_eval pnpm run eval:relevance --seed`. 3. Re-run the `decisions` probe. |
| **Expected Result** | All fixture entries land in `memo_eval`, none in `decisions`. `decisions` point count is unchanged before/after. Exit `0`.                                                                     |
| **Pass Criteria**   | `decisions` count identical pre/post. `memo_eval` point count equals `entries.json` length. Exit `0`.                                                                                          |

### SC-5: `--seed` is idempotent across repeated runs

| Field               | Value                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC4                                                                                                                                                                                                                       |
| **Type**            | happy-path                                                                                                                                                                                                                |
| **Severity**        | critical                                                                                                                                                                                                                  |
| **Preconditions**   | `MEMO_COLLECTION=memo_eval` set, fixtures already seeded once (from SC-4).                                                                                                                                                |
| **Steps**           | 1. Record `memo_eval` point count. 2. Re-run `MEMO_COLLECTION=memo_eval pnpm run eval:relevance --seed` two more times. 3. Record point count after each.                                                                 |
| **Expected Result** | Point count is identical after every re-run — no duplicates created. Each run exits `0`.                                                                                                                                  |
| **Pass Criteria**   | Point count stable across all 3 runs. No error. See **F-1** for the unresolved question of overwrite-vs-skip semantics when payload content changes; this scenario only asserts non-duplication under unchanged fixtures. |

### SC-6: `--record` writes both artifacts with the documented shape

| Field               | Value                                                                                                                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC5                                                                                                                                                                                                                                                                                     |
| **Type**            | happy-path                                                                                                                                                                                                                                                                              |
| **Severity**        | critical                                                                                                                                                                                                                                                                                |
| **Preconditions**   | `MEMO_COLLECTION=memo_eval`, fixtures seeded, live Qdrant + embeddings reachable.                                                                                                                                                                                                       |
| **Steps**           | 1. Run `MEMO_COLLECTION=memo_eval pnpm run eval:relevance --record`. 2. Parse `tests/fixtures/relevance/candidates.json` and `baseline.json`.                                                                                                                                           |
| **Expected Result** | `candidates.json`: one entry per query in `queries.json`, each carrying candidate `id`, Qdrant `score`, and the payload fields ranking needs (`source`, `timestamp_utc`, at minimum). `baseline.json`: exactly the keys `recorded_at`, `overall_top3`, `by_category`, `ranking_config`. |
| **Pass Criteria**   | `candidates.json` query coverage is 1:1 with `queries.json` (by `id`). `baseline.json` has all four required keys, `overall_top3` is a finite number in `[0,1]`, `by_category` has one entry per category present in `queries.json`.                                                    |

### SC-7: Offline replay reproduces the recorded baseline

| Field               | Value                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC6, AC9                                                                                                                                                                                          |
| **Type**            | happy-path                                                                                                                                                                                        |
| **Severity**        | critical                                                                                                                                                                                          |
| **Preconditions**   | Committed `candidates.json` and `baseline.json` from SC-6. No `QDRANT_URL`/`EMBEDDINGS_API_KEY` set in the test environment.                                                                      |
| **Steps**           | 1. Unset `QDRANT_URL` and `EMBEDDINGS_API_KEY`. 2. Run `pnpm test -- --testPathPattern="relevance"`.                                                                                              |
| **Expected Result** | `replay.test.ts` passes. Computed top-3 hit rate from `candidates.json` is `≥ baseline.json.overall_top3`. No network call is attempted (no timeout, no DNS lookup, no credential-missing error). |
| **Pass Criteria**   | Test suite exits `0`. Removing `QDRANT_URL`/`EMBEDDINGS_API_KEY` from the environment does not cause a different result — proving the path is genuinely offline.                                  |

### SC-8: `--seed` refuses to run when `MEMO_COLLECTION` is unset

| Field               | Value                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC7                                                                                                                  |
| **Type**            | negative-path                                                                                                        |
| **Severity**        | critical                                                                                                             |
| **Preconditions**   | `MEMO_COLLECTION` explicitly unset in the shell environment.                                                         |
| **Steps**           | 1. Run `pnpm run eval:relevance --seed` with `MEMO_COLLECTION` unset. 2. Probe `decisions` point count before/after. |
| **Expected Result** | Command refuses to seed: exit `1` with a clear message naming `MEMO_COLLECTION`. `decisions` point count unchanged.  |
| **Pass Criteria**   | Exit `1`. stderr/stdout names `MEMO_COLLECTION`. `decisions` count identical before and after (zero writes).         |

### SC-9: Empty-string `MEMO_COLLECTION` is treated as unset, not as a literal empty collection name

| Field               | Value                                                                                                                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC7                                                                                                                                                                                                                                                                                     |
| **Type**            | negative-path (boundary)                                                                                                                                                                                                                                                                |
| **Severity**        | major                                                                                                                                                                                                                                                                                   |
| **Preconditions**   | `MEMO_COLLECTION=""` (present but empty) in the environment.                                                                                                                                                                                                                            |
| **Steps**           | 1. Run `pnpm run eval:relevance --seed` with `MEMO_COLLECTION=""`.                                                                                                                                                                                                                      |
| **Expected Result** | Falls back to the same refusal behavior as SC-8 (empty string is not a usable collection name), or resolves to the documented default `decisions` — either way it must never silently create/use a collection literally named `""`.                                                     |
| **Pass Criteria**   | Exit `1` naming `MEMO_COLLECTION`, **or** exit `0` with the effective collection name logged as `decisions`. Fails only if the script attempts a Qdrant call with an empty-string collection name, or if it seeds into `decisions` without the AC7 refusal semantics `--seed` requires. |

### SC-10: `PRD-004` changelog carries the recorded baseline

| Field               | Value                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC8                                                                                                                                                               |
| **Type**            | happy-path (documentation)                                                                                                                                        |
| **Severity**        | major                                                                                                                                                             |
| **Preconditions**   | SC-6's `--record` run has completed and produced `baseline.json`.                                                                                                 |
| **Steps**           | 1. Diff `docs/requirements/prd-004-long-lived-agent-memory.md` in the PR. 2. Compare the new changelog row's figures against `baseline.json`.                     |
| **Expected Result** | A new changelog row exists reporting overall and per-category top-3 hit rate, and the figures match `baseline.json` exactly (not rounded differently, not stale). |
| **Pass Criteria**   | Changelog row present. Overall figure and every per-category figure match `baseline.json` to the same precision.                                                  |

---

## Contract Validation Scenarios

Contracts under test:

| Boundary                                       | Type            | Consumer                               | Provider                     |
| ---------------------------------------------- | --------------- | -------------------------------------- | ---------------------------- |
| `candidates.json` / `baseline.json` shape      | provider-driven | `replay.test.ts`, future S1-0x stories | `eval-relevance.ts --record` |
| `entries.json` / `queries.json` fixture schema | consumer-driven | `eval-relevance.ts` (seed/run)         | fixture authors              |
| `MEMO_COLLECTION` environment contract         | consumer-driven | `QdrantRepository`                     | shell / CI environment       |
| `pnpm test` exit-code contract                 | provider-driven | CI, `developer`                        | Jest / replay test           |

### CT-1: `baseline.json` shape is stable for downstream consumers

| Field               | Value                                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC5, AC6                                                                                                                                                                                                                                               |
| **Contract type**   | provider-driven                                                                                                                                                                                                                                        |
| **Boundary**        | `tests/fixtures/relevance/baseline.json`                                                                                                                                                                                                               |
| **Direction**       | response (file as response)                                                                                                                                                                                                                            |
| **Input**           | Output of `--record`.                                                                                                                                                                                                                                  |
| **Expected Result** | `{ recorded_at: string (ISO-8601), overall_top3: number, by_category: Record<string, number>, ranking_config: object }`.                                                                                                                               |
| **Pass Criteria**   | All four keys present with the documented types. `overall_top3` and every `by_category` value in `[0,1]`. No extra top-level keys that later stories must special-case (additive-only is fine, but every field the replay test reads must be present). |

### CT-2: `candidates.json` carries the fields `rankResults` needs

| Field               | Value                                                                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC5, AC6                                                                                                                                                                                                                                       |
| **Contract type**   | provider-driven                                                                                                                                                                                                                                |
| **Boundary**        | `tests/fixtures/relevance/candidates.json`                                                                                                                                                                                                     |
| **Direction**       | response (file as response)                                                                                                                                                                                                                    |
| **Input**           | Output of `--record`.                                                                                                                                                                                                                          |
| **Expected Result** | Per query: candidate `id`, Qdrant `score`, and the payload fields the (pre-S1-02) identity ranking path reads — at minimum `source`, `timestamp_utc`.                                                                                          |
| **Pass Criteria**   | Every candidate entry has `id` and `score` as the correct types. Fields required by `rankResults`'s current identity-ordering implementation are present, so `replay.test.ts` can call the same function the command calls without adaptation. |

### CT-3: Fixture Zod schemas reject malformed entries and queries

| Field               | Value                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC1, AC2                                                                                                                                                                                      |
| **Contract type**   | consumer-driven                                                                                                                                                                               |
| **Boundary**        | `entries.json` / `queries.json` fixture schema                                                                                                                                                |
| **Direction**       | request (fixture as request into the script)                                                                                                                                                  |
| **Input**           | (a) an entry missing a required field; (b) a query without `expected_ids`; (c) a query with an unknown `category` value.                                                                      |
| **Expected Result** | Script fails loudly at load time — a typed validation error, not a silent skip or a downstream `undefined`.                                                                                   |
| **Pass Criteria**   | Non-zero exit with a message identifying the offending record. Directly required by the story's Unit Tests note ("fixture schema validation (Zod) rejecting a query without `expected_ids`"). |

### CT-4: `MEMO_COLLECTION` contract — set, unset, and empty

| Field               | Value                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC7                                                                                                                                                                                                       |
| **Contract type**   | consumer-driven                                                                                                                                                                                           |
| **Boundary**        | `MEMO_COLLECTION` environment contract                                                                                                                                                                    |
| **Direction**       | request                                                                                                                                                                                                   |
| **Input**           | (a) `MEMO_COLLECTION=memo_eval`; (b) unset; (c) `MEMO_COLLECTION=""`.                                                                                                                                     |
| **Expected Result** | (a) `QdrantRepository` targets `memo_eval`. (b) `QdrantRepository` targets `decisions` (documented default) for read-only paths; `--seed` additionally refuses per AC7/task 1.10. (c) See **F-3** / SC-9. |
| **Pass Criteria**   | Direct unit-level assertion on the resolved collection name for (a) and (b) via `tests/unit/lib/qdrant.test.ts` (task 1.2). (c) held to SC-9's pass criteria.                                             |

### CT-5: Replay test's offline contract — no credential dependency

| Field               | Value                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC6, AC9                                                                                                                              |
| **Contract type**   | provider-driven                                                                                                                       |
| **Boundary**        | `pnpm test` exit-code contract                                                                                                        |
| **Direction**       | response                                                                                                                              |
| **Input**           | `pnpm test` run in an environment with `QDRANT_URL` and `EMBEDDINGS_API_KEY` deliberately unset/invalid.                              |
| **Expected Result** | The full suite, including `replay.test.ts`, passes. This is the story's explicit AC9 clause and doubles as a CI-portability contract. |
| **Pass Criteria**   | Exit `0`. No test in `tests/relevance/` is skipped or marked pending due to missing credentials — it must genuinely run and pass.     |

---

## Edge-Case Catalog

Nine categories evaluated; three are declared `N/A` for this harness-only story with justification.

### 1. Input Domain

### EC-1: `age_days` resolution at seed time

| Field               | Value                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC1, AC4                                                                                                                                                                                                                                                                                                                                            |
| **Category**        | Input Domain, Timing                                                                                                                                                                                                                                                                                                                                |
| **Input / Setup**   | Fixture entries with `age_days` of `0`, `1`, `200`, `3650` (10 years), and a negative value (`-5`, i.e., "in the future" relative to seed time).                                                                                                                                                                                                    |
| **Expected Result** | Each resolves to a concrete `timestamp_utc` at seed time relative to `now`. A negative `age_days` either resolves to a future timestamp (and is accepted, since recency scoring rules belong to S1-02, not this story) or is rejected by the seed schema — either is acceptable as long as it is not silently clamped to `0` without documentation. |
| **Risk if Missed**  | If age resolution is computed once and hardcoded rather than resolved relative to `now` at each `--seed` run, the fixture "ages" and recency-sensitive queries (the `recency` category) silently drift stale, exactly the rot the story's Technical Notes call out as the reason for relative offsets.                                              |

### EC-2: Duplicate or malformed `expected_ids`

| Field               | Value                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC2, AC6                                                                                                                                                                                                                                                                                                                  |
| **Category**        | Input Domain                                                                                                                                                                                                                                                                                                              |
| **Input / Setup**   | A query with duplicate ids in `expected_ids` (e.g., `["a","a","b"]`); a query whose `expected_ids` references an id not present anywhere in `entries.json`.                                                                                                                                                               |
| **Expected Result** | Duplicate-id case: `computeTop3HitRate` treats the set as deduplicated (a "hit" counts once, not per duplicate copy). Dangling-reference case: fails loudly at fixture-validation time (per the story's edge-case matrix: "query whose expected entry was deleted from the fixture must fail loudly, not silently pass"). |
| **Risk if Missed**  | Duplicate ids could silently inflate an apparent hit rate; a dangling reference that is tolerated instead of failing loudly hides a fixture-authoring bug behind a plausible-looking score.                                                                                                                               |

### EC-3: Query with empty `expected_ids`

| Field               | Value                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC2, AC6                                                                                                                                                                              |
| **Category**        | Input Domain                                                                                                                                                                          |
| **Input / Setup**   | A query object with `expected_ids: []`.                                                                                                                                               |
| **Expected Result** | `computeTop3HitRate` handles this without divide-by-zero; the story's own Unit Tests note names this case explicitly ("query with empty `expected_ids`").                             |
| **Risk if Missed**  | A `0/0` division produces `NaN`, which then silently corrupts the overall/per-category aggregate hit rate (same class of failure as EC-3 in the issue-34 test plan for `Date.parse`). |

### 2. State Transitions

### EC-4: Collection state matrix across seed/run/record

| Field               | Value                                                                                                                                                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC3, AC4, AC7                                                                                                                                                                                                                                                                                                     |
| **Category**        | State Transitions                                                                                                                                                                                                                                                                                                 |
| **Input / Setup**   | States: `memo_eval` collection absent; present-and-empty; present-and-seeded; present-and-seeded-then-partially-deleted.                                                                                                                                                                                          |
| **Expected Result** | `--seed` creates the collection if absent (idempotent bootstrap, consistent with `ensureCollection`). Plain `run` against an absent/empty collection reports `0%` hit rates (per F-2) rather than crashing. `--record` after a partial delete records the actually-observed candidates, not a cached expectation. |
| **Risk if Missed**  | A first-time contributor running `eval:relevance` before `--seed` gets an unhandled exception instead of a clear "no data" report or a graceful `0%`.                                                                                                                                                             |

### 3. Timing & Concurrency

### EC-5: Two `--record` runs in quick succession

| Field               | Value                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC5                                                                                                                                                                                                    |
| **Category**        | Timing                                                                                                                                                                                                 |
| **Input / Setup**   | Run `--record` twice back-to-back against an unchanged seeded collection.                                                                                                                              |
| **Expected Result** | `recorded_at` differs between the two runs (fresh timestamp each time); `overall_top3` and `by_category` are stable (deterministic scoring against unchanged data and the pre-S1-02 identity ranking). |
| **Risk if Missed**  | Nondeterministic hit rates between two back-to-back recordings against unchanged data would indicate the harness itself is unstable, undermining every later story's regression gate.                  |

### 4. Idempotency

### EC-6: Re-seeding after a fixture-content edit (see F-1)

| Field               | Value                                                                                                                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC4                                                                                                                                                                                                                                                                                |
| **Category**        | Idempotency                                                                                                                                                                                                                                                                        |
| **Input / Setup**   | Seed once. Edit one fixture entry's `rationale` text (same `id`). Seed again.                                                                                                                                                                                                      |
| **Expected Result** | Documented, not necessarily prescribed by this story: record whichever behavior is observed (upsert-overwrite is the expected default given `id`-keyed `upsert`). Point count must not grow (no duplicate id).                                                                     |
| **Risk if Missed**  | If the observed behavior is "skip existing id," fixture edits silently fail to propagate into `memo_eval`, and every subsequent `--record` measures stale data without any signal that it happened. Flagged per **F-1** for `product-engineer` confirmation, not a hard fail here. |

### 5. Failure Modes

### EC-7: `MEMO_COLLECTION` unset for each of the three modes (see F-3)

| Field               | Value                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC7                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Category**        | Failure Modes                                                                                                                                                                                                                                                                                                                                                                                          |
| **Input / Setup**   | `MEMO_COLLECTION` unset for: (a) `--seed`; (b) plain `run`; (c) `--record`.                                                                                                                                                                                                                                                                                                                            |
| **Expected Result** | (a) refuses, exit `1` — firm gate per task 1.10. (b) and (c) are `undetermined`: they may either refuse the same way, or proceed read-only against `decisions` (least-surprise for a plain report run) — either satisfies "never **writes** into `decisions`" since (b)/(c) issue no writes when Qdrant already has data, but (c) is a closer call because it writes local _files_, not Qdrant points. |
| **Risk if Missed**  | If `--record` proceeds unset and reads from `decisions` (production data) instead of failing or targeting `memo_eval`, the committed `baseline.json`/`candidates.json` would reflect production data, not the fixture-controlled eval set — a correctness risk for every later story's regression gate.                                                                                                |

### EC-8: Qdrant or embeddings provider unreachable during `run`/`--record`

| Field               | Value                                                                                                                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC3                                                                                                                                                                                                                                                                                |
| **Category**        | Failure Modes                                                                                                                                                                                                                                                                      |
| **Input / Setup**   | `QDRANT_URL` pointed at an unreachable host; then a valid host but invalid `EMBEDDINGS_API_KEY`.                                                                                                                                                                                   |
| **Expected Result** | Per the story's edge-case matrix: exit `2`, typed `QDRANT_UNREACHABLE`. This is a documented exception to "always exits 0" — AC3's exit-0 guarantee is scoped to _scoring outcomes_, not to Qdrant connectivity failures, per the story's separately listed Edge-Case Matrix item. |
| **Risk if Missed**  | Conflating "exits 0 regardless of score" with "exits 0 regardless of everything" would swallow a genuine infrastructure failure as a `0%` hit-rate report, which is indistinguishable from a real regression (see **F-2**).                                                        |

### EC-9: Empty `candidates.json` fed to the replay test

| Field               | Value                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC6                                                                                                                                                                                           |
| **Category**        | Failure Modes                                                                                                                                                                                 |
| **Input / Setup**   | `candidates.json` replaced with `[]` (or `{}`), `baseline.json` left as recorded.                                                                                                             |
| **Expected Result** | Per the story's own edge-case matrix, this case is explicitly named. `replay.test.ts` must fail loudly (clear assertion failure), not silently report `0/0 = NaN ≥ baseline` as a false pass. |
| **Pass Criteria**   | Test run against this corrupted fixture fails with an intelligible error, not a passing green run and not an unhandled exception with no message.                                             |

### 6. Auth & Permissions

**N/A — no new auth surface.** The harness reuses the existing `QDRANT_URL`/`QDRANT_API_KEY`/embeddings-provider credential model unchanged; it introduces no new identity, permission, or credential type. The only new environment variable, `MEMO_COLLECTION`, is a collection-name selector, not a credential — verified not to appear in any error message as a secret (adjacent check folded into SC-8/EC-7's message-content assertions).

### 7. Data Boundaries

### EC-10: Fixture count boundaries

| Field               | Value                                                                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC1, AC2                                                                                                                                                                                                                      |
| **Category**        | Data Boundaries                                                                                                                                                                                                               |
| **Input / Setup**   | Exactly 40 entries (the AC1 floor); exactly 20 and exactly 30 queries (the AC2 bounds); 19 queries (just under) and 31 queries (just over), tested against the schema/count validator only, not against the shipped fixtures. |
| **Expected Result** | 40 entries passes; the shipped fixture must be `≥ 40`, never fewer. 20 and 30 queries both pass; 19 and 31 both fail the count validator (SC-2's validator).                                                                  |
| **Risk if Missed**  | An off-by-one in the count check (`> 20` instead of `≥ 20`) would silently accept an undersized query set that fails to exercise all four categories meaningfully.                                                            |

### EC-11: `overall_top3` at its numeric boundaries

| Field               | Value                                                                                                                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC5, AC6                                                                                                                                                                                                                                            |
| **Category**        | Data Boundaries                                                                                                                                                                                                                                     |
| **Input / Setup**   | Synthetic `candidates.json` engineered to produce hit rates of exactly `0`, exactly `1`, and a fractional value (e.g., `7/23`).                                                                                                                     |
| **Expected Result** | `computeTop3HitRate` returns exact, finite values in all three cases; the replay test's `≥` comparison behaves correctly at the `0` and `1` boundaries (e.g., baseline `0` is trivially satisfied by any run; baseline `1` requires a perfect run). |
| **Risk if Missed**  | A rounding or floating-point-comparison bug at the `1.0` boundary could make a perfect replay run spuriously fail the `≥ baseline` check.                                                                                                           |

### 8. Resource Exhaustion

**N/A for this story's scope.** The harness caps itself at ≤ 30 queries and ≥ 40/no-stated-ceiling entries; there is no unbounded user-supplied input analogous to issue #34's `--limit` flag. The only resource-adjacent concern — an unbounded `entries.json` grown over time — is a fixture-governance concern (flagged in Recommendations), not a runtime resource-exhaustion vector, since the fixture is authored and reviewed, not attacker-controlled.

### 9. API Versioning

### EC-12: `baseline.json`/`candidates.json` shape must survive S1-02's arrival

| Field               | Value                                                                                                                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC6                                                                                                                                                                                                                                                                                     |
| **Category**        | API Versioning                                                                                                                                                                                                                                                                          |
| **Input / Setup**   | The replay test calls the same `rankResults` the command calls (per the story's Technical Notes). Simulate S1-02 landing by substituting a stub `rankResults` that adds new score fields (`recency_score`, `source_score`) without removing the identity ordering behavior it replaces. |
| **Expected Result** | `replay.test.ts` continues to type-check and run without modification to `candidates.json`'s recorded fields, because S1-02 only _adds_ fields consumed by ranking — it must not require a field this story's `--record` did not capture.                                               |
| **Risk if Missed**  | If `candidates.json` under-captures payload fields (e.g., omits `source` or `timestamp_utc`), S1-02's composite ranking cannot be replayed against this baseline at all, forcing a `--record` re-run and invalidating the very floor this story exists to establish.                    |

---

## Randomized Tactics and Seed Policy

Seed format: `<tactic-type>-<AC-id>-<unix-timestamp>-<4-hex>`
Replay: `pnpm test -- --testPathPattern="eval" --seed=<captured-seed>`

Seeds **MUST** be recorded in the run log and in any failure report. On failure, follow the `verifier` Failure Triage Workflow (capture → replay → minimize → classify → report), with a maximum of 3 reproduction attempts before marking `inconclusive`.

### RT-1: Property — `computeTop3HitRate` is bounded and monotonic in hit count

| Field                  | Value                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**              | AC6                                                                                                                                                                                                                                                                            |
| **Tactic type**        | property-based                                                                                                                                                                                                                                                                 |
| **Input surface**      | Random arrays of `{ query, expected_ids, top3_candidate_ids }` with random overlap sizes 0..3, random query counts 1..30, random duplicate ids within a single query's `expected_ids`.                                                                                         |
| **Property / Oracle**  | `0 ≤ hit_rate ≤ 1` for overall and every category. Adding a query that is a strict subset-hit of an existing query's top-3 never decreases the overall rate more than that single query's weight. Deduplicating `expected_ids` never changes the computed rate for that query. |
| **Iterations**         | 500                                                                                                                                                                                                                                                                            |
| **Seed**               | `prop-AC6-{timestamp}-{hex}`                                                                                                                                                                                                                                                   |
| **Replay instruction** | `pnpm test -- --testPathPattern="eval" --seed=<seed> --iterations=1`                                                                                                                                                                                                           |
| **Shrink strategy**    | Reduce the query array to the smallest set that still violates the bound; then reduce `expected_ids` length within that query.                                                                                                                                                 |

### RT-2: Fuzz — fixture schema rejects malformed records without crashing the process

| Field                  | Value                                                                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**              | AC1, AC2                                                                                                                                                                                                                                                                 |
| **Tactic type**        | fuzz                                                                                                                                                                                                                                                                     |
| **Input surface**      | Randomly mutated copies of one valid entry and one valid query: dropped required keys, wrong types (`age_days` as a string, `category` as a number), extra deeply-nested objects, `expected_ids` as a string instead of an array, `null`/`undefined` in place of arrays. |
| **Property / Oracle**  | Every mutation either validates successfully (if it happens to remain schema-valid) or is rejected with a typed, catchable Zod error — never an unhandled exception, never a silent pass-through of malformed data into scoring.                                         |
| **Iterations**         | 400                                                                                                                                                                                                                                                                      |
| **Seed**               | `fuzz-AC1-{timestamp}-{hex}`                                                                                                                                                                                                                                             |
| **Replay instruction** | `pnpm test -- --testPathPattern="eval" --seed=<seed> --iterations=1`                                                                                                                                                                                                     |
| **Shrink strategy**    | Remove/mutate one field at a time from the failing record until the minimal offending field is isolated.                                                                                                                                                                 |

---

## Execution Checklist

Pre-implementation (test-first — these should fail before code exists):

- [ ] Scaffold `tests/unit/lib/eval.test.ts` with EC-2, EC-3, EC-11 as failing tests (`computeTop3HitRate`).
- [ ] Scaffold `tests/unit/lib/qdrant.test.ts` collection-name cases (CT-4 / task 1.2) as failing tests.
- [ ] Add RT-1 property harness with seed capture wired in before `computeTop3HitRate` is implemented.

During implementation:

- [ ] SC-1 … SC-10 pass.
- [ ] CT-1 … CT-5 pass.
- [ ] EC-1 … EC-12 pass, with EC-6/EC-7's `undetermined` branches recorded as evidence (not blocking) per F-1/F-3.
- [ ] RT-1 … RT-2 executed; seeds recorded in the run log.

Quality gates (AC8 documentation + AC9 process criterion):

- [ ] `pnpm test` — full suite green, including `tests/relevance/replay.test.ts`, with `QDRANT_URL`/`EMBEDDINGS_API_KEY` unset in the test run (SC-7/CT-5).
- [ ] `pnpm test -- --testPathPattern="relevance|eval"` — targeted green.
- [ ] `pnpm run lint`, `pnpm run format:check`, `pnpm run typecheck`, `pnpm audit` (per AGENTS.md quality-gate list; not separately enumerated as an S1-01 AC but required by the general workflow gate before PR-ready).
- [ ] Manual: `MEMO_COLLECTION=memo_eval pnpm run eval:relevance --seed && pnpm run eval:relevance` against local Docker Qdrant; `memo inspect` before/after confirms `decisions` untouched (SC-4).
- [ ] `docs/requirements/prd-004-long-lived-agent-memory.md` changelog updated with the recorded baseline (SC-10 / AC8).
- [ ] `README.md` Development section documents the eval workflow and `MEMO_COLLECTION` (per the story's Implementation Steps item 7).

Negative-space checks (non-goals stay untouched):

- [ ] No change to `src/commands/search.ts` ranking behavior — `rankResults` remains identity-by-`similarity`.
- [ ] No `ranking` config block introduced (belongs to S1-02).
- [ ] `decisions` collection point count unchanged by any `eval:relevance` invocation, in any mode, at any point in the checklist.
- [ ] Existing `memo search`/`memo list`/`memo read` test suites unaffected.

---

## Recommendations

| #   | Finding                                                                                                     | Owner              | Recommended action                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **F-1** — AC4 "idempotent" does not specify overwrite-vs-skip semantics on re-seed with changed content     | `product-engineer` | Confirm upsert-overwrite is the intended behavior (consistent with `QdrantRepository.upsert`'s existing id-keyed semantics) and state it explicitly in the story.                              |
| 2   | **F-2** — AC3's "exits 0 regardless of score" could mask a broken harness at the exit-code level            | `developer`        | Ensure stdout always prints numeric hit-rate figures (never omitted) so downstream tooling/humans can distinguish "harness broken" from "harness reports low relevance." Covered by SC-3/EC-8. |
| 3   | **F-3** — `MEMO_COLLECTION` unset behavior for plain `run` and `--record` is unspecified beyond `--seed`    | `product-engineer` | Decide whether plain `run`/`--record` should also refuse when unset, or explicitly document the read-against-`decisions` fallback as intentional. Blocks a firm verdict on EC-7(b)/(c).        |
| 4   | Fixture governance — `entries.json` has a floor (`≥ 40`) but no stated ceiling as later stories add entries | `product-engineer` | Consider whether an upper bound should be documented to bound eval-script runtime as the fixture grows across Phase 1 stories.                                                                 |

---

## Output Contract

| Field                  | Value                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Mode**               | Design                                                                                                                                   |
| **Phase**              | 4 — Reporting & Publication (complete)                                                                                                   |
| **Source artifact**    | `workstream/user-stories-prd-004-phase-1.md` (Story S1-01)                                                                               |
| **Artifacts produced** | `workstream/test-plan-issue-61.md`, `workstream/traceability-matrix-issue-61.md`                                                         |
| **GitHub issue**       | [#61](https://github.com/llipe/memo-cli/issues/61)                                                                                       |
| **AC coverage**        | 9/9 addressed. AC1…AC7, AC9 covered by scenarios; AC8 covered by the Execution Checklist as a documentation/process criterion.           |
| **Scenario counts**    | 10 E2E, 5 contract, 12 edge-case, 2 randomized                                                                                           |
| **Blocking gaps**      | None for design. Two items require `product-engineer` clarification before a firm pass/fail verdict: **F-1/EC-6** and **F-3/EC-7(b,c)**. |
