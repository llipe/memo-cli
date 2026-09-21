# Compliance Test Plan — Issue #81: `QdrantRepository` Extensions and v2 Payload Indexes (S2-02)

> Produced by **`verifier`** (Design Mode) on 2026-09-21. Pre-implementation. Black-box-first, weighted toward `activity-contract-test-design` and `activity-edge-case-refinement` because this story is pure adapter/infrastructure work with no CLI-facing behavior (see "E2E Scope Note" below).

## Changelog

| Version | Date       | Summary           | Author   |
| ------- | ---------- | ----------------- | -------- |
| 1.0     | 2026-09-21 | Initial test plan | verifier |

## Source Input Summary

| Field               | Value                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Repository**      | `llipe/memo-cli`                                                                                                                                                  |
| **GitHub Issue**    | [#81](https://github.com/llipe/memo-cli/issues/81)                                                                                                                |
| **Input type**      | `story`                                                                                                                                                           |
| **Source artifact** | `workstream/user-stories-prd-004-phase-2.md` — Story S2-02                                                                                                        |
| **Also binding**    | `workstream/specification-prd-004-long-lived-agent-memory.md` §18.4 (`QdrantRepository` extensions), §8.1 (`buildBaseFilter`), decision A11 (§4, pagination rule) |
| **Grounding code**  | `src/lib/qdrant.ts` (current: `ensureIndexes`, `scroll`, `search`, `fetchByRepo`, `getById`, `getByDedupeKey`, `deleteById`, `deleteByFilter`, `upsert`)          |
| **Task list**       | `workstream/tasks-prd-004-phase-2-plan.md`, task 2.0 (sub-tasks 2.1–2.18)                                                                                         |
| **ACs extracted**   | 7 (AC1 … AC7)                                                                                                                                                     |
| **Traceability**    | `workstream/traceability-matrix-issue-81.md`                                                                                                                      |

### E2E Scope Note (why `activity-e2e-test-design` is thin here)

This story changes `src/lib/qdrant.ts` only. No command (`write`, `search`, `list`, `timeline`, `recall`, `bank`, `migrate`) calls any new method yet — those call sites land in later Phase 2 stories (S2-05, S2-06, S2-07, S2-08, S2-09). There is therefore no CLI-observable black-box surface for AC2–AC7: they are only reachable through the mocked `@qdrant/js-client-rest` client that `tests/unit/lib/qdrant.test.ts` already mocks (see `src/lib/qdrant.ts` current test file), or through a live Qdrant instance in `tests/integration/lib/qdrant.test.ts`. Per the skill's requirement to declare non-coverable ACs rather than force a scenario: **E2E scenarios are limited to one item (SC-1)**, covering AC1 via the integration-level `ensureIndexes` reconciliation against a live-shaped `payload_schema`, since that is the only behavior in this story with an observable effect outside the adapter's own request/response shape (the Qdrant collection's persisted index set). All other ACs are covered by **Contract Validation Scenarios** (grey-box-adjacent but still assertion-on-request/response-shape, consistent with `verifier`'s black-box-first Design Mode rule: assertions are on the wire contract between the adapter and the Qdrant client, not on `qdrant.ts`'s internal control flow) and the **Edge-Case Catalog**.

---

## Acceptance Criteria Extraction

| ID  | Criterion (condensed)                                                                                                                                                    | Source AC |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| AC1 | `PAYLOAD_INDEXES` gains exactly 12 entries (4 keyword, 1 integer, 4 bool, 3 datetime); `ensureIndexes()` creates only missing ones, idempotent on a second run           | AC1       |
| AC2 | `scrollAll(filter, { batch, withVector }, onPage)` sends no `order_by`, follows `next_page_offset` until `null`, invokes `onPage` once per page in order                 | AC2       |
| AC3 | `scrollOrdered(filter, { orderBy, limit, withVector })` sends `order_by` and never `offset`; returns exactly one page                                                    | AC3       |
| AC4 | `count(filter)` calls the client's `count` with `exact: true` and returns the number                                                                                     | AC4       |
| AC5 | `setPayload`/`batchSetPayload` call `setPayload`/`batchUpdate` with `wait: true`; `batchSetPayload` chunks at 256 ops; failures map to `QDRANT_OPERATION_FAILED`         | AC5       |
| AC6 | `fetchStalenessCorpus({ bank, repos }, limit)` applies §8.1 base filter for `bank` plus `repo` any-match only when `bank = 'kb'`; `fetchByRepo` does not survive Phase 2 | AC6       |
| AC7 | Existing `scroll`, `search`, `getById`, `getByDedupeKey`, `deleteById`, `deleteByFilter`, `upsert` behave exactly as before (existing tests unchanged and passing)       | AC7       |

**Non-goals** (negative-space assertions): no command imports `@qdrant/js-client-rest` directly (Business Rule); no data migration/backfill of existing payloads (indexes are additive, reconciled at runtime — explicitly out of scope per the prompt and the story's Migration Requirements); no change to `scroll()`'s hard-coded `order_by: timestamp_utc desc`; ranking (`src/lib/ranking.ts`) untouched.

**Coverage note:** AC1 is the only AC with an observable effect reachable via an integration-style scenario (a real/mocked-live `payload_schema` state); AC2–AC7 are covered exclusively by contract scenarios (request/response shape against the mocked Qdrant client) and the edge-case catalog, per the E2E Scope Note above.

---

## E2E Black-Box Scenarios

### SC-1: `ensureIndexes` reconciles a pre-existing v1.2.0-shaped collection

| Field               | Value                                                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC1                                                                                                                                                                                                                                                                                        |
| **Type**            | happy-path                                                                                                                                                                                                                                                                                 |
| **Severity**        | critical                                                                                                                                                                                                                                                                                   |
| **Preconditions**   | Mocked (integration test) or live `getCollection().payload_schema` contains exactly the 10 shipped v1.2.0 fields (`repo`, `org`, `entry_type`, `source`, `tags`, `timestamp_utc`, `commit`, `dedupe_key_sha256`, `rationale`, `files_modified`) and none of the 12 new ones.               |
| **Steps**           | 1. Call `ensureIndexes()`. 2. Inspect the sequence of `createPayloadIndex` calls (integration test) or `getCollection().payload_schema` (manual/live). 3. Call `ensureIndexes()` a second time.                                                                                            |
| **Expected Result** | First call creates exactly the 12 new indexes (`bank`, `kind`, `session_id`, `contexts` as keyword; `seq` as integer; `archived`, `superseded`, `consolidated`, `pinned` as bool; `valid_to`, `expires_at`, `archived_at` as datetime) and none of the existing 10. Second call creates 0. |
| **Pass Criteria**   | `createPayloadIndex` called exactly 12 times on the first run, each with a `field_name`/`field_schema` pair matching the AC1 list; 0 calls on the second run.                                                                                                                              |

---

## Contract Validation Scenarios

Contracts under test — all between `QdrantRepository` (consumer of `@qdrant/js-client-rest`) and the Qdrant client's mocked request/response shape, per this story's pure-adapter scope:

| Boundary                                      | Type            | Consumer                            | Provider                        |
| --------------------------------------------- | --------------- | ----------------------------------- | ------------------------------- |
| `client.scroll` (unordered pagination)        | consumer-driven | `scrollAll`                         | `@qdrant/js-client-rest`        |
| `client.scroll` (single ordered page)         | consumer-driven | `scrollOrdered`                     | `@qdrant/js-client-rest`        |
| `client.count`                                | consumer-driven | `count`                             | `@qdrant/js-client-rest`        |
| `client.setPayload` / `client.batchUpdate`    | consumer-driven | `setPayload`, `batchSetPayload`     | `@qdrant/js-client-rest`        |
| `client.scroll` filter shape (staleness)      | consumer-driven | `fetchStalenessCorpus`              | `@qdrant/js-client-rest`        |
| `client.createPayloadIndex` (index set)       | consumer-driven | `ensureIndexes` / `PAYLOAD_INDEXES` | `@qdrant/js-client-rest`        |
| Error-mapping contract                        | provider-driven | callers of `QdrantRepository`       | `QdrantRepository` (this class) |
| Existing method request/response shapes (AC7) | provider-driven | callers of `QdrantRepository`       | `QdrantRepository` (this class) |

### CT-1: `scrollAll` pagination contract

| Field               | Value                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC2                                                                                                                                                                                                                                                                                                                                   |
| **Contract type**   | consumer-driven                                                                                                                                                                                                                                                                                                                       |
| **Boundary**        | `client.scroll` (unordered pagination)                                                                                                                                                                                                                                                                                                |
| **Direction**       | request + response                                                                                                                                                                                                                                                                                                                    |
| **Input**           | Mock `client.scroll` to return 3 pages: page 1 `{ points: [...], next_page_offset: 'off-1' }`, page 2 `{ points: [...], next_page_offset: 'off-2' }`, page 3 `{ points: [...], next_page_offset: null }`. Call `scrollAll(filter, { batch: 50 }, onPage)`.                                                                            |
| **Expected Result** | Three `client.scroll` calls. None includes `order_by`. Call 1: no `offset` (or `offset: undefined`). Call 2: `offset: 'off-1'`. Call 3: `offset: 'off-2'`. `onPage` invoked exactly 3 times, once per page, in page order (call 1's `onPage` argument matches page 1's points, etc.). Loop terminates after `next_page_offset: null`. |
| **Pass Criteria**   | Assertion on the ordered argument list to `client.scroll` (no `order_by` key present in any call) and to `onPage` (call order and payload match). Directly implements the story's Unit Tests note.                                                                                                                                    |

### CT-2: `scrollOrdered` single-page contract

| Field               | Value                                                                                                                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC3                                                                                                                                                                                                                                                                                                  |
| **Contract type**   | consumer-driven                                                                                                                                                                                                                                                                                      |
| **Boundary**        | `client.scroll` (single ordered page)                                                                                                                                                                                                                                                                |
| **Direction**       | request + response                                                                                                                                                                                                                                                                                   |
| **Input**           | Call `scrollOrdered({ must: [...] }, { orderBy: { key: 'seq', direction: 'desc' }, limit: 1, withVector: true })` against a mock returning one page with `next_page_offset` non-null.                                                                                                                |
| **Expected Result** | `client.scroll` called exactly once with `order_by: { key: 'seq', direction: 'desc' }`, `limit: 1`, `with_vector: true`, and **no `offset` key at all** (not `offset: undefined` sent explicitly as a meaningful value, and no second call is ever made even though `next_page_offset` is non-null). |
| **Pass Criteria**   | Exactly one `client.scroll` call. Request object has `order_by` present and `offset` absent. Return value is the single page's points, not a further loop.                                                                                                                                           |

### CT-3: `count` contract

| Field               | Value                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC4                                                                                                                                                                                                        |
| **Contract type**   | consumer-driven                                                                                                                                                                                            |
| **Boundary**        | `client.count`                                                                                                                                                                                             |
| **Direction**       | request + response                                                                                                                                                                                         |
| **Input**           | Call `count(filter)`; mock `client.count` to resolve `{ count: 7 }`.                                                                                                                                       |
| **Expected Result** | `client.count` called once with `{ filter, exact: true }` (collection name as the first positional argument per the shipped call pattern). `count()` resolves to `7` (the number, not the wrapper object). |
| **Pass Criteria**   | Request shape assertion (`exact: true` present) and return-type assertion (`typeof result === 'number'`).                                                                                                  |

### CT-4: `setPayload` / `batchSetPayload` contract and chunking

| Field               | Value                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC5                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Contract type**   | consumer-driven                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Boundary**        | `client.setPayload` / `client.batchUpdate`                                                                                                                                                                                                                                                                                                                                                                                      |
| **Direction**       | request                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Input**           | (a) `setPayload('id-1', { archived: true })`. (b) `batchSetPayload` with exactly 300 `{ id, payload }` ops.                                                                                                                                                                                                                                                                                                                     |
| **Expected Result** | (a) `client.setPayload` called once with `{ points: ['id-1'], payload: { archived: true }, wait: true }`. (b) `client.batchUpdate` called exactly **2** times (chunks of 256 and 44); each call's `operations` array elements have the shape `{ set_payload: { points: [id], payload } }`; each call passes `wait: true`; concatenating all chunks' ops, in call order, reproduces the original 300-op input in original order. |
| **Pass Criteria**   | Both request shapes match exactly. Chunk count is `Math.ceil(300 / 256) = 2`. No op is duplicated, dropped, or reordered across chunks.                                                                                                                                                                                                                                                                                         |

### CT-5: `fetchStalenessCorpus` filter-shape contract (`kb` vs private)

| Field               | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Contract type**   | consumer-driven                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Boundary**        | `client.scroll` filter shape (staleness)                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Direction**       | request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Input**           | (a) `fetchStalenessCorpus({ bank: 'kb', repos: ['repo-a', 'repo-b'] }, 1000)`. (b) `fetchStalenessCorpus({ bank: 'private-jarvis', repos: ['repo-a'] }, 1000)`.                                                                                                                                                                                                                                                                                                                                        |
| **Expected Result** | (a) The filter passed to the underlying scroll includes the §8.1 `kb` base-filter shape (`should: [{ key: 'bank', match: { value: 'kb' } }, { is_empty: { key: 'bank' } }]`) **plus** `{ key: 'repo', match: { any: ['repo-a', 'repo-b'] } }`. (b) The filter includes the private-bank base-filter shape (`must: [{ key: 'bank', match: { value: 'private-jarvis' } }]`) and does **not** include any `repo` any-match clause, even though `repos` was supplied. `limit` forwarded as `1000` in both. |
| **Pass Criteria**   | Filter object structurally matches per bank. The `repo` clause's conditional presence (kb-only) is the load-bearing assertion — this is the story's core AC6 differentiator.                                                                                                                                                                                                                                                                                                                           |

### CT-6: `ensureIndexes` index-set contract

| Field               | Value                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC1                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Contract type**   | consumer-driven                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Boundary**        | `client.createPayloadIndex` (index set)                                                                                                                                                                                                                                                                                                                                                                                               |
| **Direction**       | request                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Input**           | Static inspection of `PAYLOAD_INDEXES` plus a mocked `payload_schema` containing only the shipped 10 fields.                                                                                                                                                                                                                                                                                                                          |
| **Expected Result** | `PAYLOAD_INDEXES` contains exactly 22 entries total (10 shipped + 12 new) with these 12 new field/schema pairs: `bank`/`kind`/`session_id`/`contexts` → `'keyword'`; `seq` → `'integer'`; `archived`/`superseded`/`consolidated`/`pinned` → `'bool'`; `valid_to`/`expires_at`/`archived_at` → `'datetime'`. `createPayloadIndex` is called once per missing field with the exact `field_name`/`field_schema` pair, no more, no fewer. |
| **Pass Criteria**   | Exact set equality (order-independent) between the expected 12-entry list and the entries created for a v1.2.0-shaped schema.                                                                                                                                                                                                                                                                                                         |

### CT-7: Error-mapping contract — client failures surface as `QDRANT_OPERATION_FAILED`

| Field               | Value                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC5 (explicit), AC2–AC4/AC6 (implied by "adapter methods map failures consistently," cross-checked against the shipped pattern in `upsert`/`search`/`deleteById`)                                                                                       |
| **Contract type**   | provider-driven                                                                                                                                                                                                                                         |
| **Boundary**        | Error-mapping contract                                                                                                                                                                                                                                  |
| **Direction**       | response (error)                                                                                                                                                                                                                                        |
| **Input**           | Mock `client.setPayload`, `client.batchUpdate`, and `client.count` to each reject with a generic `Error`.                                                                                                                                               |
| **Expected Result** | `setPayload`, `batchSetPayload`, and `count` each reject with a `MemoError` whose code is `QDRANT_OPERATION_FAILED` (AC5's explicit requirement; `count`'s mapping is inferred from the shipped pattern and flagged as **F-1** below for confirmation). |
| **Pass Criteria**   | `instanceof MemoError` and `.code === 'QDRANT_OPERATION_FAILED'` for all three methods under a rejected client call.                                                                                                                                    |

### CT-8: Existing-method regression contract (AC7)

| Field               | Value                                                                                                                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC7                                                                                                                                                                                                                                                                               |
| **Contract type**   | provider-driven                                                                                                                                                                                                                                                                   |
| **Boundary**        | Existing method request/response shapes                                                                                                                                                                                                                                           |
| **Direction**       | request + response                                                                                                                                                                                                                                                                |
| **Input**           | The full existing `tests/unit/lib/qdrant.test.ts` and `tests/integration/lib/qdrant.test.ts` suites, run unmodified against the post-story code, for `scroll`, `search`, `getById`, `getByDedupeKey`, `deleteById`, `deleteByFilter`, `upsert`.                                   |
| **Expected Result** | Every existing assertion (request shape, `order_by: timestamp_utc desc` on `scroll`, error codes, return shapes) continues to pass with zero test-file edits required to keep them green.                                                                                         |
| **Pass Criteria**   | `pnpm test -- --testPathPattern="qdrant"` green with the pre-existing test bodies unmodified (a diff on the test files touching only additive new `describe` blocks, not edits to existing ones, is the acceptance signal for "unchanged and passing" per AC7's literal wording). |

---

## Edge-Case Catalog

Nine categories evaluated; two are declared `N/A` for this adapter-only story with justification (Timing & Concurrency, Auth & Permissions).

### 1. Input Domain

### EC-1: `scrollAll` batch-size boundary values

| Field               | Value                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC2                                                                                                                                                                                                    |
| **Category**        | Input Domain                                                                                                                                                                                           |
| **Input / Setup**   | `scrollAll(filter, { batch: 1 }, onPage)` against a mock returning 4 single-point pages; `scrollAll(filter, {}, onPage)` (no `batch` supplied — default applies).                                      |
| **Expected Result** | `batch: 1` forwards `limit: 1` on every `client.scroll` call and still completes the full 4-page loop. Omitted `batch` forwards the documented default (`limit: 256`) per the spec's method signature. |
| **Risk if Missed**  | A hardcoded or ignored `batch` option would make `scrollAll` unusable for `migrate`'s eventual small-batch or large-batch tuning needs (S2-09).                                                        |

### EC-12: `scrollOrdered` never auto-continues even when a further page exists

| Field               | Value                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC3                                                                                                                                                                                                                             |
| **Category**        | Input Domain                                                                                                                                                                                                                    |
| **Input / Setup**   | Mock `client.scroll` to return a page with a non-null `next_page_offset` (simulating "more data exists") for a `scrollOrdered` call.                                                                                            |
| **Expected Result** | `scrollOrdered` returns after the single call regardless of `next_page_offset`'s value — it must never inspect or act on it. Guards against copy-pasting `scrollAll`'s loop into `scrollOrdered`.                               |
| **Risk if Missed**  | If `scrollOrdered` accidentally loops, it would violate A11 (Qdrant rejects `offset` alongside `order_by`) on the second call and crash every ordered-scan caller (`timeline`, `write`'s `nextSeq`, `recall`'s `LAST SESSION`). |

### EC-14: `fetchStalenessCorpus` with an empty `repos` array in `kb`

| Field               | Value                                                                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC6                                                                                                                                                                                                                                                                                         |
| **Category**        | Input Domain                                                                                                                                                                                                                                                                                |
| **Input / Setup**   | `fetchStalenessCorpus({ bank: 'kb', repos: [] }, 1000)`.                                                                                                                                                                                                                                    |
| **Expected Result** | The `repo` any-match clause is still added (`{ key: 'repo', match: { any: [] } }`) rather than silently omitted — an empty `any` array must not be special-cased into "no repo filter" (which would widen the corpus to every repo, an unintended cross-repo leak for staleness detection). |
| **Risk if Missed**  | A hidden `repos.length > 0` guard would silently return the entire `kb` bank's corpus for a repo with zero resolved repos, corrupting staleness annotations without a visible error.                                                                                                        |

### EC-15: `fetchStalenessCorpus` ignores `repos` entirely for a private bank

| Field               | Value                                                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC6                                                                                                                                                                                                               |
| **Category**        | Input Domain                                                                                                                                                                                                      |
| **Input / Setup**   | `fetchStalenessCorpus({ bank: 'private-x', repos: ['repo-a', 'repo-b'] }, 1000)` — `repos` deliberately non-empty for a private bank.                                                                             |
| **Expected Result** | No `repo` clause appears anywhere in the filter passed to the underlying scroll, confirming the "only when `bank = 'kb'`" clause in AC6 is unconditional, not merely "usually."                                   |
| **Risk if Missed**  | A private bank's staleness corpus silently narrowing to a caller-supplied `repos` list would contradict the story's stated business rule and the private-bank isolation guarantees elsewhere in Phase 2 (AC-2.4). |

### 2. State Transitions

### EC-2: `ensureIndexes` on a partially-migrated schema

| Field               | Value                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC1                                                                                                                                                                                                                         |
| **Category**        | State Transitions                                                                                                                                                                                                           |
| **Input / Setup**   | Mocked `payload_schema` containing the 10 shipped fields plus 5 of the 12 new ones (e.g., `bank`, `kind`, `seq`, `archived`, `valid_to`), simulating a collection that was partially reconciled by a prior interrupted run. |
| **Expected Result** | `createPayloadIndex` is called exactly 7 times — once for each of the 7 still-missing new fields — and zero times for any of the 15 already-present fields.                                                                 |
| **Risk if Missed**  | Re-creating an existing index either errors against Qdrant or silently duplicates work on every command invocation (`ensureIndexes` runs on every `search`/`write`), degrading latency.                                     |

### EC-3: `ensureIndexes` when `payload_schema` is entirely absent from the response

| Field               | Value                                                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC1                                                                                                                                                                                                                          |
| **Category**        | State Transitions                                                                                                                                                                                                            |
| **Input / Setup**   | `client.getCollection` resolves an object with no `payload_schema` key at all (matches the shipped `createMissingIndexes(new Set(...))` fallback pattern already used for `ensureCollection`'s brand-new-collection branch). |
| **Expected Result** | Treated identically to an empty schema — all 22 entries in `PAYLOAD_INDEXES` (10 existing + 12 new) are created, none skipped.                                                                                               |
| **Risk if Missed**  | A `payload_schema?.` optional-chaining bug that throws instead of defaulting to an empty set would break `ensureIndexes` against any collection whose `getCollection` response omits the field.                              |

### 3. Timing & Concurrency

**N/A for this story's scope.** `scrollAll`'s page loop is sequential `await`-chained, not concurrent; `batchSetPayload`'s chunking is likewise sequential per chunk. There is no new concurrent-caller scenario introduced by this story (a single CLI invocation constructs one `QdrantRepository` and calls it single-threaded). Multi-process races against `ensureIndexes` (two `memo` invocations reconciling indexes simultaneously) are a pre-existing risk inherited unchanged from the shipped `ensureIndexes()` and are out of this story's scope — flagged as a Recommendation rather than a new edge case, since AC1 does not claim any new concurrency guarantee.

### 4. Idempotency

### EC-4: `ensureIndexes` idempotent across repeated sequential runs, order-stable

| Field               | Value                                                                                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC1                                                                                                                                                                                                                                                                 |
| **Category**        | Idempotency                                                                                                                                                                                                                                                         |
| **Input / Setup**   | Call `ensureIndexes()` three times in sequence against a mock whose `getCollection` reflects indexes as "already created" after each `createPayloadIndex` call (i.e., the mock's second/third `getCollection` response includes everything the first call created). |
| **Expected Result** | Run 1 creates 12; runs 2 and 3 create 0 each. The order of the 12 `createPayloadIndex` calls in run 1 matches `PAYLOAD_INDEXES`' declaration order every time this scenario is executed (deterministic, not incidentally order-dependent on `Set` iteration).       |
| **Pass Criteria**   | Zero `createPayloadIndex` calls on runs 2 and 3. Call order on run 1 is stable across repeated executions of the test itself (not flaky).                                                                                                                           |

### 5. Failure Modes

### EC-5: Client throws mid-`scrollAll` after delivering some pages

| Field               | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Category**        | Failure Modes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Input / Setup**   | Mock `client.scroll` to resolve pages 1 and 2 normally, then reject on the call for page 3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Expected Result** | `onPage` is called exactly twice (for pages 1 and 2, never re-invoked for those pages). The rejection from the page-3 call propagates out of `scrollAll` — the story's own edge-case matrix states "error propagates, pages already delivered are not retried," without mandating a specific error _type_. **See F-1**: whether the propagated error is the raw client error or is wrapped as `MemoError('QDRANT_OPERATION_FAILED', ...)` (matching every other method's pattern) is unspecified by AC2/AC5; this scenario records the observed behavior as evidence rather than asserting a specific type, pending confirmation. |
| **Risk if Missed**  | A caller (`migrate`, once written) that pattern-matches on `MemoError.code` to decide whether to resume would silently mishandle a raw, unwrapped error from a mid-scroll failure.                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### EC-6: `setPayload`, `batchSetPayload`, `count` map client failures to `QDRANT_OPERATION_FAILED`

| Field               | Value                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC4, AC5                                                                                                                                                                            |
| **Category**        | Failure Modes                                                                                                                                                                       |
| **Input / Setup**   | Mock each of `client.setPayload`, `client.batchUpdate`, `client.count` to reject with a generic network `Error`.                                                                    |
| **Expected Result** | Each of `setPayload`, `batchSetPayload`, `count` rejects with `MemoError('QDRANT_OPERATION_FAILED', ...)`, matching the shipped pattern used by `upsert`/`search`/`deleteById`.     |
| **Pass Criteria**   | `instanceof MemoError`, `.code === 'QDRANT_OPERATION_FAILED'` for all three. Directly required for AC5 by name; extended to `count` (AC4) per the shipped error-mapping convention. |

### 6. Auth & Permissions

**N/A — no new auth surface.** This story adds no new credential, identity, or permission model; every new method reuses the same constructor-scoped `QdrantClient` (`QDRANT_URL`/`QDRANT_API_KEY`) as every shipped method. No new environment variable or flag is introduced.

### 7. Data Boundaries

### EC-7: `batchSetPayload` op-count boundaries around the 256 chunk size

| Field               | Value                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC5                                                                                                                                                                                                                |
| **Category**        | Data Boundaries                                                                                                                                                                                                    |
| **Input / Setup**   | `batchSetPayload` called with op arrays of length `0`, `1`, `255`, `256`, `257`, `512`, `513`.                                                                                                                     |
| **Expected Result** | `0` → zero `client.batchUpdate` calls (no-op, per the story's own edge-case matrix). `1`–`256` → exactly 1 call. `257`–`512` → exactly 2 calls (`256` + remainder). `513` → exactly 3 calls (`256` + `256` + `1`). |
| **Pass Criteria**   | Call count == `Math.ceil(n / 256)` for `n > 0`, and `0` calls for `n = 0`, across every listed boundary.                                                                                                           |

### EC-8: `scrollAll` page exactly `batch` items long vs. a short final page

| Field               | Value                                                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC2                                                                                                                                                                                                              |
| **Category**        | Data Boundaries                                                                                                                                                                                                  |
| **Input / Setup**   | `batch: 3`; mock page 1 returns exactly 3 points with a non-null `next_page_offset`; page 2 returns 1 point with `next_page_offset: null`.                                                                       |
| **Expected Result** | Loop continues after the full page (page length equaling `batch` is not treated as an implicit "last page" signal — only `next_page_offset === null` ends the loop) and correctly stops on the short final page. |
| **Risk if Missed**  | An implementation that infers "last page" from `points.length < batch` instead of trusting `next_page_offset` would silently drop the tail of a collection whose size is an exact multiple of `batch`.           |

### EC-13: `count` on a filter matching nothing returns `0`

| Field               | Value                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC4                                                                                          |
| **Category**        | Data Boundaries                                                                              |
| **Input / Setup**   | Mock `client.count` to resolve `{ count: 0 }` for a filter engineered to match nothing.      |
| **Expected Result** | `count()` resolves to `0` (a real number, not `undefined`/`null`/`NaN`).                     |
| **Pass Criteria**   | `Object.is(result, 0)` — guards against an accidental falsy-coalescing bug on the zero case. |

### 8. Resource Exhaustion

### EC-9: `scrollAll` over many pages streams via `onPage` without accumulating a full result set

| Field               | Value                                                                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC2                                                                                                                                                                                                                                                                                                                |
| **Category**        | Resource Exhaustion                                                                                                                                                                                                                                                                                                |
| **Input / Setup**   | Mock 50 synthetic pages (well beyond any realistic Phase 2 collection size in tests) chained by `next_page_offset`.                                                                                                                                                                                                |
| **Expected Result** | All 50 `onPage` invocations complete in order; `scrollAll`'s own return value is `void`/`undefined` (per the AC2 signature — it is a callback-driven streaming method, not an accumulator), confirming the design does not buffer all 50 pages' points into one in-memory array before returning.                  |
| **Pass Criteria**   | 50 ordered `onPage` calls observed. `scrollAll`'s resolved value carries no accumulated point array (black-box signal that the streaming contract, not an accumulate-then-return contract, is what's implemented — the load-bearing distinction for why `migrate` needs this method over a bigger `scroll` limit). |

### 9. API Versioning

### EC-10: `fetchByRepo` does not survive Phase 2

| Field               | Value                                                                                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC(s)**           | AC6                                                                                                                                                                                                                                                                                                    |
| **Category**        | API Versioning                                                                                                                                                                                                                                                                                         |
| **Input / Setup**   | Structural check (not a runtime test): grep the repository for `fetchByRepo` after this story's PR (or after S2-05's, whichever removes the last call site — AC6 explicitly allows either order).                                                                                                      |
| **Expected Result** | Zero references to `fetchByRepo` remain in `src/` once both S2-02 and S2-05 have merged. If this story's PR merges first and `search.ts` still calls `fetchByRepo`, the method may still exist in this PR alone — the AC6 gate is "must not survive Phase 2," not "must not survive this PR."          |
| **Pass Criteria**   | This scenario cannot be marked `pass` from S2-02's PR in isolation if `search.ts` hasn't moved yet; it is deferred to the Phase-2-exit audit (S2-11) unless this PR happens to carry the `search.ts` change too. Recorded here so the traceability matrix does not silently drop AC6's removal clause. |

### EC-16: Existing method signatures unchanged (AC7 structural check)

| Field               | Value                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**           | AC7                                                                                                                                                                                       |
| **Category**        | API Versioning                                                                                                                                                                            |
| **Input / Setup**   | `pnpm typecheck` against every existing call site of `scroll`, `search`, `getById`, `getByDedupeKey`, `deleteById`, `deleteByFilter`, `upsert` in `src/commands/*.ts` and `src/lib/*.ts`. |
| **Expected Result** | Zero type errors — no existing call site needs an argument added/changed, confirming the new methods are additive-only to the class's public surface.                                     |
| **Pass Criteria**   | `pnpm typecheck` exits 0 with no diagnostics referencing `qdrant.ts`'s exported members outside the new methods.                                                                          |

---

## Randomized Tactics and Seed Policy

Seed format: `<tactic-type>-<AC-id>-<unix-timestamp>-<4-hex>`
Replay: `pnpm test -- --testPathPattern="qdrant" --seed=<captured-seed>`

Seeds **MUST** be recorded in the run log and in any failure report. On failure, follow the `verifier` Failure Triage Workflow (capture → replay → minimize → classify → report), with a maximum of 3 reproduction attempts before marking `inconclusive`.

### RT-1: Property — `scrollAll` pagination is order-preserving and `order_by`-free across random page topologies

| Field                  | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**              | AC2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Tactic type**        | property-based                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Input surface**      | Randomly generated page chains: random page count (0..12), random points-per-page (0..500, including empty pages), random `next_page_offset` token shapes (string, number, `null` only on the last page), random `batch` value (1..500) passed to `scrollAll`.                                                                                                                                                                                                                                                                                                               |
| **Property / Oracle**  | (1) No `client.scroll` call in the chain ever includes an `order_by` key. (2) Call `i`'s `offset` equals call `i-1`'s response `next_page_offset` exactly (or is absent for call 1). (3) `onPage` is invoked exactly once per generated page, strictly in generation order, with the exact points array from that page (no merging, no dropping, no reordering). (4) The loop terminates in exactly `pageCount` calls — never more, never fewer — for every generated topology, including `pageCount = 0` (an immediately-`null` first response yields zero `onPage` calls). |
| **Iterations**         | 500                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Seed**               | `prop-AC2-{timestamp}-{hex}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Replay instruction** | `pnpm test -- --testPathPattern="qdrant" --seed=<seed> --iterations=1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Shrink strategy**    | Reduce the page chain to the smallest page count that still violates a property, then reduce that page's point count to the smallest reproducing value.                                                                                                                                                                                                                                                                                                                                                                                                                      |

### RT-2: Fuzz/property — `batchSetPayload` chunking is size-correct and content-preserving across random op counts

| Field                  | Value                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC(s)**              | AC5                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Tactic type**        | property-based, boundary-biased                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Input surface**      | Random op-array lengths drawn from a distribution that over-samples the 256-multiple boundary: uniform 0..2000, plus a fixed boundary set (`0, 1, 255, 256, 257, 511, 512, 513, 767, 768, 769, 2000`) always included. Each op carries a distinct `id` so ordering/dedup violations are detectable.                                                                                                                                          |
| **Property / Oracle**  | (1) `client.batchUpdate` call count == `Math.ceil(n / 256)` for `n > 0`, `0` calls for `n = 0`. (2) Every chunk's `operations.length ≤ 256`. (3) Concatenating every chunk's `operations` in call order reproduces the original input array in original order exactly (no reordering, no duplication, no loss). (4) Every operation object has the shape `{ set_payload: { points: [id], payload } }`. (5) Every call includes `wait: true`. |
| **Iterations**         | 300 (random) + 12 (fixed boundary set, always run)                                                                                                                                                                                                                                                                                                                                                                                           |
| **Seed**               | `prop-AC5-{timestamp}-{hex}`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Replay instruction** | `pnpm test -- --testPathPattern="qdrant" --seed=<seed> --iterations=1`                                                                                                                                                                                                                                                                                                                                                                       |
| **Shrink strategy**    | Binary-search the op count toward the nearest 256-multiple boundary that still reproduces the violation; if content-order is the violation, shrink to the smallest prefix/suffix pair that still misorders.                                                                                                                                                                                                                                  |

---

## Execution Checklist

Pre-implementation (test-first — these should fail before code exists, per task 2.1/2.2 and the repo's test-first policy):

- [ ] Scaffold `tests/unit/lib/qdrant.test.ts` new `describe` blocks for `scrollAll`, `scrollOrdered`, `count`, `setPayload`/`batchSetPayload`, `fetchStalenessCorpus` with CT-1…CT-7 and EC-1…EC-16 as failing tests.
- [ ] Scaffold `tests/integration/lib/qdrant.test.ts` with SC-1 / CT-6 as failing tests.
- [ ] Add RT-1 and RT-2 property harnesses with seed capture wired in before `scrollAll`/`batchSetPayload` are implemented.

During implementation:

- [ ] SC-1 passes.
- [ ] CT-1 … CT-8 pass.
- [ ] EC-1 … EC-16 pass, with EC-5's error-type question and EC-10's cross-story dependency recorded as evidence (not blocking) per **F-1** and AC6's documented either-order allowance.
- [ ] RT-1, RT-2 executed; seeds recorded in the run log.

Quality gates:

- [ ] `pnpm test -- --testPathPattern="qdrant"` — targeted green.
- [ ] `pnpm test`, `pnpm run lint`, `pnpm run format:check`, `pnpm run typecheck`, `pnpm audit` (full gate per AGENTS.md/CLAUDE.md before PR-ready).
- [ ] Manual: run any command against a pre-existing v1.2.0 collection; confirm `getCollection().payload_schema` lists the 12 new indexes; second run logs "no missing indexes" under `MEMO_DEBUG` (per the story's Manual/UI Testing note).
- [ ] `docs/data-model.md` index table and `docs/technical-guidelines.md` adapter method list updated (task 2.15).

Negative-space checks (non-goals stay untouched):

- [ ] No command file imports `@qdrant/js-client-rest` directly.
- [ ] `scroll()`'s hard-coded `order_by: timestamp_utc desc` is unchanged.
- [ ] No payload migration/backfill code is introduced — indexes only.
- [ ] `src/lib/ranking.ts` untouched.
- [ ] Existing `tests/unit/lib/qdrant.test.ts` / `tests/integration/lib/qdrant.test.ts` test bodies are not edited, only extended (CT-8's pass criterion).

---

## Recommendations

| #   | Finding                                                                                                                             | Owner                 | Recommended action                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **F-1** (EC-5) — the error _type_ propagated by a mid-`scrollAll` client failure is unspecified by AC2/AC5                          | `product-engineer`    | Confirm whether `scrollAll` should wrap the propagated error as `MemoError('QDRANT_OPERATION_FAILED', ...)` (consistent with every other method) or intentionally let the raw client error surface, and state it explicitly. |
| 2   | EC-10 — `fetchByRepo` removal is a cross-story (S2-02/S2-05) dependency, not fully verifiable from this PR alone                    | `developer`/`planner` | Track EC-10 to closure at the S2-11 Phase 2 exit gate rather than this story's PR, per AC6's explicit "either order" allowance.                                                                                              |
| 3   | Timing & Concurrency (N/A) — `ensureIndexes` has no new-in-this-story concurrency guarantee against simultaneous `memo` invocations | `product-engineer`    | Consider whether a future story should harden `ensureIndexes` against a `createPayloadIndex`-already-exists race if multi-process concurrent `memo` usage becomes a supported scenario.                                      |

---

## Output Contract

| Field                  | Value                                                                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mode**               | Design                                                                                                                                                                                                           |
| **Phase**              | 4 — Reporting & Publication (complete)                                                                                                                                                                           |
| **Source artifact**    | `workstream/user-stories-prd-004-phase-2.md` (Story S2-02)                                                                                                                                                       |
| **Artifacts produced** | `workstream/test-plan-issue-81.md`, `workstream/traceability-matrix-issue-81.md`                                                                                                                                 |
| **GitHub issue**       | [#81](https://github.com/llipe/memo-cli/issues/81)                                                                                                                                                               |
| **AC coverage**        | 7/7 addressed. AC1 covered by an E2E + contract + edge triad; AC2–AC7 covered by contract + edge (no CLI-facing E2E surface exists yet — see E2E Scope Note).                                                    |
| **Scenario counts**    | 1 E2E, 8 contract, 16 edge-case, 2 randomized                                                                                                                                                                    |
| **Blocking gaps**      | None for design. One item requires `product-engineer` clarification before a firm pass/fail verdict on EC-5: **F-1**. One item (EC-10) is intentionally deferred to the Phase 2 exit gate per AC6's own wording. |
