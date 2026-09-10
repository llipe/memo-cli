# Compliance Test Plan — Issue #34: Composite Ranking Score for Search Results

> Produced by **`verifier`** (Design Mode) on 2026-08-25. Pre-implementation. Black-box: all assertions derive from observable CLI behavior, not internal code structure.

## Changelog

| Version | Date       | Summary           | Author   |
| ------- | ---------- | ----------------- | -------- |
| 1.0     | 2026-08-25 | Initial test plan | verifier |

## Source Input Summary

| Field               | Value                                                       |
| ------------------- | ----------------------------------------------------------- |
| **Repository**      | `llipe/memo-cli`                                            |
| **GitHub Issue**    | [#34](https://github.com/llipe/memo-cli/issues/34)          |
| **Input type**      | `story`                                                     |
| **Source artifact** | `workstream/issue-34-composite-ranking-score-refinement.md` |
| **Task list**       | `workstream/tasks-issue-34-composite-ranking-score.md`      |
| **ACs extracted**   | 18 (AC-1 … AC-18)                                           |
| **Traceability**    | `workstream/traceability-matrix-issue-34.md`                |

Observable surfaces available to black-box testing:

1. `memo search` — stdout (human), stdout (`--json`), stderr, exit code.
2. `memo setup validate` — stdout, stderr, exit code.
3. `memo.config.json` — the input contract the CLI consumes.

---

## Pre-Implementation Findings

Design-time analysis surfaced three issues that affect how the ACs must be tested. All are reported, not fixed — remediation belongs to `developer`, and the scope question in F-1 belongs to `product-engineer`.

### F-1 — Over-fetch is unbounded above (Major, design concern)

The refinement's D2 formula `max(limit, min(limit * 3, 50))` has no upper bound, because the outer `max` defeats the cap whenever `limit > 50`. Verified:

```
limit = 1_000_000  ->  over-fetch = 1_000_000
```

The `min(…, 50)` cap only constrains `limit ≤ 16`. For `limit > 50` the formula degenerates to `limit`, so `memo search --limit 1000000` issues a one-million-point Qdrant query and ranks the entire result set in memory. The issue body's stated intent ("capped at 50") is not achieved for large limits.

This is a genuine tension in the requirement, not an implementation slip: D2's outer `max` exists to prevent _under_-fetching (AC-14 demands `--limit 100` query exactly `100`), and that directly conflicts with a hard 50-cap. AC-14 and a bounded over-fetch cannot both hold as written.

Covered by **EC-18** and **RT-5**. Escalated to `product-engineer` — see Recommendations.

### F-2 — The default weights do not sum to 1.0 in IEEE-754 (Critical if mishandled)

```
0.6 + 0.3 + 0.1 === 1.0   ->  false
0.6 + 0.3 + 0.1            ->  0.9999999999999999
```

A strict `=== 1.0` weight-sum check would **reject the shipped default configuration**. The ±0.001 tolerance in AC-9 is therefore load-bearing, not a nicety. This makes **EC-11** a required test, not an optional one: the defaults must be proven to pass their own validator.

### F-3 — `Date.parse` accepts partial date strings (Minor)

```
Date.parse('2026')        ->  1767225600000   (valid!)
Date.parse('')            ->  NaN
Date.parse('not-a-date')  ->  NaN
```

A `timestamp_utc` of `"2026"` is not the ISO-8601 datetime the schema specifies, yet it parses to a real instant and yields a plausible recency score instead of the `0` fallback that D4 prescribes for unparseable values. The malformed-timestamp guard must be tested with `"2026"` specifically, not only with obvious garbage. Covered by **EC-3**.

---

## Acceptance Criteria Extraction

| ID    | Criterion (condensed)                                                                   | Source AC |
| ----- | --------------------------------------------------------------------------------------- | --------- |
| AC-1  | Results ordered by `final_score` descending, not raw `similarity`                       | AC1       |
| AC-2  | (`0.90`, 180d) ranks below (`0.82`, 5d) under defaults — `0.7150` vs `0.8807`           | AC2       |
| AC-3  | `agent` scores exactly `0.05` above `scan` at equal similarity and recency              | AC3       |
| AC-4  | `final_score` always within `[0,1]`, including negative input similarity                | AC4       |
| AC-5  | `--json` results carry `final_score`, `similarity`, `recency_score`, `source_score`     | AC5       |
| AC-6  | Human output shows `final_score` as the percentage, existing position                   | AC6       |
| AC-7  | Envelope keys `query`/`filters`/`results`/`count`/`message` unchanged                   | AC7       |
| AC-8  | Valid `ranking` block passes `memo setup validate`, exit `0`                            | AC8       |
| AC-9  | Weights not summing to `1.0` ±0.001 fail validate, exit `1`, message names path + sum   | AC9       |
| AC-10 | Absent `ranking` block uses defaults `0.6/0.3/0.1/90`, no warning or error              | AC10      |
| AC-11 | Partial `ranking` block rejected by weight-sum, not silently merged with defaults       | AC11      |
| AC-12 | `memo search` with invalid weights fails `CONFIG_INVALID`, exit `1`, no silent fallback | AC12      |
| AC-13 | Qdrant queried with `max(limit, min(limit*3, 50))`; output sliced to `--limit`          | AC13      |
| AC-14 | `--limit 100` queries Qdrant with `100`, never `50`                                     | AC14      |
| AC-15 | Existing search tests pass; changes limited to over-fetch + ordering assertions         | AC15      |
| AC-16 | Unit tests cover all four scoring functions across the enumerated cases                 | AC16      |
| AC-17 | Coverage ≥ 80% global; `src/lib/` ≥ 85% guideline target                                | AC17      |
| AC-18 | `lint`, `format:check`, `typecheck`, `test`, `audit` all pass                           | AC18      |

**Non-goals** (must remain untouched — negative-space assertions): confidence tiers (#35), tag boosting (#36), staleness (#38), `memo ask` (#37), `memo list` ordering, Qdrant-native scoring, payload `confidence` as a ranking signal.

**Coverage note:** AC-15 through AC-18 are process/meta criteria verified by command execution rather than behavioral scenarios. They are covered in the Execution Checklist and traceability matrix, not by SC/EC scenarios. This is flagged per the skill's requirement to declare ACs not coverable by E2E scenarios.

---

## E2E Black-Box Scenarios

### SC-1: Composite ordering overrides raw similarity

| Field               | Value                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-1, AC-2                                                                                                                                                            |
| **Type**            | happy-path                                                                                                                                                            |
| **Severity**        | critical                                                                                                                                                              |
| **Preconditions**   | Store holds entry A (`similarity≈0.90`, `timestamp_utc` = now−180d, `source: agent`) and entry B (`≈0.82`, now−5d, `agent`). No `ranking` block in config.            |
| **Steps**           | 1. Run `memo search "<query matching both>" --limit 5 --json`.                                                                                                        |
| **Expected Result** | B precedes A in `results`. B `final_score` ≈ `0.8807`; A ≈ `0.7150`. A's `similarity` remains the higher of the two.                                                  |
| **Pass Criteria**   | `results[0].id == B`. `results[0].final_score > results[1].final_score`. `results[1].similarity > results[0].similarity` — proving ordering is not similarity-driven. |

### SC-2: Source reliability breaks a similarity tie

| Field               | Value                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-3                                                                                                                      |
| **Type**            | happy-path                                                                                                                |
| **Severity**        | major                                                                                                                     |
| **Preconditions**   | Two entries with effectively identical similarity and identical `timestamp_utc`; one `source: agent`, one `source: scan`. |
| **Steps**           | 1. Run `memo search "<query>" --limit 5 --json`.                                                                          |
| **Expected Result** | The `agent` entry precedes the `scan` entry; `final_score` delta is `0.05`.                                               |
| **Pass Criteria**   | `agent.final_score - scan.final_score` within `1e-9` of `0.05`. `agent.source_score == 1.0`, `scan.source_score == 0.5`.  |

### SC-3: Human output renders the composite percentage

| Field               | Value                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-6                                                                                                                                                                  |
| **Type**            | happy-path                                                                                                                                                            |
| **Severity**        | major                                                                                                                                                                 |
| **Preconditions**   | An entry whose `final_score` differs measurably from its `similarity` (e.g. old entry: `sim 0.91` → `final 0.72`).                                                    |
| **Steps**           | 1. Run `memo search "<query>" --limit 1` (no `--json`).                                                                                                               |
| **Expected Result** | The percentage shown is the rounded `final_score` (`72%`), not the rounded `similarity` (`91%`). Layout — repo label, then score, then rationale lead — is unchanged. |
| **Pass Criteria**   | stdout contains `72%` and does not contain `91%`. Field order matches the pre-change layout.                                                                          |

### SC-4: JSON contract exposes all four score components

| Field               | Value                                                                                                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-5, AC-7                                                                                                                                                                                                                                                       |
| **Type**            | happy-path                                                                                                                                                                                                                                                       |
| **Severity**        | critical                                                                                                                                                                                                                                                         |
| **Preconditions**   | At least one matching entry.                                                                                                                                                                                                                                     |
| **Steps**           | 1. Run `memo search "<query>" --limit 3 --json`. 2. Parse stdout as JSON.                                                                                                                                                                                        |
| **Expected Result** | Envelope has `query`, `filters`, `results`, `count`. Each result carries `final_score`, `similarity`, `recency_score`, `source_score`, plus every original payload field (`id`, `repo`, `org`, `rationale`, `tags`, `entry_type`, `source`, `timestamp_utc`, …). |
| **Pass Criteria**   | All four score fields present and numeric on every result. No pre-existing envelope or payload key removed or renamed. `count == results.length`.                                                                                                                |

### SC-5: Default configuration requires no `ranking` block

| Field               | Value                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-10                                                                                          |
| **Type**            | happy-path                                                                                     |
| **Severity**        | critical                                                                                       |
| **Preconditions**   | `memo.config.json` is a valid v1 config with **no** `ranking` key (the current shipped shape). |
| **Steps**           | 1. Run `memo setup validate`. 2. Run `memo search "<query>" --limit 3 --json`.                 |
| **Expected Result** | Validate exits `0` with no warning. Search succeeds and applies `0.6/0.3/0.1/90`.              |
| **Pass Criteria**   | Both exit `0`. stderr empty of warnings. Scores consistent with default weights.               |

### SC-6: Invalid weight sum rejected by validate

| Field               | Value                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-9                                                                                         |
| **Type**            | negative-path                                                                                |
| **Severity**        | critical                                                                                     |
| **Preconditions**   | Config with `ranking: { w_similarity: 0.5, w_recency: 0.3, w_source: 0.1 }` (sums to `0.9`). |
| **Steps**           | 1. Run `memo setup validate`; capture stdout, stderr, exit code.                             |
| **Expected Result** | Exit `1`. stderr identifies the `ranking` path and states the actual sum (`0.9`).            |
| **Pass Criteria**   | Exit code `1`. stderr matches `/ranking/` and contains `0.9`. No credential values echoed.   |

### SC-7: `memo search` fails fast on invalid weights

| Field               | Value                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-12                                                                                                      |
| **Type**            | negative-path                                                                                              |
| **Severity**        | critical                                                                                                   |
| **Preconditions**   | Config with weights summing to `1.1`.                                                                      |
| **Steps**           | 1. Run `memo search "<query>" --json`.                                                                     |
| **Expected Result** | Command fails with `CONFIG_INVALID`, exit `1`. **No results returned**, no silent fallback to defaults.    |
| **Pass Criteria**   | Exit `1`. `--json` stderr is `{"error": …, "code": "CONFIG_INVALID"}`. stdout contains no `results` array. |

### SC-8: Partial `ranking` block is rejected

| Field               | Value                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-11                                                                                                     |
| **Type**            | negative-path                                                                                             |
| **Severity**        | major                                                                                                     |
| **Preconditions**   | Config with `ranking: { w_similarity: 0.5 }` only.                                                        |
| **Steps**           | 1. Run `memo setup validate`.                                                                             |
| **Expected Result** | Exit `1`. The partial override is not silently merged with defaults (which would give `0.5+0.3+0.1=0.9`). |
| **Pass Criteria**   | Exit `1` with a weight-sum error naming the `ranking` path.                                               |

### SC-9: Over-fetch and slicing at small limit

| Field               | Value                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-13                                                                                                    |
| **Type**            | happy-path                                                                                               |
| **Severity**        | major                                                                                                    |
| **Preconditions**   | Store holds ≥ 20 matching entries.                                                                       |
| **Steps**           | 1. Run `memo search "<query>" --limit 3 --json`.                                                         |
| **Expected Result** | Exactly 3 results returned, selected as the top 3 by `final_score` from a 9-candidate pool.              |
| **Pass Criteria**   | `results.length == 3`. `count == 3`. Results are the 3 highest `final_score` values among the 9 fetched. |

### SC-10: Large limit is not silently truncated to the cap

| Field               | Value                                              |
| ------------------- | -------------------------------------------------- |
| **AC(s)**           | AC-14                                              |
| **Type**            | negative-path (boundary)                           |
| **Severity**        | major                                              |
| **Preconditions**   | Store holds ≥ 100 matching entries.                |
| **Steps**           | 1. Run `memo search "<query>" --limit 100 --json`. |
| **Expected Result** | 100 results returned — not 50.                     |
| **Pass Criteria**   | `results.length == 100`.                           |

### SC-11: Empty result set still renders the guidance message

| Field               | Value                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-1, AC-7                                                                                                                                                             |
| **Type**            | negative-path                                                                                                                                                          |
| **Severity**        | major                                                                                                                                                                  |
| **Preconditions**   | A query/filter combination matching nothing.                                                                                                                           |
| **Steps**           | 1. Run `memo search "<no-match>"`. 2. Re-run with `--json`.                                                                                                            |
| **Expected Result** | Human mode prints the existing empty-state text and the broaden-query tip. JSON mode returns `results: []`, `count: 0`, and the `message` key.                         |
| **Pass Criteria**   | Exit `0` both times. Human stdout contains `No results found.` and `tip:`. JSON has `count == 0` and `message` present. Ranking introduces no crash on the empty path. |

### SC-12: Injection-style query string is handled inertly

| Field               | Value                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-1, AC-5                                                                                                                                            |
| **Type**            | abuse-case                                                                                                                                            |
| **Severity**        | major                                                                                                                                                 |
| **Preconditions**   | Store populated.                                                                                                                                      |
| **Steps**           | 1. Run `memo search '"; rm -rf /; echo "' --limit 3 --json`. 2. Run with a query containing `{{7*7}}`, `../../etc/passwd`, and a 10 KB string.        |
| **Expected Result** | Query is treated purely as embedding text. No shell execution, no path traversal, no template evaluation. Ranking proceeds normally or returns empty. |
| **Pass Criteria**   | Exit `0` or a typed `MemoError`; never an unhandled stack trace. No filesystem side effects. `49` does not appear as evaluated output.                |

### SC-13: Malicious `ranking` values in config are rejected, not executed

| Field               | Value                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-9, AC-12                                                                                                                                                          |
| **Type**            | abuse-case                                                                                                                                                           |
| **Severity**        | major                                                                                                                                                                |
| **Preconditions**   | Config where `ranking` values are hostile types: `w_similarity: "0.6"` (string), `w_recency: null`, `recency_half_life_days: "1e999"`, and a nested `__proto__` key. |
| **Steps**           | 1. Run `memo setup validate`. 2. Run `memo search "<query>" --json`.                                                                                                 |
| **Expected Result** | Zod rejects with a typed `CONFIG_INVALID`. No prototype pollution. No `Infinity`/`NaN` propagating into scores.                                                      |
| **Pass Criteria**   | Exit `1` both times. `Object.prototype` unpolluted. No unhandled exception.                                                                                          |

---

## Contract Validation Scenarios

Contracts under test:

| Boundary                    | Type            | Consumer   | Provider       |
| --------------------------- | --------------- | ---------- | -------------- |
| `memo search --json` stdout | provider-driven | AI agents  | CLI            |
| `memo.config.json`          | consumer-driven | CLI        | user / `setup` |
| Exit codes `0`/`1`/`2`      | provider-driven | agents, CI | CLI            |
| Qdrant stored payload       | schema-compat   | CLI reader | prior writes   |

### CT-1: Search JSON response satisfies the agent contract

| Field               | Value                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-5, AC-7                                                                                                                                      |
| **Contract type**   | provider-driven                                                                                                                                 |
| **Boundary**        | `memo search --json` stdout                                                                                                                     |
| **Direction**       | response                                                                                                                                        |
| **Input**           | `memo search "auth" --limit 2 --json`                                                                                                           |
| **Expected Result** | `{ query: string, filters: object, results: Array, count: number }`; each result has the four score fields as `number` plus all payload fields. |
| **Pass Criteria**   | Parses as JSON. No ANSI escape codes. All four score fields `typeof === 'number'` and finite. Schema validates against the documented shape.    |

### CT-2: Backward compatibility — `similarity` is retained

| Field               | Value                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-5                                                                                                                                            |
| **Contract type**   | schema-compat                                                                                                                                   |
| **Boundary**        | `memo search --json` stdout                                                                                                                     |
| **Direction**       | response                                                                                                                                        |
| **Input**           | Any successful search.                                                                                                                          |
| **Expected Result** | `similarity` still present with its original meaning (raw cosine score), so a pre-change consumer reading `similarity` does not break.          |
| **Pass Criteria**   | `similarity` present on every result. Its value is the raw Qdrant score, **not** a copy of `final_score` (assert they differ when recency ≠ 1). |

### CT-3: Envelope keys are additive-only

| Field               | Value                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-7                                                                                                                                                        |
| **Contract type**   | schema-compat                                                                                                                                               |
| **Boundary**        | `memo search --json` stdout                                                                                                                                 |
| **Direction**       | response                                                                                                                                                    |
| **Input**           | Searches with and without filters, empty and non-empty.                                                                                                     |
| **Expected Result** | No pre-existing key removed, renamed, or retyped. `message` still appears only on the empty path.                                                           |
| **Pass Criteria**   | Key-set diff against the pre-change contract is additive-only. `filters` retains `scope`/`repo`/`limit` and conditional `org`/`tags`/`entry_type`/`source`. |

### CT-4: Config accepts a fully specified valid `ranking` block

| Field               | Value                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-8                                                                                                  |
| **Contract type**   | consumer-driven                                                                                       |
| **Boundary**        | `memo.config.json`                                                                                    |
| **Direction**       | request                                                                                               |
| **Input**           | `"ranking": { "w_similarity": 0.5, "w_recency": 0.4, "w_source": 0.1, "recency_half_life_days": 30 }` |
| **Expected Result** | Accepted. `memo setup show` reflects the values verbatim.                                             |
| **Pass Criteria**   | `validate` exits `0`. `show --json` echoes the four values unchanged.                                 |

### CT-5: Missing `ranking` sub-fields fall back to defaults

| Field               | Value                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC-10, AC-11                                                                                                                                                       |
| **Contract type**   | consumer-driven                                                                                                                                                    |
| **Boundary**        | `memo.config.json`                                                                                                                                                 |
| **Direction**       | request                                                                                                                                                            |
| **Input**           | (a) no `ranking` key; (b) `"ranking": {}`; (c) `"ranking": { "recency_half_life_days": 30 }`                                                                       |
| **Expected Result** | (a) and (b) resolve all four defaults and pass. (c) resolves the three weight defaults, keeps `30`, and passes — because the untouched weights still sum to `1.0`. |
| **Pass Criteria**   | All three exit `0`. Distinguish this from AC-11: a partial block is rejected **only** when its resolved weights fail the sum check, not merely for being partial.  |

> **Requirement ambiguity flagged.** AC-11 says a partial block "is rejected by weight-sum validation rather than silently mixing a partial override with defaults." CT-5(c) is a partial block whose resolved weights _do_ sum to `1.0`. Two readings exist: (i) reject any partial weight override outright, or (ii) apply defaults then validate the sum — under which (c) legitimately passes and only a partial block that breaks the sum fails. This plan tests reading (ii) as the more coherent one, consistent with AC-10's default-resolution behavior. **`product-engineer` must confirm.** Until confirmed, CT-5(c) is `undetermined`, not `fail`.

### CT-6: Type mismatch in `ranking` is rejected

| Field               | Value                                                                           |
| ------------------- | ------------------------------------------------------------------------------- |
| **AC(s)**           | AC-9                                                                            |
| **Contract type**   | consumer-driven                                                                 |
| **Boundary**        | `memo.config.json`                                                              |
| **Direction**       | request                                                                         |
| **Input**           | `"ranking": { "w_similarity": "0.6", "w_recency": 0.3, "w_source": 0.1 }`       |
| **Expected Result** | Rejected — string where number expected. No coercion.                           |
| **Pass Criteria**   | `validate` exits `1`. Error names `ranking.w_similarity` and the expected type. |

### CT-7: Unknown keys inside `ranking` follow the passthrough policy

| Field               | Value                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-10                                                                                                                                                                                                                     |
| **Contract type**   | schema-compat                                                                                                                                                                                                             |
| **Boundary**        | `memo.config.json`                                                                                                                                                                                                        |
| **Direction**       | request                                                                                                                                                                                                                   |
| **Input**           | `"ranking": { …valid weights…, "w_future_signal": 0.5 }`                                                                                                                                                                  |
| **Expected Result** | Behavior matches the documented schema-evolution policy — "readers must ignore unknown fields and preserve them during pass-through." Unknown key accepted and ignored; it must **not** enter the weight-sum computation. |
| **Pass Criteria**   | `validate` exits `0`. Scores identical to the same config without the extra key. `setup show` preserves the field.                                                                                                        |

### CT-8: Forward compatibility — `schema_version` unchanged

| Field               | Value                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC-10                                                                                                        |
| **Contract type**   | schema-compat                                                                                                |
| **Boundary**        | `memo.config.json`                                                                                           |
| **Direction**       | request                                                                                                      |
| **Input**           | An untouched pre-change v1 config (`schema_version: "1"`, no `ranking`).                                     |
| **Expected Result** | Loads and runs. Adding `ranking` does **not** require a `schema_version` bump, per the additive-only policy. |
| **Pass Criteria**   | `validate` exits `0`. `schema_version` remains `"1"`. No migration prompt.                                   |

### CT-9: Stored payload missing `timestamp_utc` is tolerated

| Field               | Value                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC-4                                                                                       |
| **Contract type**   | schema-compat                                                                              |
| **Boundary**        | Qdrant stored payload → CLI reader                                                         |
| **Direction**       | event-payload                                                                              |
| **Input**           | A point whose payload omits `timestamp_utc`.                                               |
| **Expected Result** | `recency_score` is `0`; the entry is still returned and ranked. No crash, no exclusion.    |
| **Pass Criteria**   | Entry present in `results` with `recency_score == 0` and a finite `final_score`. Exit `0`. |

### CT-10: Exit-code contract is preserved

| Field               | Value                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC-9, AC-12                                                                                      |
| **Contract type**   | provider-driven                                                                                  |
| **Boundary**        | Process exit codes                                                                               |
| **Direction**       | response                                                                                         |
| **Input**           | Success; invalid weights; Qdrant unreachable.                                                    |
| **Expected Result** | `0` success; `1` for `CONFIG_INVALID` (user error); `2` for `QDRANT_UNREACHABLE` (system error). |
| **Pass Criteria**   | Exit codes match the documented catalog. Ranking config errors are class `1`, never `2`.         |

---

## Edge-Case Catalog

All nine categories evaluated.

### 1. Input Domain

### EC-1: `timestamp_utc` at the recency boundary set

| Field               | Value                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-2, AC-4                                                                                                          |
| **Category**        | Input Domain, Data Boundaries                                                                                       |
| **Input / Setup**   | Ages of `0`, `45`, `90`, `180`, `270`, `360` days with `half_life = 90`.                                            |
| **Expected Result** | `1.0`, `≈0.7071`, `≈0.5`, `≈0.25`, `≈0.125`, `≈0.0625`.                                                             |
| **Risk if Missed**  | A wrong decay constant silently skews every ranking; the `0.5`-at-half-life contract is the feature's core promise. |

### EC-2: `timestamp_utc` in the future

| Field               | Value                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC-4                                                                                                                           |
| **Category**        | Input Domain, Timing                                                                                                           |
| **Input / Setup**   | Entry dated 30 days ahead (clock skew between writer and reader).                                                              |
| **Expected Result** | `recency_score` clamps to `1.0`; `final_score` stays ≤ `1.0`.                                                                  |
| **Risk if Missed**  | Unclamped negative age yields `recency_score > 1`, breaking the `[0,1]` bound and letting a skewed entry dominate permanently. |

### EC-3: Partially valid `timestamp_utc` strings

| Field               | Value                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-4                                                                                                                                                                         |
| **Category**        | Input Domain                                                                                                                                                                 |
| **Input / Setup**   | `""`, `"not-a-date"`, `"2026"`, `"2026-13-45T99:99:99Z"`, `null`, `12345` (number), a nested object.                                                                         |
| **Expected Result** | Unparseable values → `recency_score = 0`. Per **F-3**, `"2026"` parses successfully in JS and is the trap case — behavior must be deliberate and documented, not accidental. |
| **Risk if Missed**  | `NaN` propagates into `final_score`, and `NaN` comparisons silently corrupt sort order across the whole result set.                                                          |

### EC-4: Unknown, missing, and hostile `source` values

| Field               | Value                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-3                                                                                                                        |
| **Category**        | Input Domain, API Versioning                                                                                                |
| **Input / Setup**   | `source` of `agent`/`manual`/`scan`, plus `"AGENT"` (wrong case), `"future-source"`, absent, `null`, `42`.                  |
| **Expected Result** | Known values map to `1.0`/`0.8`/`0.5`. Everything else → `0.5`. Never throws.                                               |
| **Risk if Missed**  | A future `source` value crashes search for the whole store, or an uppercase variant silently scores `0.5` instead of `1.0`. |

### EC-5: `--limit` boundary and invalid values

| Field               | Value                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC-13, AC-14                                                                                                                         |
| **Category**        | Input Domain, Data Boundaries                                                                                                        |
| **Input / Setup**   | `--limit` of `1`, `16`, `17`, `50`, `51`, `100`, and invalid `0`, `-1`, `1.5`, `abc`, `""`.                                          |
| **Expected Result** | Valid: over-fetch `= max(limit, min(limit*3, 50))` → `3`, `48`, `50`, `50`, `51`, `100`. Invalid: `VALIDATION_FAILED`, exit `1`.     |
| **Risk if Missed**  | The `16→17` transition is where the cap starts binding and the formula changes character; an off-by-one here silently under-fetches. |

### 2. State Transitions

### EC-6: Config-resolution state matrix

| Field               | Value                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-10, AC-11, AC-12                                                                                                                          |
| **Category**        | State Transitions                                                                                                                            |
| **Input / Setup**   | Config states: absent file, present-without-`ranking`, present-with-empty-`ranking`, partial, complete-valid, complete-invalid.              |
| **Expected Result** | Absent file → existing `CONFIG_NOT_FOUND`/`--repo` fallback path, unchanged. Without/empty `ranking` → defaults. Invalid → `CONFIG_INVALID`. |
| **Expected Result** | Ranking must not alter the pre-existing no-config behavior in `memo search` (which tolerates a missing config when `--repo` is supplied).    |
| **Risk if Missed**  | Adding ranking config could regress the documented no-config search path, breaking agents that pass `--repo` explicitly.                     |

> Scoring itself is stateless, so classical state-machine transitions do not apply. Config resolution is the only stateful surface.

### 3. Timing & Concurrency

### EC-7: DST and timezone-offset timestamps

| Field               | Value                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-2                                                                                                                  |
| **Category**        | Timing, Data Boundaries                                                                                               |
| **Input / Setup**   | Equivalent instants written as `Z`, `+00:00`, `-05:00`, and one spanning a DST boundary in the host timezone.         |
| **Expected Result** | Identical `recency_score` for equivalent instants — age is computed in absolute UTC, independent of host timezone.    |
| **Risk if Missed**  | Ranking becomes machine-dependent; the same query returns different orders for two developers in different timezones. |

### EC-8: Clock advance across the half-life boundary

| Field               | Value                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-2                                                                                                                       |
| **Category**        | Timing                                                                                                                     |
| **Input / Setup**   | Same entry scored at injected `now` values straddling exactly 90 days.                                                     |
| **Expected Result** | Score crosses `0.5` continuously — no discontinuity, no step. Injected `now` makes this deterministic without fake timers. |
| **Risk if Missed**  | A day-granularity rounding bug creates visible ranking jumps and non-reproducible test results.                            |

### 4. Idempotency

### EC-9: Repeated identical searches are stable

| Field               | Value                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-1                                                                                                            |
| **Category**        | Idempotency                                                                                                     |
| **Input / Setup**   | Run the identical search 10 times against an unchanged store.                                                   |
| **Expected Result** | Byte-identical `--json` result ordering every time, including among `final_score` ties.                         |
| **Risk if Missed**  | Unstable tie ordering makes agent behavior non-reproducible and makes any downstream test intermittently flaky. |

### EC-10: Tie-break when the tie-break key is itself absent

| Field               | Value                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-1                                                                                                                                |
| **Category**        | Idempotency, Input Domain                                                                                                           |
| **Input / Setup**   | Two entries with identical `final_score` where **both** lack `timestamp_utc` — the documented tiebreak's second key is unavailable. |
| **Expected Result** | Deterministic fallback to `id` ascending. Order is stable across runs.                                                              |
| **Risk if Missed**  | The documented tiebreak chain has an undefined middle rung; ordering silently depends on Qdrant's return order.                     |

### 5. Failure Modes

### EC-11: The shipped defaults must pass their own validator

| Field               | Value                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-8, AC-9, AC-10                                                                                                          |
| **Category**        | Failure Modes, Data Boundaries                                                                                             |
| **Input / Setup**   | Explicit `ranking: { w_similarity: 0.6, w_recency: 0.3, w_source: 0.1 }` — the documented defaults, written out literally. |
| **Expected Result** | Accepted. Per **F-2**, `0.6 + 0.3 + 0.1 === 0.9999999999999999`, so a strict `=== 1.0` check would reject the defaults.    |
| **Risk if Missed**  | **The feature ships broken for anyone who writes the documented defaults into their config.** Highest-priority edge case.  |

### EC-12: Qdrant failure during the over-fetch query

| Field               | Value                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-13                                                                                                                               |
| **Category**        | Failure Modes                                                                                                                       |
| **Input / Setup**   | Qdrant unreachable, then returning a 503, then timing out mid-response.                                                             |
| **Expected Result** | Typed `QDRANT_UNREACHABLE` / `QDRANT_OPERATION_FAILED`, exit `2`. Retry policy (3 attempts, 500ms base) unchanged by over-fetching. |
| **Risk if Missed**  | A larger over-fetch increases timeout likelihood; an unhandled path turns a transient blip into a stack trace.                      |

### EC-13: Qdrant returns fewer candidates than the over-fetch limit

| Field               | Value                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-13                                                                                                          |
| **Category**        | Failure Modes, Data Boundaries                                                                                 |
| **Input / Setup**   | Store holds 2 matching entries; `--limit 10` requests an over-fetch of `30`.                                   |
| **Expected Result** | 2 results returned. No padding, no error, `count == 2`.                                                        |
| **Risk if Missed**  | Slicing logic that assumes a full pool returns `undefined` entries or throws under `noUncheckedIndexedAccess`. |

### 6. Auth & Permissions

**N/A — Memo has no authentication or authorization layer in v1.** Access control is delegated entirely to infrastructure (`QDRANT_API_KEY`, network controls), and there is no user identity or per-tenant model. Composite ranking adds no new auth surface: it neither reads credentials nor changes which points a caller may retrieve — the Qdrant pre-filters that scope results by `repo`/`org` are unchanged by this issue. One adjacent concern is covered elsewhere: SC-13 asserts no credential values leak into validation error output.

### 7. Data Boundaries

### EC-14: Negative and out-of-range similarity from Qdrant

| Field               | Value                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-4                                                                                                                            |
| **Category**        | Data Boundaries                                                                                                                 |
| **Input / Setup**   | Cosine scores of `-1.0`, `-0.3`, `0.0`, `1.0`, and a spurious `1.0000001`.                                                      |
| **Expected Result** | Clamped to `[0,1]` before compositing; `final_score` stays in `[0,1]`.                                                          |
| **Risk if Missed**  | A negative `final_score` breaks AC-4 and any downstream consumer (notably #35's tier thresholds) that assumes a `[0,1]` domain. |

### EC-15: Extreme entry age

| Field               | Value                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-4                                                                                                                   |
| **Category**        | Data Boundaries                                                                                                        |
| **Input / Setup**   | Ages of 100 years (`≈8.2e-123`) and ~2.7 million years (underflows to exactly `0`); also Unix epoch `0` and year 2038. |
| **Expected Result** | Monotonically decreasing, never negative, never `NaN`. Underflow to `0` is acceptable; `NaN` is not.                   |
| **Risk if Missed**  | Float underflow producing `NaN` poisons the entire sort, not just the offending row.                                   |

### EC-16: `recency_half_life_days` at and beyond its boundary

| Field               | Value                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-9                                                                                                                                         |
| **Category**        | Data Boundaries                                                                                                                              |
| **Input / Setup**   | `0`, `-1`, `0.001`, `1e308`, `1e309` (→ `Infinity`), `NaN`, `"90"` (string).                                                                 |
| **Expected Result** | `0` and negative rejected by `.positive()`. Non-finite and non-numeric rejected. Very large values accepted, yielding `recency_score → 1.0`. |
| **Risk if Missed**  | `half_life = 0` divides by zero → `λ = Infinity` → `recency_score = 0` for everything, silently disabling the recency signal.                |

### EC-17: Weight-sum tolerance boundary

| Field               | Value                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-9                                                                                                                        |
| **Category**        | Data Boundaries                                                                                                             |
| **Input / Setup**   | Sums of exactly `1.0`, `1.0009`, `1.001`, `1.0011`, `0.999`, `0.9989`, and individually out-of-range `{2.0, -1.0, 0.0}`.    |
| **Expected Result** | Within ±0.001 accepted; outside rejected. `{2.0, -1.0, 0.0}` sums to `1.0` but is rejected by the per-weight `[0,1]` bound. |
| **Risk if Missed**  | A sum-only check admits absurd weightings that invert ranking semantics while appearing valid.                              |

### 8. Resource Exhaustion

### EC-18: Unbounded over-fetch at very large `--limit`

| Field               | Value                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-13, AC-14                                                                                                                                                                                |
| **Category**        | Resource Exhaustion                                                                                                                                                                         |
| **Input / Setup**   | `--limit 10000`, `--limit 1000000`, `--limit 9007199254740991` (`MAX_SAFE_INTEGER`).                                                                                                        |
| **Expected Result** | Per **F-1** the formula yields the raw limit, so Qdrant is queried for up to a million points and all are scored in memory. Expected behavior is **undefined by the current requirements**. |
| **Risk if Missed**  | Memory exhaustion or a very long-running query from a single flag value — a self-inflicted denial of service with no guard rail.                                                            |

> Requires a `product-engineer` decision before this can be marked pass or fail. Recommended resolution: keep AC-14's exact-fetch guarantee but add an absolute ceiling (e.g. `min(…, 1000)`), or constrain `--limit` itself.

### 9. API Versioning

### EC-19: Pre-change JSON consumer still functions

| Field               | Value                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-5, AC-7                                                                                                                                          |
| **Category**        | API Versioning                                                                                                                                      |
| **Input / Setup**   | A consumer written against the pre-change contract that reads `results[].similarity` and sorts by it.                                               |
| **Expected Result** | Still parses and still finds `similarity`. It will now compute a _different_ order than the CLI's own — the documented, intended consequence of D3. |
| **Risk if Missed**  | Silent behavioral change for existing agents. Must be called out in the README so consumers know to migrate to `final_score`.                       |

### EC-20: Mixed-vintage entries in one result set

| Field               | Value                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC-5                                                                                                                                                     |
| **Category**        | API Versioning, Failure Modes                                                                                                                            |
| **Input / Setup**   | One result set mixing entries with full payloads, entries missing `source`, entries missing `timestamp_utc`, and entries carrying unknown future fields. |
| **Expected Result** | Every entry scored and returned; unknown fields preserved in output per the pass-through policy; missing fields use documented fallbacks.                |
| **Risk if Missed**  | Real stores are heterogeneous; a schema assumption that holds only for fresh writes breaks search against a store built up over months.                  |

---

## Randomized Tactics and Seed Policy

Seed format: `<tactic-type>-<AC-id>-<unix-timestamp>-<4-hex>`
Replay: `pnpm test -- --testPathPattern="ranking" --seed=<captured-seed>`

Seeds **MUST** be recorded in the run log and in any failure report. On failure, follow the `verifier` Failure Triage Workflow (capture → replay → minimize → classify → report), with a maximum of 3 reproduction attempts before marking `inconclusive`.

### RT-1: Property — `final_score` is always a bounded convex combination

| Field                  | Value                                                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**              | AC-4                                                                                                                                                                                          |
| **Tactic type**        | property-based                                                                                                                                                                                |
| **Input surface**      | Random `similarity ∈ [-1.5, 1.5]`, random age `∈ [-1000, 100000]` days, random `source` from the known set plus junk, random valid weight triples summing to `1.0`.                           |
| **Property / Oracle**  | `0 ≤ final_score ≤ 1` **and** `Number.isFinite(final_score)` for every input. Because valid weights sum to `1.0`, the result must also lie within `[min, max]` of the three component scores. |
| **Iterations**         | 1000                                                                                                                                                                                          |
| **Seed**               | `prop-AC4-{timestamp}-{hex}`                                                                                                                                                                  |
| **Replay instruction** | `pnpm test -- --testPathPattern="ranking" --seed=<seed> --iterations=1`                                                                                                                       |
| **Shrink strategy**    | Delta-debug toward the boundary: halve `similarity` toward `0`, halve age toward `0`, then reduce to a single component.                                                                      |

### RT-2: Property — output ordering and cardinality invariants

| Field                  | Value                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**              | AC-1, AC-13                                                                                                                                                                              |
| **Tactic type**        | property-based                                                                                                                                                                           |
| **Input surface**      | Random result arrays of length `0…200` with random scores, sources, and timestamps (including missing fields).                                                                           |
| **Property / Oracle**  | Output is non-increasing in `final_score`; output length equals input length (ranking drops nothing); the output is a permutation of the input by `id` (nothing invented or duplicated). |
| **Iterations**         | 500                                                                                                                                                                                      |
| **Seed**               | `prop-AC1-{timestamp}-{hex}`                                                                                                                                                             |
| **Replay instruction** | `pnpm test -- --testPathPattern="ranking" --seed=<seed> --iterations=1`                                                                                                                  |
| **Shrink strategy**    | Binary-search the array length down to the minimal pair that violates ordering.                                                                                                          |

### RT-3: Property — monotonicity in each signal

| Field                  | Value                                                                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**              | AC-2, AC-3                                                                                                                                                                                                       |
| **Tactic type**        | property-based                                                                                                                                                                                                   |
| **Input surface**      | Random base entries, each perturbed one signal at a time.                                                                                                                                                        |
| **Property / Oracle**  | Holding the other two fixed: increasing `similarity` never decreases `final_score`; increasing age never increases it; a higher-tier `source` never decreases it. Strict when the corresponding weight is `> 0`. |
| **Iterations**         | 500                                                                                                                                                                                                              |
| **Seed**               | `prop-AC2-{timestamp}-{hex}`                                                                                                                                                                                     |
| **Replay instruction** | `pnpm test -- --testPathPattern="ranking" --seed=<seed> --iterations=1`                                                                                                                                          |
| **Shrink strategy**    | Reduce the perturbation delta until the violation disappears; report the last failing delta.                                                                                                                     |

### RT-4: Property — determinism and permutation invariance

| Field                  | Value                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**              | AC-1                                                                                                                                                                                              |
| **Tactic type**        | property-based                                                                                                                                                                                    |
| **Input surface**      | Random arrays containing deliberate `final_score` ties, then randomly shuffled.                                                                                                                   |
| **Property / Oracle**  | Ranking the shuffled array yields the same `id` sequence as ranking the original — the documented tiebreak makes order independent of input order. Also `rank(rank(x)) == rank(x)` (idempotence). |
| **Iterations**         | 300                                                                                                                                                                                               |
| **Seed**               | `prop-AC1b-{timestamp}-{hex}`                                                                                                                                                                     |
| **Replay instruction** | `pnpm test -- --testPathPattern="ranking" --seed=<seed> --iterations=1`                                                                                                                           |
| **Shrink strategy**    | Reduce to the smallest tied subset that reorders under shuffling.                                                                                                                                 |

### RT-5: Fuzz — `--limit` and `ranking` config values

| Field                  | Value                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**              | AC-9, AC-12, AC-13, AC-14                                                                                                                                                                                                                                                                                                 |
| **Tactic type**        | fuzz                                                                                                                                                                                                                                                                                                                      |
| **Input surface**      | `--limit` flag and the four `ranking` config fields.                                                                                                                                                                                                                                                                      |
| **Property / Oracle**  | Never an unhandled exception or stack trace; always exit `0`, `1`, or `2`; a non-zero exit always carries a typed `MemoError` code. Over-fetch never exceeds the documented formula. Corpus: `0`, `-1`, `1.5`, `1e309`, `NaN`, `""`, `"abc"`, `MAX_SAFE_INTEGER`, `null`, `[]`, `{}`, `__proto__`, 10 KB numeric strings. |
| **Iterations**         | 500                                                                                                                                                                                                                                                                                                                       |
| **Seed**               | `fuzz-AC13-{timestamp}-{hex}`                                                                                                                                                                                                                                                                                             |
| **Replay instruction** | `pnpm test -- --testPathPattern="search\|config" --seed=<seed> --iterations=1`                                                                                                                                                                                                                                            |
| **Shrink strategy**    | Binary-search numeric magnitude; for strings, truncate toward the shortest still-failing input.                                                                                                                                                                                                                           |

### RT-6: Fuzz — heterogeneous stored payloads

| Field                  | Value                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**              | AC-4, AC-5                                                                                                                                        |
| **Tactic type**        | fuzz                                                                                                                                              |
| **Input surface**      | Mocked Qdrant payloads: random field presence/absence, wrong types, deeply nested objects, unknown extra keys, 5000-character rationales.         |
| **Property / Oracle**  | Every payload yields a finite `final_score` and appears in output. All four score fields present and numeric. No `NaN`, no `undefined`, no throw. |
| **Iterations**         | 400                                                                                                                                               |
| **Seed**               | `fuzz-AC5-{timestamp}-{hex}`                                                                                                                      |
| **Replay instruction** | `pnpm test -- --testPathPattern="search" --seed=<seed> --iterations=1`                                                                            |
| **Shrink strategy**    | Remove payload fields one at a time to find the minimal field set that triggers the failure.                                                      |

---

## Execution Checklist

Pre-implementation (test-first — these should fail before code exists):

- [ ] Scaffold `tests/unit/lib/ranking.test.ts` with EC-1, EC-2, EC-3, EC-4 as failing tests.
- [ ] Add **EC-11** first — the defaults-pass-their-own-validator test. It guards F-2, the highest-severity finding.
- [ ] Add RT-1 and RT-2 property harnesses with seed capture wired in.

During implementation:

- [ ] SC-1 … SC-13 pass.
- [ ] CT-1 … CT-10 pass, with CT-5(c) held `undetermined` pending the AC-11 clarification.
- [ ] EC-1 … EC-20 pass, with EC-18 held `undetermined` pending the F-1 decision.
- [ ] RT-1 … RT-6 executed; seeds recorded in the run log.

Quality gates (AC-15 … AC-18):

- [ ] `pnpm test` — full suite green.
- [ ] `pnpm test -- --testPathPattern="ranking|search|setup|config|output"` — targeted green.
- [ ] `pnpm run test:coverage` — global thresholds hold; `src/lib/` inspected against the 85% target.
- [ ] `pnpm run lint`, `pnpm run format:check`, `pnpm run typecheck`.
- [ ] `pnpm audit --audit-level=high` (no `audit` npm script exists).

Negative-space checks (non-goals stay untouched):

- [ ] No `confidence_tier` field appears in output (belongs to #35).
- [ ] No tag-overlap boost applied (belongs to #36).
- [ ] No `stale` flag appears (belongs to #38).
- [ ] `memo list` ordering remains purely chronological.
- [ ] Payload `confidence` does not influence `final_score`.

---

## Recommendations

| #   | Finding                                                                                          | Owner                            | Recommended action                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **F-1** — over-fetch unbounded above; AC-13/AC-14 conflict with the stated 50-cap                | `product-engineer`               | Decide the intended semantics. Suggest retaining AC-14's exact fetch but adding an absolute ceiling, or bounding `--limit`. Blocks a pass/fail verdict on EC-18. |
| 2   | **F-2** — defaults sum to `0.9999999999999999`                                                   | `developer`                      | Implement the sum check with ±0.001 tolerance only; never `=== 1.0`. Land EC-11 as a regression test first.                                                      |
| 3   | **F-3** — `Date.parse('2026')` succeeds                                                          | `developer`                      | Decide whether to accept lenient parsing or require strict ISO-8601 datetime; document either way. Covered by EC-3.                                              |
| 4   | **AC-11 ambiguity** — is a partial `ranking` block rejected outright, or defaults-then-validate? | `product-engineer`               | Clarify. This plan assumes defaults-then-validate (CT-5).                                                                                                        |
| 5   | **EC-19** — silent ordering change for existing `--json` consumers                               | `technical-writer` / `developer` | Call the migration out explicitly in the README section for search output.                                                                                       |

---

## Output Contract

| Field                  | Value                                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mode**               | Design                                                                                                                                                |
| **Phase**              | 4 — Reporting & Publication (complete)                                                                                                                |
| **Source artifact**    | `workstream/issue-34-composite-ranking-score-refinement.md`                                                                                           |
| **Artifacts produced** | `workstream/test-plan-issue-34.md`, `workstream/traceability-matrix-issue-34.md`                                                                      |
| **GitHub issue**       | [#34](https://github.com/llipe/memo-cli/issues/34)                                                                                                    |
| **AC coverage**        | 18/18 addressed. AC-1…AC-14 covered by scenarios; AC-15…AC-18 covered by the Execution Checklist as process criteria.                                 |
| **Scenario counts**    | 13 E2E, 10 contract, 20 edge-case, 6 randomized                                                                                                       |
| **Blocking gaps**      | None for design. Two items require `product-engineer` clarification before they can receive a pass/fail verdict: **F-1/EC-18** and **AC-11/CT-5(c)**. |
