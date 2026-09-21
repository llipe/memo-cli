# Test Plan — Issue #84 (Story S2-05)

**Read-side flags on `search`, `list`, `tags`, `read`, and bank-aware staleness**

- Repository: `llipe/memo-cli`
- GitHub Issue: [#84](https://github.com/llipe/memo-cli/issues/84)
- PRD: `docs/requirements/prd-004-long-lived-agent-memory.md` — Phase 2 AC-2.3, AC-2.4
- Spec: `workstream/specification-prd-004-long-lived-agent-memory.md` §18.7, decision A12
- Story: `workstream/user-stories-prd-004-phase-2.md` — Story S2-05 (AC1–AC9)
- Task list: `workstream/tasks-prd-004-phase-2-plan.md` — task 5.0 (5.1–5.27)
- Mode: **Design** (pre-implementation; S2-02/S2-03 dependencies not yet landed in the codebase at the time of this plan)
- Verifier phase: 3 — Test Design (black-box)

> Changelog: 2026-09-21 — initial test plan for issue #84 (verifier Design Mode).

---

## 1. Source Input Summary

Story S2-05 adds five shared read-side flags (`--bank`, `--kind`, `--session`, `--include-archived`, `--include-superseded`, `--as-of`) to `search`, `list`, `tags list`, and (a subset) `read`, funnels them through one new pure parser (`src/lib/read-flags.ts`), and threads one shared `base` filter through every candidate-producing call in `search.ts` (dense query, lexical scroll, and the renamed `fetchStalenessCorpus`). It is explicitly **read-only** — no migration, no write path, no ranking/scoring change. Two PRD-level ACs are carried by this story and are non-negotiable regression gates:

- **AC-2.3** (identical default results) — mapped to story AC2.
- **AC-2.4** (bank isolation) — mapped to story AC3.

This story's own dependencies (S2-02 `QdrantRepository` extensions/indexes, S2-03 `bank.ts`/`filters.ts`/`buildBaseFilter`) had not landed in the codebase as of this plan's authoring; `src/commands/search.ts` and `src/commands/list.ts` were read as they exist today (Phase 1 shipped state) purely to ground filter-sharing and staleness-corpus assertions in the _current_ call shapes that S2-05 must preserve or replace.

## 2. Acceptance Criteria Extraction

| AC  | Statement (paraphrased)                                                                                                                                                      | PRD linkage |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| AC1 | `search`/`list`/`tags list`/`read` accept the six shared flags; invalid `--kind` or non-ISO `--as-of` fail `VALIDATION_FAILED`; `read` accepts only the two include-* flags. | —           |
| AC2 | With no new flags, `search`/`list` return exactly the v1.2.0 entry set — replay test through the v2 filter path.                                                             | **AC-2.3**  |
| AC3 | `search --bank a-memory` never returns `b-memory` entries and vice versa.                                                                                                    | **AC-2.4**  |
| AC4 | Dense query, lexical scroll, and staleness corpus share one base filter; `fetchStalenessCorpus({ bank, repos })` replaces `fetchByRepo` (which no longer exists).            | A12         |
| AC5 | `--kind self` returns unranked, newest-first, no `final_score`; `self` never enters `rankResults` otherwise.                                                                 | —           |
| AC6 | Included archived/superseded entries are prefixed in human output and flagged `archived`/`superseded` in JSON.                                                               | —           |
| AC7 | `--as-of <date>` filters on `valid_from <= date` and (`valid_to` absent or `> date`); implies `--include-superseded`.                                                        | —           |
| AC8 | JSON results/list rows gain v2 fields from `normalizeEntry`; envelope `filters` gains `bank`/`kind`/`session?`/`as_of?`; no existing key changes.                            | —           |
| AC9 | `read --id` prints every v2 field present; provenance is one `scroll({ has_id })` call, missing ids suffixed `(deleted)`; JSON `provenance: [{ id, deleted }]`.              | —           |

Business rules extracted (apply across all AC test design):

- BR1: Defaults — `bank` per B3, `kind = all minus self`, archived/superseded excluded (FR-2.4).
- BR2: No cross-bank search exists (B4) — `--bank` is single-valued, not a list.
- BR3: Ranking, tiers, staleness thresholds, and lexical matching are untouched by this story — only candidate _sets_ change, never scores.

Non-goals (explicitly out of scope, confirmed against the story's Migration Requirements section): no `memo migrate` involvement; v1 points (no `bank`/`schema_version`) pass the default filter via `is_empty` and are not migrated by this story.

---

## 3. E2E Scenarios (`activity-e2e-test-design`)

Black-box, CLI-in/CLI-out. Each scenario names the command line, preconditions on the mocked/seeded repository, and the observable assertion (stdout shape, exit code, JSON envelope).

### E2E-1 — Default search, no new flags (AC2 / AC-2.3 support)

- **Given** a repository seeded with the Phase 1 `candidates.json` id set (or an equivalent v1-shaped fixture with no `bank`/`kind`/`archived`/`superseded` fields).
- **When** `memo search "<eval query>"` is run with no `--bank`/`--kind`/etc.
- **Then** the returned id set and order are byte-identical to the v1.2.0 recorded output for that query.
- **Exit code:** 0.

### E2E-2 — Two-bank isolation on `search` (AC3 / AC-2.4)

- **Given** two banks, `a-memory` and `b-memory`, each seeded with at least one semantically similar entry to the query.
- **When** `memo search "<query>" --bank a-memory --json` is run.
- **Then** `results[].bank` is `a-memory` for every row; no `b-memory` id appears; repeat with `--bank b-memory` and assert the symmetric exclusion.
- **Exit code:** 0.

### E2E-3 — Two-bank isolation on `list`

- Same as E2E-2 but via `memo list --bank <id> --json`, confirming isolation is not search-pipeline-specific (`list` uses `scroll`, not `search`).

### E2E-4 — `--kind self` unranked path (AC5)

- **Given** a bank with three `self` entries at different timestamps and no ranking-relevant fields populated.
- **When** `memo search "<query>" --kind self --json` is run.
- **Then** `results` are ordered strictly by `timestamp_utc` descending, `final_score` is absent from every result object, and no `similarity`/`confidence_tier` fields computed by `rankResults` appear.

### E2E-5 — Archived/superseded inclusion toggles (AC6)

- **Given** a bank with one active, one archived, and one superseded entry, all otherwise matching the query.
- **When** `memo search "<query>" --include-archived --include-superseded` (human mode) is run.
- **Then** the archived entry's line is prefixed `[archived]`, the superseded entry's line is prefixed `[superseded]`, and the active entry has neither prefix.
- **And** the same query with `--json` sets `archived: true` / `superseded: true` on the respective result objects and omits both keys (not `false`) on the active entry — confirm against AC8's "no existing key changes" by diffing the full key set against a pre-story fixture.

### E2E-6 — `--as-of` point-in-time query (AC7)

- **Given** an entry with `valid_from = 2025-01-01`, `valid_to = 2025-06-01`, and its superseding entry with `valid_from = 2025-06-01`.
- **When** `memo search "<query>" --as-of 2025-03-01` is run.
- **Then** only the first entry is returned (superseded implicitly included, but the successor is excluded because its `valid_from > as_of`).
- **When** `memo search "<query>" --as-of 2025-09-01` is run.
- **Then** only the successor entry is returned.

### E2E-7 — `read --id` v2 fields and provenance (AC9)

- **Given** a semantic entry whose `provenance` array contains two ids, one of which has been deleted from the store.
- **When** `memo read --id <id>` (human mode) is run.
- **Then** every v2 field present on the entry is printed, and the provenance line for the deleted id is suffixed `(deleted)`.
- **And** `memo read --id <id> --json` gives `provenance: [{ id, deleted: false }, { id, deleted: true }]`, and exactly one `scroll({ has_id: [...] })` call was made against the mocked repository (assert on the mock call count, not just output — this is the one grey-box-adjacent assertion permitted in an otherwise black-box E2E scenario per AC9's explicit call-count contract).

### E2E-8 — Validation failures (AC1)

- `memo search "<query>" --kind bogus` → exit 1, `VALIDATION_FAILED`.
- `memo search "<query>" --as-of not-a-date` → exit 1, `VALIDATION_FAILED`.
- `memo read --id <id> --bank a-memory` → exit 1, `VALIDATION_FAILED` (an id is explicit; `read` does not accept bank/kind/session/as-of).
- `memo read --id <id> --include-archived` → exit 0 (this is the one pair `read` does accept).

### E2E-9 — `tags list` bank scoping and empty bank

- `memo tags list --bank <private>` on an empty bank → exit 0, `count: 0` (or equivalent empty envelope), not an error.

---

## 4. Contract Validation Scenarios (`activity-contract-test-design`)

Focus: the JSON envelope contract for `search`, `list`, `read`, and the filter-shape contract passed to the repository layer (consumer = command handler, provider = `QdrantRepository`/mocked repo).

### CT-1 — Additive-only envelope diff (AC8)

- Capture the full JSON key set of `memo search --json` and `memo list --json` on a pure v1-shaped fixture (no v2 flags used) both **before** this story (recorded fixture, e.g. from `tests/fixtures/relevance/candidates.json`-derived expectations) and **after** implementation.
- Assert: `before keys ⊆ after keys` is false as the primary test — instead assert `after keys ⊇ before keys` AND every key present in `before` has an unchanged type/value for the same input. New keys (`bank`, `kind`, `session_id?`, `seq?`, `valid_from?`, `valid_to?`, `superseded_by?`, `archived?`, `pinned?`) are permitted only as _additions_.
- This is a schema-compatibility (consumer-driven) style check: any hand-written downstream consumer (dev-tasks per §18.12) that only reads pre-existing keys must not observe a breaking change.

### CT-2 — `filters` envelope contract on `search`/`list`

- `memo search "<query>" --bank a --kind semantic --session s-1 --as-of 2025-01-01 --json` → `filters.bank = "a"`, `filters.kind = "semantic"`, `filters.session = "s-1"`, `filters.as_of = "2025-01-01T00:00:00.000Z"` (or the exact normalized ISO the parser emits — pin the exact string format as part of this test, since spec 18.7 does not state normalization behavior explicitly and it is a likely drift point).
- Confirm `filters` omits `session`/`as_of` keys entirely when not supplied (mirrors the existing `tags`/`entry_type`/`source` omit-when-empty convention already used in `search.ts`/`list.ts`).

### CT-3 — Shared base-filter shape across dense/lexical/staleness (AC4)

- Intercept (mock) the three call sites in `search.ts`: `qdrant.search(vector, filters, ...)`, `qdrant.scroll(lexicalFilter, ...)` (when identifiers are present), and `qdrant.fetchStalenessCorpus({ bank, repos }, ...)`.
- Assert the `bank`/`kind`/`session`/`archived`/`superseded`/`as_of` predicate clauses embedded in `filters` and `lexicalFilter`'s nested base are structurally identical to the base filter object passed to `fetchStalenessCorpus`'s `bank` argument (same bank scoping) — i.e., there is exactly one filter-construction code path (`base`), not three independently-maintained ones that could drift.
- Assert `fetchByRepo` is not present anywhere in the compiled call graph (a static grep-based check plus the mock never registering a `fetchByRepo` invocation) — this is the AC4 "no longer exists" contract, checked both as an API-shape assertion (TypeScript compile: `qdrant.fetchByRepo` is a type error) and a runtime call-count assertion (0 calls).

### CT-4 — Two-bank isolation as a provider contract (AC3 / AC-2.4)

- Provider contract: for any `base` filter constructed with `bank = X`, the resulting Qdrant filter object MUST include a `must` clause pinning `bank == X` (or the v1-compatible `is_empty`/absent equivalent for `bank = kb`) and MUST NOT include `X`'s sibling bank in any `should`/`min_should` clause that could produce a false match.
- Verified two ways per AC3's own wording: (a) unit-level filter-shape assertion on the mocked repository (fast, deterministic), and (b) one integration test against the mocked repository seeded with two banks' worth of near-duplicate vectors, confirming no cross-bank leakage end-to-end. Manual verification on `memo_eval` is out of scope for this automated contract test and is tracked separately in the Execution Checklist.

### CT-5 — `read` provenance call-shape contract (AC9)

- Provider contract: `read.ts` issues **exactly one** `scroll({ has_id: [...] })` call regardless of provenance array length (capped at the array length per Technical Notes), never one `getById`-per-id loop. Assert via mock call count = 1 and the `has_id` array equals the full provenance id list.

---

## 5. Edge-Case Catalog (`activity-edge-case-refinement`)

Categorized per the standard taxonomy (input domain, state transition, timing, idempotency, failure modes, auth/permissions, data boundaries, resource exhaustion, API versioning).

| ID    | Category            | Scenario                                                                                              | Expected behavior                                                                                                                                                                 | AC                         |
| ----- | ------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| EC-1  | Input domain        | `--kind` value outside `self\|episodic\|semantic\|all` (e.g. `--kind Self`, case mismatch)            | `VALIDATION_FAILED`, exact-match validation (no case-folding assumed unless spec says so — flag as a question).                                                                   | AC1                        |
| EC-2  | Input domain        | `--as-of` with a valid calendar-invalid date (`2025-02-30`) or a non-ISO-8601 string (`03/01/2025`)   | `VALIDATION_FAILED`.                                                                                                                                                              | AC1                        |
| EC-3  | Input domain        | `--as-of` with a bare date (`2025-03-01`, no time component) — is this valid ISO 8601 date-only form? | Must resolve one way; test locks in whichever the implementation picks (flag as an ambiguity to confirm with `product-engineer` if spec silent).                                  | AC1/AC7                    |
| EC-4  | State transition    | `--kind all --include-archived` on a bank containing **only** archived entries                        | Returns the archived entries (not empty) with `archived: true`; without `--include-archived` the same bank returns empty, not an error.                                           | AC6, AC21-style regression |
| EC-5  | Timing / boundary   | `--as-of` set to a future ISO date beyond every entry's `valid_from`                                  | Returns the latest-valid entries as of "now-equivalent" future date (i.e., every currently-valid entry, since none has a later `valid_to`). Not empty.                            | AC7                        |
| EC-6  | Timing / boundary   | `--as-of` set before every entry's `valid_from`                                                       | Empty result set, exit 0 (not an error).                                                                                                                                          | AC7                        |
| EC-7  | Timing / boundary   | `--as-of` exactly equal to an entry's `valid_from` (inclusive boundary, `<=`)                         | Entry is included.                                                                                                                                                                | AC7                        |
| EC-8  | Timing / boundary   | `--as-of` exactly equal to an entry's `valid_to` (exclusive boundary, `>` required)                   | Entry is **excluded** at the exact boundary instant — this is the sharpest edge in AC7's spec and the single highest-risk off-by-one in this story.                               | AC7                        |
| EC-9  | State transition    | `--session` on `search` with `--kind semantic` (sessions only apply to episodic entries)              | Valid combination, returns empty (semantic entries never carry `session_id`), not `VALIDATION_FAILED`.                                                                            | AC1                        |
| EC-10 | API versioning      | `read` on a v1 point (no `schema_version`, no `bank`, no v2 fields at all)                            | Normalized fields are shown per `normalizeEntry`'s v1-fallback behavior (e.g., `bank` defaults to `kb`, `kind` defaults per BR1); no crash on missing fields.                     | AC9                        |
| EC-11 | Data boundary       | `tags list --bank <private>` on an empty bank                                                         | Exit 0, empty facet list — not `ENTRY_NOT_FOUND` or a bank-existence error (banks are not pre-registered entities in Phase 2).                                                    | AC1                        |
| EC-12 | Failure mode        | `read --id <id> --bank a-memory` (disallowed flag combination on `read`)                              | `VALIDATION_FAILED` — `read`'s id is explicit and disambiguation flags are rejected, not silently ignored.                                                                        | AC1                        |
| EC-13 | Idempotency         | Running the same `search`/`list` query twice with identical flags against an unchanged store          | Byte-identical result sets both times (no hidden nondeterminism introduced by the new filter-merge logic, e.g. `Set`/object key ordering leaking into output order).              | AC2, AC4                   |
| EC-14 | Resource exhaustion | Provenance array on `read` with a large number of ids (e.g. 200)                                      | Still exactly one `scroll({ has_id })` call, capped per Technical Notes — not batched into multiple calls, not silently truncated without a documented cap.                       | AC9                        |
| EC-15 | Data boundary       | An entry with `valid_from` present but `valid_to` absent (still open-ended / current)                 | Satisfies the `valid_to` absent OR `> date` disjunct — included for any `--as-of >= valid_from`.                                                                                  | AC7                        |
| EC-16 | State transition    | `--as-of` supplied without `--include-superseded` explicitly                                          | `--as-of` implies `--include-superseded` per AC7 — confirm the implied flag does not also imply `--include-archived` (these are independent toggles; only superseded is implied). | AC7                        |

---

## 6. Randomized Test Tactics (`activity-random-test-tactics`)

**Target:** the filter builder shared by `search`/`list`/`tags` (the `base` filter assembled from `--bank`/`--kind`/`--session`/`--include-archived`/`--include-superseded`/`--as-of`), fuzzed against randomized flag combinations to catch filter-shape drift that hand-written scenarios miss.

### RT-1 — Randomized bank × kind combination matrix

- **Generator:** for each of N=200 iterations, sample `bank ∈ {kb, a-memory, b-memory, undefined}`, `kind ∈ {self, episodic, semantic, all, undefined}`, `includeArchived ∈ {true, false}`, `includeSuperseded ∈ {true, false}`, `asOf ∈ {undefined, a fixed past ISO, a fixed future ISO}`.
- **Property under test:** the resulting filter, evaluated in-memory against a fixed synthetic corpus of ~50 entries spanning all banks/kinds/archived/superseded/valid-time states, never returns an entry whose `bank` differs from the requested `bank` (when `bank` is set), never returns `kind = self` unless `kind` is exactly `self`, never returns an archived entry unless `includeArchived` (or the implied form via a future business rule) is set, and never returns a superseded entry unless `includeSuperseded` or `asOf` is set.
- **Reproducibility:** seed the PRNG explicitly (e.g. `seedrandom` or a documented xorshift with a fixed integer seed logged at test start); on failure, print the seed and the exact sampled flag tuple so the failing case can be replayed as a fixed unit test. Follow the Failure Triage Workflow (capture → isolate → minimize → classify → report) for any failure found in this run.
- **Seed policy:** CI runs with a fixed seed (e.g. `42`) for determinism; an optional nightly/manual run uses `Date.now()` as the seed and logs it, per standard random-tactics practice, to gain broader coverage over time without sacrificing CI determinism.

### RT-2 — Randomized flag combination against the `--kind self` ranking exclusion (AC5)

- **Generator:** for each iteration, sample a random subset of entries as `self` vs. non-`self`, and a random `kind` flag value.
- **Property under test:** `self` entries appear in `rankResults`'s input set if and only if `kind === 'self'`; equivalently, for every `kind` other than `self`, the ranked output set has zero overlap with the `self`-tagged synthetic ids.
- **Reproducibility:** same seed-log-and-replay discipline as RT-1.

### RT-3 — Randomized `--as-of` boundary sampling (complements EC-5..EC-8)

- **Generator:** for each iteration, sample a random `as_of` instant uniformly within ±2x the synthetic corpus's `valid_from`/`valid_to` range (deliberately oversampling near boundaries — not uniform over the whole range — since boundary instants are the highest-risk region per EC-8).
- **Property under test:** for every entry, `included ⟺ (valid_from <= as_of) && (valid_to === undefined || valid_to > as_of)` — a direct oracle re-implementation checked against the command's actual filter output.
- **Reproducibility:** seed logged; minimized failing `as_of` value reported to the nearest millisecond.

---

## 7. AC2 / AC-2.3 Regression-Gate Test Design (special weight)

AC2 carries a phase-level PRD acceptance criterion and is explicitly named in the story as the test that "must not [be] weaken[ed] or delete[d] to make it pass" (task 5.12). This plan designs it as a **before/after identity assertion against the recorded `candidates.json`**, not a freshly-authored test that could pass for the wrong reason (e.g., by asserting a property so weak that any output satisfies it, or by asserting against a newly-recorded "after" baseline instead of the original Phase 1 recording).

- **Fixture of record:** `tests/fixtures/relevance/candidates.json` (per-query raw candidate lists, pre-ranking) and `tests/fixtures/relevance/baseline.json` (recorded `overall_top3`/`by_category` floor) — both already committed from Phase 1 and MUST NOT be regenerated as part of landing this story. Regenerating either file to make the identity test pass is itself a Critical-severity audit finding to watch for in the later Audit Mode pass.
- **Today's replay path (`tests/relevance/replay.test.ts`):** feeds `candidates.json` directly into `rankResults` with no filter step at all — this is a ranking-identity guard, not a filter-identity guard, and by itself is **insufficient evidence for AC2**, which is specifically about the _filter path_ introduced by this story.
- **Required extension (not yet present in the codebase — a gap this test plan flags for the developer):** the replay test must additionally route each `candidates.json` entry's payload through the same `base`-filter predicate that `search.ts`/`list.ts` will apply at query time (constructed with **no flags supplied**, i.e., the default/v1-compatible `base`), and assert:
  1. Every id present in the recorded Phase 1 top-N for a query is **still present** after the v2 filter is applied (no false exclusion — the filter must not silently drop v1-shaped payloads that lack `bank`/`kind`/`archived`/`superseded` fields, per the `is_empty` fallback in Migration Requirements).
  2. No id **absent** from the recorded Phase 1 top-N is newly introduced by the filter step for the same query (no false inclusion).
  3. The exact **ordering** of the top-N is unchanged (ranking is untouched per BR3 — an identity check on the ordered id array, not just set-membership, is required so a reordering bug cannot hide behind a set-equality assertion).
- **Before/after evidence requirement carried into the DoD:** the task list (5.12, DoD checklist) already requires "AC-2.3 identity evidence (before/after ids) in the PR body" — this test plan's traceability matrix maps AC2 to that evidence explicitly so `verifier` Audit Mode can check the PR body artifact exists, not just that a test file exists.
- **Failure classification:** if this test fails after implementation, it is presumptively an **implementation defect** (filter path excludes or reorders previously-returned v1 entries) rather than a spec gap — the spec's AC-2.3 guard language in §18.7 is unambiguous about the intended base-filter shape for `kb`/`all` defaults.

---

## 8. AC3 / AC-2.4 Two-Bank Isolation Coverage (explicit E2E + contract)

Per instruction, AC3 receives explicit coverage in both `activity-e2e-test-design` (E2E-2, E2E-3 above) and `activity-contract-test-design` (CT-4 above), plus the randomized RT-1 tactic as a fuzz backstop. Layering summary:

| Layer                           | Test ID         | Confirms                                                                                                       |
| ------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| E2E (black-box)                 | E2E-2, E2E-3    | Observable CLI output never crosses banks, on both `search` and `list`.                                        |
| Contract (grey-adjacent)        | CT-4            | The filter object itself structurally pins `bank`, independent of output.                                      |
| Randomized                      | RT-1            | No flag combination (not just the two hand-picked banks) leaks across banks.                                   |
| Manual (tracked, not automated) | story 5.13/5.20 | `memo_eval` live verification — out of this plan's automation scope, tracked in the Execution Checklist below. |

---

## 9. Execution Checklist

- [ ] `pnpm test -- --testPathPattern="read-flags|search|list|tags|read|replay"` — all new/updated unit and integration suites green.
- [ ] `tests/relevance/replay.test.ts` extended per §7 — confirm it **fails before** the S2-05 filter-path code exists (per task 5.2) and **passes after**, with both failure and pass runs captured as PR-body evidence.
- [ ] `pnpm run eval:relevance` (live, optional) — confirms the 96.4% floor still holds with v2 filters wired in.
- [ ] `pnpm run validate` — full quality-gate run (`lint`, `format:check`, `typecheck`, `test`, `audit`).
- [ ] Manual on `memo_eval` (tracked, not automated by this plan): `memo search "<eval query>"` before/after this story produce identical ids; write to two private banks and search each; `memo read --id` on a semantic entry whose provenance names a deleted id.
- [ ] Randomized suites (RT-1..RT-3) run with a fixed CI seed; seed and any failing tuple logged per the Failure Triage Workflow.
- [ ] No test in this plan touches `memo migrate` or any data-migration path — confirmed out of scope per the story's Migration Requirements ("not required — read-only").

---

## 10. Open Questions / Ambiguities Flagged for `product-engineer`

- EC-1: is `--kind` validation case-sensitive? Spec/story text does not say. Recommend locking exact-match-only unless `product-engineer` specifies otherwise.
- EC-3: does `--as-of` accept a date-only ISO form (`YYYY-MM-DD`) or strictly full timestamp ISO 8601? Spec §18.7 says "validated against ISO 8601" without narrowing to a subset — the test plan locks in whichever the implementation picks but flags the ambiguity now so it is a deliberate choice, not an accident.
- EC-16: confirm `--as-of` implies **only** `--include-superseded`, never `--include-archived` (story text says so explicitly; test plan encodes this as a hard boundary so a future refactor cannot silently widen the implication).
