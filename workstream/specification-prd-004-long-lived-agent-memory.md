# Specification — PRD-004 Long-Lived Agent Memory

## Changelog

| Version | Date       | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Author           |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1.2     | 2026-09-21 | Phase 2 implementation depth (new §18) grounded on the merged Phase 1 codebase (v1.2.0): schema v2 field-by-field with read-side normalization; config v2 `schema_version` widened to `'1' \| '2'`; `QdrantRepository` extensions with the `order_by`-vs-`offset` pagination constraint made explicit; bank-aware staleness corpus; write path v2 step list incl. `--supersedes` two-step failure semantics and the `self` soft cap; `timeline`, `recall`, `bank`, `migrate` command internals; `--rules` file shape; cross-repo partition for the dev-tasks consumer story; delivery slicing. Decisions A10–A14. Resolves PRD §18 Q1 (private episodic purge default stays **on**, 30 d) and Q5 (`self` soft cap **50**, configurable, warning-only), and spec §17 Q1/Q2. Query snapshots moved to Phase 3. `TESTING.md` reference updated (filled in Phase 1). | product-engineer |
| 1.3     | 2026-09-21 | Drift reconciliation from the 11 Phase 2 `verifier` Design Mode test plans (#53, #81–#90): new §18.14 resolves every open question those plans raised — `normalizeEntry` timestamp handling, `--kind` case-insensitivity and `--as-of` date-only acceptance (both human-confirmed), soft-cap/`--supersedes` error codes, `bank init --set-default` idempotency, `bank`/`inspect` facet independence, migration rule/bank-preservation semantics, `recall`'s `bank=kb` JSON shape, and the S2-11 eval scope — so no story starts implementation against an ambiguous spec. Corrects an `aggregateField` call-order error in §18.10 against the shipped `(field, scroll)` signature. This is gap-filling on top of §18.1–§18.13, not a behavioral change.                                                                                                          | product-engineer |
| 1.1     | 2026-09-19 | Phase 1 stories: staleness annotation renamed `stale_by`; eval collection isolated via `MEMO_COLLECTION`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | product-engineer |
| 1.0     | 2026-09-19 | Initial specification for PRD-004 v1.3. Covers all five phases; Phases 1–3 at contract depth, Phases 4–5 at design depth.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | product-engineer |

## 1. Executive Summary

PRD-004 is implemented as an additive v2 of the existing single-collection design: new indexed payload fields (`bank`, `kind`, session, validity, retention counters, archive state), a set of pure libraries (`ranking`, `lexical`, `retention`, `lifecycle`, `recall`, `migrate`, `consolidate`) that hold every rule from PRD-004 §2.4–§2.6 and §8, and thin Commander commands over them. `QdrantRepository` gains index reconciliation, paginated scroll, vector-bearing scroll, and batched payload updates; nothing else touches Qdrant. Local state that must survive processes (query snapshots, usage events, tombstones) lives as JSON lines under `~/.memo/`.

## 2. Reference Documents

- PRD: [`docs/requirements/prd-004-long-lived-agent-memory.md`](../docs/requirements/prd-004-long-lived-agent-memory.md) v1.12. §2.4–§2.6 (banks, kinds, deletion contract) and §8.2 (ranking) are normative.
- Phase 1 delivery record: `workstream/user-stories-prd-004-phase-1.md`, `workstream/tasks-prd-004-phase-1-plan.md`, `workstream/fidelity-report-prd-004-phase-1-rollup.md` (merged as PR #74, released v1.2.0). §18 of this spec is written against that merged codebase.
- Testing contract: `/TESTING.md` (filled in Phase 1 by S1-08).
- Superseded PRD: `docs/requirements/prd-002-search-ranking-retrieval.md` (history only).
- Ranking refinement: `workstream/issue-34-composite-ranking-score-refinement.md` (decisions D1–D9, defects DEF-1/DEF-2 still apply).
- Technical guidelines: `docs/technical-guidelines.md` §3 (patterns, no global state), §4 (CLI/output/exit codes/error catalog), §7 (data), §8 (integration, retry), §11 (testing), §12 (quality).
- Current data model: `docs/data-model.md`. Current flows: `docs/system-overview.md`.
- Consumer skill: `dev-tasks/.claude/skills/memo-cli-usage/SKILL.md` and agent prompts under `dev-tasks/.claude/agents/`, `dev-tasks/.claude/commands/`.

## 3. Affected Repositories

| Repository        | Role                            | Scope of Changes                                                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `llipe/memo-cli`  | CLI, storage adapter, all logic | Schema v2 (`src/types/entry.ts`, `src/types/config.ts`); new libs under `src/lib/`; new commands under `src/commands/`; `QdrantRepository` extensions; `~/.memo/` local store; eval harness under `tests/fixtures/relevance/` and `scripts/`; docs (`README.md`, `docs/*.md`).                    |
| `llipe/dev-tasks` | Consumer prompts and skill      | `memo-cli-usage` SKILL.md and REFERENCE.md; `developer`, `technical-writer` agents; `product-engineer`, `planner` commands: bank id per agent definition, `memo recall` at start, episodic writes to the agent bank, `memo used` and `memo decay` at close. Shipped with memo-cli Phases 2 and 3. |

## 4. System Architecture

The component diagram shows the target layering. Commands stay thin; every rule lives in a pure library; only `QdrantRepository` and `LocalStore` perform I/O.

```mermaid
flowchart TB
  subgraph Callers
    H["Human (TTY)"]
    A["Agent harness (dev-tasks)\nMEMO_BANK=<bank>"]
  end
  subgraph CLI["memo-cli (src/)"]
    subgraph Cmds["commands/"]
      C1["write · search · list · tags · read · delete · inspect · setup (extended)"]
      C2["recall · timeline · bank · migrate (Phase 2)"]
      C3["used · decay · forget · restore · stats (Phase 3)"]
      C4["consolidate (Phase 4)"]
      C5["link · unlink · reindex-links · ask (Phase 5)"]
    end
    subgraph Libs["lib/ (pure unless noted)"]
      L1["ranking.ts · lexical.ts · staleness.ts"]
      L2["bank.ts · filters.ts · recall.ts · migrate.ts"]
      L3["retention.ts · lifecycle.ts · local-store.ts (I/O)"]
      L4["consolidate.ts · llm.ts"]
      L0["qdrant.ts (I/O) · embeddings.ts · config.ts · output.ts · errors.ts"]
    end
  end
  subgraph External
    Q[("Qdrant\ncollection: decisions")]
    E["Embeddings API\n(OpenAI / Ollama)"]
    LLM["LLM API\n(OpenAI-compatible)"]
    FS[("~/.memo/\nqueries/ · usage.jsonl · forget.jsonl")]
  end
  H --> Cmds
  A --> Cmds
  Cmds --> Libs
  L0 --> Q
  L0 --> E
  L4 --> LLM
  L3 --> FS
```

### Key architectural decisions

| #   | Decision                                                                                                                                                                     | Rationale                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | One collection; `bank` and `kind` are indexed payload keywords.                                                                                                              | Reuses `deleteByFilter`, facets, and filter builders; free-tier cost; PRD §12.                                                                                    |
| A2  | Boolean mirrors for state: `archived`, `superseded`, `consolidated`, `pinned` are indexed booleans; datetimes (`archived_at`, `valid_to`, `consolidated_at`) carry the when. | Qdrant filters on booleans are exact and index-backed; avoids `is_null` semantics on v1 points. `must_not archived=true` passes points lacking the field.         |
| A3  | Every rule is a pure function with injected `now` and returns a plan (`{ archive: [...], purge: [...] }`); commands execute plans.                                           | Deterministic, table-driven tests; `--dry-run` is "print the plan".                                                                                               |
| A4  | Lexical matching is an additive boost in the unified formula, not reciprocal rank fusion.                                                                                    | Qdrant `text` indexes give boolean token matches, not BM25 scores; a second ranked list would be synthetic. Candidate union + boost keeps one formula.            |
| A5  | Retention-based archive applies to `semantic` only; `episodic` archives on expiry or promotion.                                                                              | With `expires_at` already bounding episodes, a second clock adds no value and risks archiving "last session" before the next session.                             |
| A6  | `stability_since` anchors the retention clock for entries never retrieved.                                                                                                   | Without it, migration would compute a year of decay for legacy decisions and archive them on the first `memo decay`.                                              |
| A7  | Dedupe applies per kind: semantic keeps the story/commit key, episodic adds `seq`, `self` bypasses dedupe.                                                                   | A session writes many episodes with identical repo/story/source; the v1 key would flag every one as a duplicate.                                                  |
| A8  | Query snapshots and logs are local JSON lines, not Qdrant points.                                                                                                            | Cheap, append-only, replayable, and keeps Qdrant to memories only. Cross-machine `memo used` is out of scope.                                                     |
| A9  | The only LLM consumer is `memo consolidate` (and `memo ask` in Phase 5); both go through one `LLMAdapter`.                                                                   | PRD §7 cost discipline; adapter pattern from technical guidelines §8.                                                                                             |
| A10 | Stored payloads are never Zod-parsed on read; a pure `normalizeEntry()` fills v1 gaps (`bank = kb`, `kind = semantic`, booleans `false`) at the read boundary.               | Matches the shipped read paths (`search`/`list`/`read` pass payloads through untyped); keeps v1 points and 1.2.x rollback working without a migration.            |
| A11 | Two scroll modes on `QdrantRepository`: ordered (`order_by`, no `offset`) for bounded reads; unordered (`next_page_offset`) for `scrollAll`.                                 | Qdrant rejects `offset` together with `order_by`; the shipped `scroll()` hard-codes `order_by: timestamp_utc desc`, so full-collection passes need a second path. |
| A12 | Staleness corpus becomes bank-aware (`fetchStalenessCorpus({ bank, repos })`).                                                                                               | The shipped `fetchByRepo` filters on `repo` only; unchanged, a private bank's results would be compared against `kb` entries and flagged stale by them.           |
| A13 | `memo bank init` writes `config.bank.default` only with `--set-default`; otherwise it touches Qdrant only.                                                                   | An agent harness must be able to create its bank without mutating the repo's committed `memo.config.json`; `MEMO_BANK` (B3) is the harness-side default.          |
| A14 | Query result snapshots (`~/.memo/queries/`) and `local-store.ts` ship in Phase 3, not Phase 2; Phase 2 `recall`/`search` emit `query_id` only.                               | PRD FR-1.4/FR-3.1 make `query_id` inert until `memo used` exists; keeps Phase 2 free of local-filesystem state and its `0600`/`MEMO_HOME` test surface.           |

## 5. Data Model & Database Design

### 5.1 Entity overview

One point type. New fields are optional at read time; v2 writes require `bank` and `kind`.

```mermaid
erDiagram
    MEMORY {
        uuid id PK
        string schema_version "absent=v1, '2'=v2"
        string bank "keyword idx; absent=kb"
        enum kind "self|episodic|semantic; keyword idx"
        string repo "keyword idx; required in kb, optional in private"
        string org "keyword idx"
        string domain
        string rationale "1-5000; text idx"
        string_array tags "2-5 kebab; keyword idx"
        enum entry_type "decision|integration_point|structure|policy|observation; keyword idx"
        enum source "agent|manual|scan; keyword idx"
        enum confidence "payload only"
        datetime timestamp_utc "datetime idx"
        string session_id "episodic; keyword idx"
        int seq "episodic; integer idx"
        string_array contexts "keyword idx"
        uuid_array provenance "semantic; audit only"
        datetime valid_from
        datetime valid_to "set when superseded"
        bool superseded "bool idx; mirror of valid_to"
        uuid superseded_by
        bool consolidated "episodic; bool idx"
        datetime consolidated_at
        bool pinned "bool idx"
        bool archived "bool idx"
        enum archived_reason "expired|promoted|decayed|noisy|superseded|forget"
        datetime archived_at "datetime idx"
        datetime expires_at "episodic; datetime idx"
        float stability "days"
        datetime stability_since "retention clock anchor"
        datetime last_retrieved_at
        int retrieval_count
        int used_count
        bool pending_contradiction
        string_array files_modified "text idx"
        string commit "keyword idx"
        string story
        string_array relates_to
        string dedupe_key_sha256 "keyword idx"
        enum dedupe_key_version "v1|v2"
        uuid_array links_out "Phase 5"
        int links_in_count "Phase 5"
        string_array links_in_contexts "Phase 5"
    }
    MEMORY ||--o{ MEMORY : "provenance / superseded_by / links_out"
```

### 5.2 Zod schema (`src/types/entry.ts`)

`EntryPayloadSchema` becomes a v2 superset. Field groups and their write-time rules:

| Group     | Fields                                                                                                       | Rule                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| identity  | `id`, `schema_version: '2'`, `bank`, `kind`                                                                  | `bank` kebab or UUID; `kind` enum; `kind = self` requires `bank !== 'kb'` (`superRefine`).                                                            |
| scope     | `repo`, `org`, `domain`                                                                                      | Required when `bank = kb`; optional in private banks (`superRefine`).                                                                                 |
| content   | `rationale`, `tags`, `entry_type`, `source`, `confidence`, `commit`, `story`, `files_modified`, `relates_to` | Unchanged constraints. `entry_type` gains `policy` (reserved for PRD-003) and `observation`.                                                          |
| episodic  | `session_id`, `seq`, `expires_at`, `consolidated`, `consolidated_at`                                         | `session_id` required when `kind = episodic`; `seq` integer ≥ 0; `consolidated` defaults `false`.                                                     |
| semantic  | `provenance`, `valid_from`, `valid_to`, `superseded`, `superseded_by`, `pinned`                              | `provenance` non-empty when `kind = semantic` and `source = agent` unless `--manual` set `source = manual`. `valid_from` defaults to `timestamp_utc`. |
| retention | `stability`, `stability_since`, `last_retrieved_at`, `retrieval_count`, `used_count`                         | Set by the write path from policy; never user-settable. Absent on `self`.                                                                             |
| archive   | `archived`, `archived_reason`, `archived_at`                                                                 | Default `false`; only `lifecycle` and `forget` set them.                                                                                              |
| links     | `links_out`, `links_in_count`, `links_in_contexts`                                                           | Phase 5.                                                                                                                                              |

Reads use `EntryPayloadSchema.partial().passthrough()` so v1 points and future fields survive.

### 5.3 Payload indexes

`PAYLOAD_INDEXES` (in `src/lib/qdrant.ts`) becomes the reconciliation source of truth:

| Field                                                  | Index    | Options                                                                       | Phase |
| ------------------------------------------------------ | -------- | ----------------------------------------------------------------------------- | ----- |
| existing 8                                             | as today |                                                                               | —     |
| `rationale`                                            | text     | `tokenizer: word`, `lowercase: true`, `min_token_len: 2`, `max_token_len: 20` | 1     |
| `files_modified`                                       | text     | same                                                                          | 1     |
| `bank`, `kind`, `session_id`, `contexts`, `entry_type` | keyword  |                                                                               | 2     |
| `seq`                                                  | integer  |                                                                               | 2     |
| `archived`, `superseded`, `consolidated`, `pinned`     | bool     |                                                                               | 2     |
| `archived_at`, `expires_at`, `valid_to`                | datetime |                                                                               | 2–3   |

The collection name resolves from `MEMO_COLLECTION` (default `decisions`) so the relevance harness can seed an isolated collection. `ensureCollection()` is split: `ensureCollection()` creates the collection when absent; `ensureIndexes()` reads `getCollection().payload_schema` and creates any index in `PAYLOAD_INDEXES` that is missing. Both are idempotent and run on every command that touches Qdrant (one extra `getCollection` call, already made today).

### 5.4 Config schema v2 (`src/types/config.ts`)

Additive blocks, all optional with defaults, `.passthrough()` preserved:

```ts
schema_version: z.enum(['1', '2'])                             // was literal('1'); v1 files stay valid
bank:          { default: KebabOrUuid.default('kb') }
banks:         { kb: BankPolicy, private: BankPolicy }        // per-kind policy, see §8.4 and §18.2
recall:        { max_tokens: int > 0, default 2000 }           // Phase 2
ranking:       { w_similarity, w_recency, w_source, recency_half_life_days, tag_boost_factor,
                 lexical_boost_factor, lexical: boolean, confidence_thresholds,
                 staleness_threshold_days, staleness_tag_overlap_threshold, use_beta, link_alpha }
retention:     { min_spacing_hours, base_gain, used_bonus, max_stability_days,
                 archive_threshold, noisy_min_retrievals, noisy_max_use_ratio, feedback_window_days }
consolidation: { min_episodes, min_contexts, min_span_days, cluster_similarity,
                 duplicate_similarity, model, promote_to_kb }
```

`superRefine` rules: weights sum to `1.0 ± 0.001`, each in `[0,1]`; thresholds strictly ordered `exact > high > medium`; half-life and stabilities `> 0`; `purge_after_days` on `banks.kb.*` must be explicit (no default). Invalid config fails `loadConfig` (fail fast, #34 D7) and `memo setup validate`. `ranking`'s Phase 1 block (`src/types/config.ts`) is already shipped with these rules; Phase 2 adds `schema_version`, `bank`, `banks`, `recall` only — `retention` and `consolidation` land with Phases 3 and 4.

### 5.5 Migration strategy

No collection or vector change. `memo migrate --to-v2` is a paginated scroll (`scrollAll`, batch 256) that, per point lacking `schema_version = '2'`, computes the FR-2.8 rule result and issues one `batchUpdate` of `set_payload` operations per batch. Idempotent by construction. `--dry-run` runs the same planner and prints counts per rule. The planner is `src/lib/migrate.ts: planMigration(points, now, rules) -> MigrationPlan` (pure).

Migration sets for every point: `schema_version`, `bank = 'kb'`, `kind`, `consolidated = false`, `archived = false`, `superseded = false`, `pinned = false`, `retrieval_count = 0`, `used_count = 0`, `stability` (policy initial for its kind), `stability_since = now`, `dedupe_key_version` unchanged (v1 keys remain valid), and for rule 1: `session_id = story ?? 'legacy'`, `expires_at = timestamp_utc + banks.kb.episodic.expires_in_days`; for rule 2: `valid_from = timestamp_utc`.

## 6. API Design

The CLI is the API. Every command supports `--json`; exit codes follow the catalog (0 / 1 / 2). Unchanged flags keep their meaning. New shared flags:

| Flag                                         | Commands                              | Semantics                                                                                                                           |
| -------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `--bank <id>`                                | all data commands                     | Bank selector; resolution `--bank` → `MEMO_BANK` → `config.bank.default` → `kb`.                                                    |
| `--kind <k>`                                 | write, search, list, tags, forget     | `self \| episodic \| semantic \| all`. Search/list default `all` minus `self`.                                                      |
| `--session <id>`                             | write, timeline, forget, search, list | Episodic session grouping.                                                                                                          |
| `--include-archived`, `--include-superseded` | search, list, tags, read              | Lift the default exclusion.                                                                                                         |
| `--as-of <date>`                             | search, list                          | Semantic entries valid at that instant: `valid_from <= as_of` and (`valid_to` absent or `> as_of`). Implies `--include-superseded`. |
| `--dry-run`                                  | decay, forget, migrate, consolidate   | Plan only; nothing written; exit 0.                                                                                                 |

### 6.1 Command contracts by phase

**Phase 1**

| Command                     | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memo search <query>`       | Over-fetch `max(limit, min(limit*3, 50))` dense; if `ranking.lexical` and identifier tokens exist, one lexical scroll (§8.2) with vectors; union; rank via `rankResults`; slice. Adds `--explain`, `--lexical <on\|off>`. JSON adds `query_id`, per-result `final_score`, `similarity`, `recency_score`, `source_score`, `tag_boost`, `lexical_boost`, `confidence_tier`, `stale?`, `stale_by?`, and with `--explain` a `factors` object. Human output shows `final_score` % in the existing position and a `[tier]` prefix. |
| `memo setup validate`       | Validates `ranking` block.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `scripts/eval-relevance.ts` | `pnpm run eval:relevance [--record]` (§14).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Phase 2**

| Command                                                                                 | Contract                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memo write`                                                                            | New flags `--bank`, `--kind`, `--session`, `--seq`, `--context` (repeatable), `--provenance <csv>`, `--manual`, `--supersedes <id>`, `--pin`, `--expires-in <duration>`. Defaults per PRD K1. Auto-`seq` when `--session` given without `--seq` (one scroll ordered by `seq` desc, limit 1). JSON result adds all v2 fields. |
| `memo search`, `memo list`, `memo tags list`                                            | New shared flags. Base filter from `buildBaseFilter` (§8.1) composed with existing builders.                                                                                                                                                                                                                                 |
| `memo read --id`                                                                        | Prints v2 fields; provenance ids annotated `(deleted)` when `getById` misses.                                                                                                                                                                                                                                                |
| `memo timeline --bank <id> [--session <id>] [--last <n>] [--since <date>] [--json]`     | Scroll `kind = episodic` ordered by `seq` asc when `--session`, else by `timestamp_utc` desc grouped by session; never ranked. JSON: `{ bank, session_id?, entries: [...], count }`.                                                                                                                                         |
| `memo recall "<task>" [--bank] [--scope] [--max-tokens <n>] [--json]`                   | §8.5, §18.7. JSON: `{ query_id, bank, budget: { max_tokens, used_tokens }, sections: { self: [], policies: [], shared: [], mine: [], last_session: { session_id, entries: [] }, conflicts: [] }, truncated: string[] }`. `--max-tokens` defaults to `config.recall.max_tokens` (2000). No snapshot written in Phase 2 (A14). |
| `memo bank init --id <id> [--rationale <text>] [--tags <csv>] [--set-default] [--json]` | Writes the first `self` entry (`entry_type = structure`, `source = manual`, tags default `bank,self`); `--set-default` additionally sets `config.bank.default` (A13). Second run: prints existing, writes nothing.                                                                                                           |
| `memo bank list [--json]`, `memo bank show --id <id> [--json]`                          | Facet scroll on `bank` (reuses `facets.ts`); `show` prints valid `self` entries newest first plus counts per kind and last `session_id`.                                                                                                                                                                                     |
| `memo migrate --to-v2 [--dry-run] [--rules <file>] [--json]`                            | §5.5. JSON: `{ scanned, migrated, skipped, by_rule: { "1": n, "2": n }, dry_run }`.                                                                                                                                                                                                                                          |
| `memo inspect`                                                                          | Adds a `banks` facet (counts only).                                                                                                                                                                                                                                                                                          |

**Phase 3**

| Command                                                                                                                       | Contract                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memo used --query <id> --ids <csv> [--wrong <csv>] [--json]`                                                                 | Loads snapshot; ids ⊄ snapshot → `VALIDATION_FAILED`; unknown/expired query → `QUERY_NOT_FOUND` (exit 1). Batch update: `used_count += 1`, `stability = min(cap, stability * (1 + used_bonus))`; `--wrong`: `pending_contradiction = true`. Appends usage events. JSON: `{ query_id, used: [...], wrong: [...], events_written }`. |
| `memo search` / `memo recall`                                                                                                 | After ranking, one `batchUpdate` on returned ids (not over-fetched ones): `retrieval_count += 1`; if spaced, `stability *= base_gain` (capped), `last_retrieved_at = now`. `self` excluded. Failure logged under `MEMO_DEBUG`, never fatal.                                                                                        |
| `memo decay [--bank <id>] [--dry-run] [--purge-expired] [--verbose] [--json]`                                                 | §8.4. JSON: `{ bank, dry_run, archived: { by_kind_reason: {...}, ids?: [] }, purged: { count, ids?: [] }, skipped: { self, pinned } }`.                                                                                                                                                                                            |
| `memo forget [--id] [--session] [--bank] [--kind] [--older-than <dur>] [--tags <csv>] [--dry-run] [--purge] [--yes] [--json]` | AND of selectors; at least one required. Default = archive with reason `forget`. `--purge` = delete + tombstones. Guards: PRD D5. JSON: `{ selector, dry_run, action: "archive"\|"purge", count, ids }`.                                                                                                                           |
| `memo restore --id <id> [--json]`                                                                                             | Clears `archived*`; `ENTRY_NOT_FOUND` if absent.                                                                                                                                                                                                                                                                                   |
| `memo stats [--bank <id>] [--json]`                                                                                           | Counts per kind and state, stability histogram (buckets 1/7/30/90/365+), top 10 by `use_ratio`, noisy list, tombstone counts.                                                                                                                                                                                                      |

**Phase 4**

| Command                                                                                                                   | Contract                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `memo consolidate --bank <id> [--dry-run] [--limit <n>] [--since <date>] [--promote-to kb] [--yes] [--report json\|text]` | §8.6. Report: clusters, candidates, promoted, duplicates, held, contradicted, skipped, tokens, estimated cost. |

**Phase 5**: `memo link`, `memo unlink`, `memo reindex-links`, `memo search --expand`, `memo ask` per PRD FR-5.x; contracts specified in that phase's spec revision.

### 6.2 JSON response examples

`memo search --json` (Phase 1 additions only):

```json
{
  "query": "why does search-filters.ts build should clauses",
  "query_id": "6f1c…",
  "filters": { "scope": "repo", "repo": "memo-cli", "limit": 5 },
  "results": [
    {
      "id": "…",
      "rationale": "…",
      "tags": ["search", "qdrant", "filters"],
      "similarity": 0.71,
      "recency_score": 0.93,
      "source_score": 1.0,
      "tag_boost": 0.017,
      "lexical_boost": 0.15,
      "final_score": 0.88,
      "confidence_tier": "exact"
    }
  ],
  "count": 1
}
```

`memo recall --json` (abridged):

```json
{
  "query_id": "9a2e…",
  "bank": "jarvis-memory",
  "budget": { "max_tokens": 2000, "used_tokens": 1740 },
  "sections": {
    "self": [{ "id": "…", "rationale": "I am the planner for llipe repos…", "valid_from": "…" }],
    "policies": [],
    "shared": [{ "id": "…", "final_score": 0.84, "confidence_tier": "high", "rationale": "…" }],
    "mine": [{ "id": "…", "final_score": 0.79, "confidence_tier": "high", "rationale": "…" }],
    "last_session": {
      "session_id": "ISSUE-41",
      "entries": [{ "id": "…", "seq": 1, "rationale": "…" }]
    },
    "conflicts": []
  },
  "truncated": ["conflicts"]
}
```

`memo decay --json`:

```json
{
  "bank": "jarvis-memory",
  "dry_run": false,
  "archived": {
    "episodic": { "expired": 12, "promoted": 4 },
    "semantic": { "decayed": 1, "noisy": 0, "superseded": 2 }
  },
  "purged": { "count": 9 },
  "skipped": { "self": 3, "pinned": 1 }
}
```

### 6.3 Sequence: recall → used → decay

Full three-phase flow. In Phase 2 only the `memo recall` leg exists, and per A14 the `queries/<query_id>.json` write and the retrieval-counter batch update are Phase 3 steps — Phase 2 `recall` ends at "JSON bundle + query_id".

```mermaid
sequenceDiagram
  participant A as Agent harness
  participant C as memo recall
  participant R as recall.ts
  participant Q as QdrantRepository
  participant S as LocalStore (~/.memo)
  A->>C: memo recall "plan #42" --bank jarvis-memory --json
  C->>Q: scroll self (bank, kind=self, superseded=false)
  C->>Q: query kb semantic (vector, base filter) + lexical scroll
  C->>Q: query bank semantic
  C->>Q: scroll bank episodic, last session (seq asc)
  C->>Q: scroll bank pending_contradiction=true
  C->>R: assemble(sections, budget)
  R-->>C: bundle (dedup, trimmed bottom-up, SELF intact)
  C->>S: write queries/<query_id>.json {ids}
  C->>Q: batchUpdate retrieval counters (best effort)
  C-->>A: JSON bundle + query_id
  A->>C: memo used --query <id> --ids a,b
  C->>S: read snapshot; validate ids ⊆ snapshot
  alt ids not in snapshot
    C-->>A: exit 1 VALIDATION_FAILED
  else
    C->>Q: batchUpdate used_count, stability
    C->>S: append usage.jsonl
    C-->>A: exit 0
  end
  A->>C: memo decay --bank jarvis-memory --json
  C->>Q: scrollAll bank (all kinds except self)
  C->>C: lifecycle.planDecay(entries, policy, now)
  C->>Q: batchUpdate archive set; delete purge set
  C->>S: append forget.jsonl tombstones for purged
  C-->>A: counts
```

## 7. Authentication & Authorization Design

Unchanged from technical guidelines §5: no auth layer; Qdrant and provider credentials via env. Banks are a namespace, not a boundary. Guard matrix for irreversible operations:

| Operation                              | TTY                      | `--yes`   | `--json`                        |
| -------------------------------------- | ------------------------ | --------- | ------------------------------- |
| `memo forget` (archive)                | confirm                  | proceeds  | proceeds                        |
| `memo forget --purge --id / --session` | confirm                  | proceeds  | proceeds                        |
| `memo forget --purge --bank / other`   | confirm                  | proceeds  | `VALIDATION_FAILED`             |
| `memo decay --purge-expired`           | proceeds (policy-driven) | proceeds  | proceeds (never purges in `kb`) |
| `memo delete` (existing)               | unchanged                | unchanged | unchanged (single only)         |

Local files under `~/.memo/` are created with mode `0600`; the directory with `0700`.

## 8. Business Logic Implementation

### 8.1 Bank and base filter (`src/lib/bank.ts`, `src/lib/filters.ts`)

```ts
resolveBank(flag?, env = process.env, config?) -> string          // PRD B3
isPrivateBank(bank) -> bank !== 'kb'
policyFor(config, bank, kind) -> KindPolicy                         // banks.kb|private[kind]
defaultKind(bank) -> bank === 'kb' ? 'semantic' : 'episodic'       // PRD K1
buildBaseFilter({ bank, kind, includeArchived, includeSuperseded, asOf, session }) -> QdrantFilter
```

`buildBaseFilter` produces:

- bank `kb`: `must: [{ should: [ { key: 'bank', match: { value: 'kb' } }, { is_empty: { key: 'bank' } } ] }]` (v1 points count as `kb` until migrated); private bank: `must: [{ key: 'bank', match: { value } }]`.
- kind: `all` → `must_not: [{ key: 'kind', match: { value: 'self' } }]`; a specific kind → `must` match. Points lacking `kind` (v1) are treated as semantic by the reader and pass the `all` filter.
- default exclusions: `must_not: [{ key: 'archived', match: { value: true } }, { key: 'superseded', match: { value: true } }]` unless lifted.
- `asOf`: `must: [{ key: 'valid_from', range: { lte: asOf } }]` plus `should: [{ is_empty: { key: 'valid_to' } }, { key: 'valid_to', range: { gt: asOf } }]`.

Existing `buildSearchFilters` / `buildListFilters` keep their signatures; commands merge the base filter's `must`/`must_not`/`should` arrays with theirs. The `repo` clause is added only when `bank = kb` or the caller passes `--repo`.

### 8.2 Ranking (`src/lib/ranking.ts`, `src/lib/lexical.ts`, `src/lib/staleness.ts`)

Pure, `now` injected, no I/O. Implements PRD §8.2 with neutral defaults.

```ts
computeRecencyScore(timestampUtc, now, halfLifeDays)     // exp(-ln2/halfLife * ageDays); NaN → 0; future → 1
computeSourceScore(source)                                // agent 1.0, manual 0.8, scan 0.5, unknown 0.5
computeTagBoost(query, tags, factor)                      // #36: whole-word, case-insensitive, stopwords removed
computeLexicalBoost(identifierTokens, rationale, files, factor) // matched / total identifier tokens * factor
computeRetention(entry, now)                               // exp(-t / stability); t from last_retrieved_at ?? stability_since ?? timestamp_utc; absent stability → 1
computeUseRatio(entry)                                     // used_count / max(retrieval_count, 1); absent → 0
computeCompositeScore(parts, config) -> { final_score, factors }
computeConfidenceTier(finalScore, thresholds)
rankResults(candidates, { query, config, now }) -> Ranked[]   // sorts by final_score desc, timestamp desc, id asc
```

Lexical candidate retrieval (Phase 1, command-side, one Qdrant call):

1. `extractIdentifierTokens(query)`: tokens matching any of: contains `.`, `/`, `-`, `_`; matches `#\d+` or `[A-Z]+-\d+`; starts with `--`; or is a CamelCase word. Tokenize each into word tokens the same way Qdrant's `word` tokenizer does (lowercase, split on non-alphanumerics), dropping tokens shorter than 2.
2. If none: skip lexical. Else scroll with `should` (`min_should: 1`) of `{ key: 'rationale' | 'files_modified', match: { text: <original identifier> } }` per identifier, base filter applied, `limit 50`, `with_vector: true`.
3. For lexical-only candidates, `similarity = cosine(queryVector, pointVector)` computed locally. Dense candidates keep Qdrant's score. Union by id.
4. `lexical_boost` per candidate = fraction of identifiers whose tokens all appear in `rationale ∪ files_modified` × `lexical_boost_factor` (default 0.15). Dense-only candidates get the same computation (may be 0).

Composite:

```
base    = w_sim*clamp01(sim) + w_rec*recency + w_src*source
boosted = min(1, base + tag_boost + lexical_boost)
final   = min(1, boosted * (0.5 + 0.5*retention) * (1 + use_beta*use_ratio) * (1 + link_alpha*log(1+links_in)*diversity))
```

Staleness (`detectStaleness`, #38): one scroll of same-bank, same-repo, non-archived candidates per invocation, cached; flag `stale` + `stale_by` (the superseder's id; deliberately distinct from the Phase 2 stored `superseded_by`) when age > threshold and a newer entry has Jaccard tag overlap ≥ threshold. Annotation only.

### 8.3 Write path (`src/commands/write.ts`)

1. Resolve bank, kind, policy. Validate PRD K1–K3 before any I/O.
2. `--supersedes <id>`: `getById`; same bank and same kind required (`VALIDATION_FAILED`); after the new point is stored, `setPayload` on the old: `valid_to = now`, `superseded = true`, `superseded_by = newId`.
3. Retention fields from policy: `stability = policy.initial_stability_days`, `stability_since = now`, counters 0; omitted for `self`.
4. Episodic: `expires_at = now + (--expires-in ?? policy.expires_in_days)`; auto-`seq` when absent.
5. Dedupe (A7): semantic → `v2|bank|repo|commit|story|na|semantic|entry_type|source`; episodic → `v2|bank|repo|commit|story|session|seq|episodic|entry_type|source`; self → `sha256('self|' + id)` (never matches). Existing consolidate/update/replace/create-new actions unchanged.
6. Embed and upsert as today. JSON result includes the full v2 payload.

### 8.4 Lifecycle (`src/lib/retention.ts`, `src/lib/lifecycle.ts`)

State machine implemented by `lifecycle.planDecay(entries, policies, now, feedbackActive) -> DecayPlan` where `DecayPlan = { archive: { id, reason }[], purge: id[], skipped: { self, pinned } }`.

```mermaid
stateDiagram-v2
  [*] --> active
  active --> consolidated: consolidate (episodic)
  active --> superseded: --supersedes / reconsolidation (self, semantic)
  active --> archived: decay(expired | decayed | noisy) / forget
  consolidated --> archived: decay(promoted) after promoted_grace_days
  superseded --> archived: decay(superseded) after superseded_grace_days (semantic only)
  archived --> active: restore
  archived --> [*]: decay --purge-expired after purge_after_days / forget --purge
  active --> [*]: forget --purge / delete
```

Decision table (evaluated in order; first match wins; `self` and `pinned` skipped before evaluation):

| Kind         | Condition                                                                                         | Action  | Reason       |
| ------------ | ------------------------------------------------------------------------------------------------- | ------- | ------------ |
| episodic     | `consolidated && consolidated_at + promoted_grace_days < now`                                     | archive | `promoted`   |
| episodic     | `expires_at < now`                                                                                | archive | `expired`    |
| semantic     | `superseded && valid_to + superseded_grace_days < now`                                            | archive | `superseded` |
| semantic     | `retention < archive_threshold`                                                                   | archive | `decayed`    |
| semantic     | `policy.archive_noisy && feedbackActive && retrieval_count >= noisy_min && use_ratio < noisy_max` | archive | `noisy`      |
| any archived | `policy.purge_after_days != null && archived_at + purge_after_days < now` and `--purge-expired`   | purge   | —            |

`feedbackActive` = the bank has at least one usage event within `retention.feedback_window_days` (default 30) in `~/.memo/usage.jsonl`. Without feedback, the noisy rule is inert (every entry would otherwise look unused).

Retrieval update (`retention.applyRetrieval(entry, now, config)`): `retrieval_count += 1`; spaced iff `last_retrieved_at` absent or `now - last_retrieved_at >= min_spacing_hours`; if spaced: `stability = min(max_stability_days, stability * base_gain)`, `last_retrieved_at = now`. `applyUsed(entry)`: `used_count += 1`, `stability = min(cap, stability * (1 + used_bonus))`.

Policy defaults (`banks.<type>.<kind>`), refined from PRD §8.4 by A5/A6:

| Bank type / kind   | `initial_stability_days` | `expires_in_days` | `archive_threshold` | `archive_noisy` | `promoted_grace_days` | `superseded_grace_days` | `purge_after_days` |
| ------------------ | ------------------------ | ----------------- | ------------------- | --------------- | --------------------- | ----------------------- | ------------------ |
| private / self     | —                        | —                 | —                   | —               | —                     | —                       | —                  |
| private / episodic | 3                        | 30                | — (ranking only)    | —               | 7                     | —                       | 30                 |
| private / semantic | 30                       | —                 | 0.05                | true            | —                     | 30                      | 90                 |
| kb / episodic      | 3                        | 90                | — (ranking only)    | —               | 7                     | —                       | null               |
| kb / semantic      | 90                       | —                 | 0.05                | false           | —                     | 30                      | null               |

With these values a `kb` decision never retrieved is archived after ~270 days from its `stability_since` (`exp(-270/90) = 0.05`), a private lesson after ~90 days, and every spaced retrieval multiplies the horizon by 1.6.

### 8.5 Recall assembly (`src/lib/recall.ts`)

`assembleRecall(inputs, budget) -> RecallBundle`, pure. Inputs are the five candidate lists plus policies. Section caps before trimming: `self` all (warn above 50), `policies` all, `shared` 8, `mine` 5, `last_session` 15 (most recent by `seq`), `conflicts` 5. Token estimate = `ceil(chars / 4)` of the rendered entry line (JSON: `rationale` + ids + scores). Trimming order until under budget: `conflicts` → `last_session` (drop oldest first) → `mine` → `shared` → `policies`; `self` never. Default `--max-tokens` 2000. Ids deduplicated across sections in section order. The snapshot written to `~/.memo/queries/` contains the union of ids so `memo used` accepts any of them.

### 8.6 Consolidation (`src/lib/consolidate.ts`, `src/lib/llm.ts`, `src/adapters/openai-llm.ts`) — Phase 4

Pipeline per PRD FR-4.1, implemented as pure planning steps around two I/O boundaries (Qdrant, LLM):

1. `select`: `scrollAll` episodic, `consolidated = false`, `archived = false`, optional `--since`, `with_vector: true`, cap `--limit` (default 500).
2. `cluster` (pure): greedy single-linkage over cosine ≥ `cluster_similarity` (0.80) with a shared tag or context required; emit clusters with `episodes`, `contexts`, `span_days`.
3. `gate1` (pure): keep clusters with `episodes >= min_episodes`, `distinct contexts >= min_contexts`, `span_days >= min_span_days`. Others stay unconsolidated.
4. `propose` (LLM): prompt = cluster episodes (id, timestamp, context, rationale) + up to 3 nearest valid semantic facts of the same bank; strict JSON out: `{ candidates: [{ content, evidence: [ids], contradicts: [ids], confidence: high|medium|low }] }`. Parse failure → one retry → cluster marked `held`.
5. `gate2` (pure): drop candidates with `evidence ⊄ cluster ids` or empty; drop candidates whose `contradicts` names ids not in the provided facts.
6. `dedupe` (embedding): candidate embedded; if a valid semantic fact in the bank has cosine ≥ `duplicate_similarity` (0.92) and no contradiction: append the evidence ids to that fact's `provenance`, mark episodes consolidated, count as `duplicate`.
7. `write`: promoted → new semantic point (`source = agent`, `provenance = evidence`, `valid_from = now`, `contexts` union, tags from cluster top-5, confidence tier from candidate confidence); contradictions with `>= 2` contexts → supersede old facts (§8.3 step 2); single-context contradiction → new point with `pending_contradiction = true`, lowest tier, no supersede.
8. `mark`: `consolidated = true`, `consolidated_at = now` on cluster episodes via `batchUpdate`.
9. `report`: every cluster and candidate with the rule that decided it, plus `usage.total_tokens` and `estimated_cost_usd` from a per-model price table in config (`consolidation.price_per_1k_tokens`, default unset → cost reported as `null`).

`--promote-to kb`: runs steps 1–6 over the bank's `semantic` entries not yet tagged `promoted-to:kb` instead of episodes, writes candidates to `workstream/memo-promotions-<date>.md` (review) or to `kb` (`--yes` / `auto`), and tags the source fact `promoted-to:kb`.

`LLMAdapter`: `complete(prompt, { json: true, maxTokens }) -> { text, usage }`; `createLLMAdapter()` selects by `LLM_PROVIDER` (`openai` default via the existing SDK; `ollama` via `baseURL = OLLAMA_BASE_URL`, key optional). Uses `withRetry`.

### 8.7 Validation rules summary

| Rule                                                | Enforced in                      | Error                             |
| --------------------------------------------------- | -------------------------------- | --------------------------------- |
| `kind = self` in `kb`                               | `EntryPayloadSchema.superRefine` | `VALIDATION_FAILED`               |
| `repo/org/domain` missing in `kb`                   | write command (as today)         | `REPO_CONTEXT_UNRESOLVED`         |
| episodic without `session_id`                       | schema                           | `VALIDATION_FAILED`               |
| agent semantic without provenance and no `--manual` | schema                           | `VALIDATION_FAILED`               |
| `--supersedes` target other bank/kind               | write command                    | `VALIDATION_FAILED`               |
| `memo used` ids outside snapshot                    | used command                     | `VALIDATION_FAILED`               |
| `memo used` unknown/expired query                   | used command                     | `QUERY_NOT_FOUND` (new, exit 1)   |
| `forget --purge` bank-wide in `--json`              | forget command                   | `VALIDATION_FAILED`               |
| invalid `ranking`/`banks`/`retention` config        | `MemoConfigSchema`               | `CONFIG_INVALID`                  |
| LLM call failure after retries                      | `openai-llm.ts`                  | `LLM_API_ERROR` (new, exit 2)     |
| `~/.memo` unwritable                                | `local-store.ts`                 | `LOCAL_STORE_ERROR` (new, exit 2) |

## 9. Integration Details

| Integration | Method                                                                                                                                                                                                                                                                                                                  | Failure handling                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Qdrant      | `QdrantRepository` additions: `ensureIndexes()`, `scrollAll(filter, { batch, withVector, orderBy })` (offset pagination), `scroll(..., { withVector })`, `count(filter)`, `batchUpdate(ops: SetPayloadOp[])` (`points/batch`), `setPayload(id, payload)`. Existing methods unchanged. Commands never import the client. | `withRetry` (3 attempts, 500 ms base); `QDRANT_OPERATION_FAILED`; counter updates are best-effort.     |
| Embeddings  | Unchanged adapter; `recall` embeds the task once and reuses the vector for both semantic queries.                                                                                                                                                                                                                       | `EMBEDDING_API_ERROR`.                                                                                 |
| LLM         | `LLMAdapter` (Phase 4/5) over the `openai` SDK; Ollama via `baseURL`.                                                                                                                                                                                                                                                   | `withRetry`; JSON parse retry once; `LLM_API_ERROR`.                                                   |
| Local store | `src/lib/local-store.ts`: `MEMO_HOME` (default `~/.memo`); `writeQuerySnapshot`, `readQuerySnapshot`, `pruneSnapshots(ttlDays)`, `appendUsage`, `appendTombstone`, `readUsage(bank, sinceDays)`; JSON lines; `0600`/`0700`.                                                                                             | `LOCAL_STORE_ERROR`; snapshot write failure in `search` degrades to a warning (search still succeeds). |
| dev-tasks   | `MEMO_BANK` exported by the harness from the agent definition; skill documents the session protocol: `recall` → work (episodic writes) → `used` → `decay`.                                                                                                                                                              | If `memo` missing or unconfigured, existing skip/ask behavior stands.                                  |

## 10. User Interface & Client Behavior

CLI only; technical guidelines §4 color policy applies.

- `memo search` human: `[exact] memo-cli  88%  Lead sentence…` then metadata, then `⚠ STALE — superseded by <id>` when flagged; `--explain` appends an aligned table `sim recency source tag lex retention use final`.
- `memo recall` human: uppercase section headers, one line per entry (`[tier] score  lead  id`); `SELF` lines omit tier and score; `LAST SESSION` prefixed by `seq`; footer `budget: 1740/2000 tokens · truncated: conflicts`.
- `memo timeline` human: `seq  timestamp  lead  id` in order.
- `memo decay`/`memo forget --dry-run` human: selector line, per-kind/reason counts table, up to 20 sample ids per class, `nothing written` footer.
- `memo bank show` human: `self` entries newest first, then counts per kind and state.
- Confirmation prompts reuse `delete.ts`'s `defaultConfirm` (extracted to `src/lib/confirm.ts`).

## 11. Performance & Scalability Approach

| Path          | Calls                                                                                          | Target                         |
| ------------- | ---------------------------------------------------------------------------------------------- | ------------------------------ |
| `search`      | 1 embed, 1 dense query, ≤1 lexical scroll, ≤1 staleness scroll (cached), 1 batch update        | < 2.5 s                        |
| `recall`      | 1 embed, 2 dense queries, ≤1 lexical scroll, 3 scrolls (self, session, conflicts), 1 batch     | < 4 s                          |
| `decay`       | `scrollAll` (256/page), 1 batch update per page, ≤1 delete                                     | < 30 s at 10K entries per bank |
| `consolidate` | `scrollAll` with vectors, O(n²) cosine clustering capped by `--limit` 500, ≤1 LLM call/cluster | offline; progress on stderr    |
| `migrate`     | `scrollAll`, 1 batch update per page                                                           | < 60 s at 10K entries          |

Ranking is O(n) over ≤ 100 candidates. `ensureIndexes` adds one `getCollection` (already performed). No caching beyond per-invocation memoization.

## 12. Security Implementation

- Credentials only from env (unchanged). Local store never contains rationale text for usage/tombstone records; query snapshots contain ids and the query string only.
- File modes `0600`/`0700`; `MEMO_HOME` override for tests and CI.
- No shell execution; bank ids validated as kebab or UUID before use in filters or file names (`queries/<uuid>.json` only).
- Consolidation prompts contain memory text only; the LLM response is validated as JSON and by id membership before any write.
- Audit: every purge tombstoned (PRD D2); `memo stats` surfaces counts.

## 13. Error Handling & Logging

- New codes in `src/lib/errors.ts`: `QUERY_NOT_FOUND` (1), `LLM_API_ERROR` (2), `LOCAL_STORE_ERROR` (2). Catalog in `docs/technical-guidelines.md` §4 updated.
- Best-effort paths (retrieval counters, snapshot pruning) never change exit code; failures go to `debugLog`.
- `--json` errors keep `{ "error", "code" }` on stderr.
- `memo decay` and `memo consolidate` print progress to stderr only when not `--json`.

## 14. Testing Strategy

`/TESTING.md` was filled in Phase 1 (S1-08) and is the binding harness description (Jest, `tests/unit` / `tests/integration` / `tests/relevance`, credential requirements). The table below is the PRD-004 layer map on top of it. Phase 1 exit recorded `coverage_gate: FAIL` on branches/functions (pre-existing debt in `setup.ts`, `write.ts`, `retry.ts`, `embeddings.ts`); Phase 2 touches `write.ts` and `setup.ts` directly and **MUST** leave both at or above the `jest.config.ts` thresholds rather than carrying the debt forward.

| Layer                             | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Mocks                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Unit (`tests/unit/lib`)           | `ranking` (decay table from #34 refinement incl. DEF-2 values, tie-break, clamps), `lexical` (identifier extraction, tokenization parity, boost), `staleness`, `retention` (spacing, cap, `stability_since` anchor), `lifecycle` (every row of the §8.4 table, `self`/`pinned` skip, feedbackActive gating, purge only when `--purge-expired`), `recall` (caps, trimming order, SELF intact, dedup), `migrate` (rules, idempotency), `bank`/`filters` (filter shapes incl. `is_empty`), `consolidate` gates with canned LLM JSON, config schema refinements. | none (pure)                                                |
| Unit (`tests/unit/commands`)      | flag parsing, defaults, guard matrix (§7), JSON envelopes, exit codes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `QdrantRepository`, embeddings, `LocalStore`, `LLMAdapter` |
| Integration (`tests/integration`) | command flows against a mocked repository: write→supersede→as-of; search over-fetch and union; recall→used→decay end-to-end with a temp `MEMO_HOME`; migrate dry-run vs real.                                                                                                                                                                                                                                                                                                                                                                                | boundary mocks per guidelines                              |
| Relevance replay (Jest)           | `tests/fixtures/relevance/candidates.json` records, per eval query, the dense candidates (ids + Qdrant scores) and lexical hits from one live run; a test replays `rankResults` and asserts top-3 hit rate ≥ recorded baseline. Deterministic, no network.                                                                                                                                                                                                                                                                                                   | none                                                       |
| Relevance live (script)           | `pnpm run eval:relevance` runs the eval queries against a real Qdrant + embeddings seeded from `tests/fixtures/relevance/entries.json`; `--record` refreshes `candidates.json` and `baseline.json`. Run manually before merging ranking changes and at phase exit.                                                                                                                                                                                                                                                                                           | none                                                       |
| Manual E2E                        | real Qdrant + real provider before each release (as today).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | none                                                       |

Coverage: overall ≥ 80%, `lib/` ≥ 85%. Every PRD acceptance criterion maps to at least one test in the story-level test plans (`verifier` Design Mode).

## 15. Deployment & Rollout

| Phase | Version | Steps                                                                                                                         | Rollback                                                                                                                                  |
| ----- | ------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | 1.2.0   | Publish; `ensureIndexes` adds text indexes on first run; record baseline in PRD changelog.                                    | Reinstall 1.1.x; indexes are harmless.                                                                                                    |
| 2     | 1.3.0   | Publish; users run `memo migrate --to-v2 --dry-run` then real; dev-tasks release adds `MEMO_BANK`, `recall`, episodic writes. | Reinstall 1.2.x; v2 fields ignored; v1 filters still match (`bank` absent treated as `kb` only by 1.3, so 1.2 sees all points as before). |
| 3     | 1.4.0   | Publish; dev-tasks release adds `used` and `decay` at session close; recommend weekly `memo decay --bank kb` cron.            | Reinstall 1.3.x; archived flags ignored by 1.3? No: 1.3 already excludes `archived = true`. Restore via 1.4 `memo restore` if needed.     |
| 4     | 1.5.0   | Publish; `consolidate` opt-in, `--dry-run` first; `promote_to_kb = review` default.                                           | Reinstall 1.4.x; promoted facts remain as ordinary semantic entries.                                                                      |
| 5     | 1.6.0   | Optional.                                                                                                                     | —                                                                                                                                         |

No feature flags; behavior is config-driven and additive. Semver minor per phase; no major bump.

## 16. Dependencies & Risks

| Risk                                                                                     | Mitigation                                                                                         |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Qdrant `text` match requires all tokens of an identifier; partial matches are missed     | Identifier-level `should` clauses (any identifier matches); dense candidates still cover partials. |
| Lexical scroll with vectors on large collections is slow                                 | Base filter narrows to bank/repo; `limit 50`; `--lexical off`.                                     |
| `is_empty` on `bank` requires Qdrant ≥ 1.1; nested `should` inside `must` requires ≥ 1.4 | Requirement already ≥ 1.7.                                                                         |
| Retrieval counter writes add latency or fail                                             | Single batch, best-effort, measured against the 2.5 s target.                                      |
| Noisy rule archives everything in banks without feedback                                 | `feedbackActive` gate (§8.4).                                                                      |
| First `memo decay` after migration archives legacy decisions                             | `stability_since = now` at migration and `kb` semantic initial stability 90 days (A6).             |
| Episodic dedupe collisions                                                               | `seq` in the episodic key; `self` bypasses dedupe (A7).                                            |
| LLM fabricates evidence ids or facts                                                     | id membership validation, duplicate check, `--dry-run`, review-gated promotion.                    |
| `~/.memo` not shared across machines; `memo used` after a query from another host fails  | Documented; `QUERY_NOT_FOUND` is explicit. Cross-host snapshots are out of scope.                  |
| Eval set bias (seeded from dev-tasks queries)                                            | Include file-name and cross-repo queries; refresh at each phase exit.                              |

Dependencies: `@qdrant/js-client-rest` (batch update, text index, `is_empty`), `openai` SDK (embeddings + chat), `zod` v3, no new runtime packages. dev-tasks releases aligned to Phases 2 and 3.

## 17. Open Questions

1. ~~`--max-tokens` default of 2000 for `recall`: confirm or set per bank in config.~~ **Resolved (v1.2):** default 2000, one global key `recall.max_tokens`; per-bank budgets are not needed until a second long-lived agent exists.
2. ~~Qdrant `text` index on `files_modified` (array).~~ **Resolved (S1-06, #62):** verified live on Qdrant 1.18.2 — array elements tokenize independently; both indexes shipped.
3. Should `memo search` counters update only in `--json` mode (agent use) to keep human exploration from inflating stability? Default: update in both modes. (Phase 3.)
4. Consolidation cost table: keep `price_per_1k_tokens` in config (user-maintained) or report tokens only? Default: tokens always, cost when configured. (Phase 4.)

Resolved PRD §18 questions carried into this spec (v1.2):

- **PRD Q1 — private episodic purge default:** stays **on** (`banks.private.episodic.purge_after_days = 30`). Short-term memory must end deleted or promoted (PRD §2.5); §8.4 table unchanged.
- **PRD Q5 — `self` soft cap:** **50** per bank, warning only, configurable as `banks.private.self.soft_cap` (§18.2). A smaller cap tends to force more meaningful self-reflection (each `self` entry must earn its place); a larger cap risks the bank owner ignoring part of its own `SELF` section. Neither direction has been tuned against a real long-lived agent yet, so 50 is a starting point, not a measured optimum.

## 18. Phase 2 — Implementation Detail

Everything in this section is scoped to PRD §7.2 (FR-2.1–FR-2.10) and AC-2.1–AC-2.9, and is written against the merged v1.2.0 codebase. Where §5–§9 state the contract, this section states the concrete change per file so stories and task lists can cite it. Test-first applies: each sub-section ends with the tests that exist before the code.

### 18.1 Starting point (what v1.2.0 actually has)

| Area                  | Shipped state                                                                                                                                                                                                    | Phase 2 delta                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/types/entry.ts`  | Strict v1 `EntryPayloadSchema` (write-time only): `entry_type` 3 values, `source` `agent \| manual`, `dedupe_key_version: 'v1'`.                                                                                 | v2 superset with `superRefine` per kind (§18.3); `normalizeEntry()` for reads (A10).                                |
| `src/types/config.ts` | `schema_version: literal('1')`; `defaults`; `ranking` block complete with refinements.                                                                                                                           | `schema_version` enum; `bank`, `banks`, `recall` blocks (§18.2).                                                    |
| `src/lib/qdrant.ts`   | `ensureCollection`, `ensureIndexes` (10 indexes incl. 2 text), `search`, `scroll` (always `order_by: timestamp_utc desc`), `fetchByRepo`, `getByDedupeKey`, `getById`, `deleteById`, `deleteByFilter`, `upsert`. | +9 indexes; `scrollOrdered`, `scrollAll`, `count`, `setPayload`, `batchSetPayload`, `fetchStalenessCorpus` (§18.4). |
| `src/lib/dedupe.ts`   | `buildDedupeKey` v1 (`v1\|repo\|commit\|story\|entry_type\|source`).                                                                                                                                             | `buildDedupeKeyV2` per kind (A7, §18.5).                                                                            |
| `src/commands/*.ts`   | `setup`, `write`, `search`, `list`, `tags`, `inspect`, `delete`, `read`. Read paths pass payloads through untyped.                                                                                               | New flags on 5 commands; new `timeline`, `recall`, `bank`, `migrate` commands registered in `src/index.ts`.         |
| `src/lib/facets.ts`   | `aggregateField(scroll, field)`, `aggregateMultipleFields`.                                                                                                                                                      | Reused for `bank list` and the `inspect` banks facet.                                                               |
| Staleness             | `detectStaleness` over `fetchByRepo(repos)`.                                                                                                                                                                     | Corpus filter gains `bank` (A12).                                                                                   |

### 18.2 Config v2 (`src/types/config.ts`, `src/lib/config.ts`)

```ts
const KindPolicySchema = z.object({
  initial_stability_days: z.number().positive().optional(),
  expires_in_days:        z.number().int().positive().optional(),
  archive_threshold:      z.number().min(0).max(1).optional(),
  archive_noisy:          z.boolean().optional(),
  promoted_grace_days:    z.number().int().min(0).optional(),
  superseded_grace_days:  z.number().int().min(0).optional(),
  purge_after_days:       z.number().int().positive().nullable().optional(), // null = never
}).strict();

const SelfPolicySchema = z.object({ soft_cap: z.number().int().positive().default(50) }).strict();

banks: z.object({
  kb:      z.object({ episodic: KindPolicySchema, semantic: KindPolicySchema }).default({ ... }),
  private: z.object({ self: SelfPolicySchema, episodic: KindPolicySchema, semantic: KindPolicySchema }).default({ ... }),
}).default({})
bank:   z.object({ default: KebabOrUuid.default('kb') }).default({})
recall: z.object({ max_tokens: z.number().int().positive().default(2000) }).default({})
```

- Defaults are exactly the §8.4 table. `banks.kb.*.purge_after_days` has **no default** (absent = never) — the refinement rejects `banks.kb.*.purge_after_days: undefined` being _set to a number by default_ but accepts an explicit user value.
- `KebabOrUuid = KebabString.or(z.string().uuid())`. The shipped `KebabString` regex is reused unchanged.
- `schema_version: z.enum(['1', '2'])`. `memo setup init` keeps writing `'1'` until the user opts into v2 blocks (`memo setup init --v2` writes `'2'` plus the default `bank`/`banks`/`recall` blocks). `memo setup validate` prints the resolved bank default.
- `policyFor(config, bank, kind)` (`src/lib/bank.ts`) returns the resolved `KindPolicy`; `self` returns `{ soft_cap }` only.

Tests first: `tests/unit/lib/config.test.ts` gains a v2 block — v1 file unchanged still parses; `banks.kb.semantic.purge_after_days` absent → `undefined`; explicit `45` → `45`; `recall.max_tokens: 0` → `CONFIG_INVALID`; `soft_cap` default `50`.

### 18.3 Schema v2 (`src/types/entry.ts`, `src/lib/entry-normalize.ts`)

Write-time schema (`EntryPayloadV2Schema`), as a superset of v1 with these rules in one `superRefine`:

| Rule                               | Check                                                                                                                            | Error path   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| K1 `self` only in private banks    | `kind === 'self' && bank === 'kb'` → issue                                                                                       | `kind`       |
| K2 scope required in `kb`          | `bank === 'kb' && !(repo && org && domain)` → issue (the command raises `REPO_CONTEXT_UNRESOLVED` first, schema is the backstop) | `repo`       |
| episodic needs a session           | `kind === 'episodic' && !session_id` → issue                                                                                     | `session_id` |
| K3 agent semantic needs provenance | `kind === 'semantic' && source === 'agent' && (provenance ?? []).length === 0` → issue                                           | `provenance` |
| `self` carries no retention fields | `kind === 'self' && (stability ?? expires_at ?? retrieval_count) !== undefined` → issue                                          | `kind`       |
| `seq` only on episodic             | `seq !== undefined && kind !== 'episodic'` → issue                                                                               | `seq`        |

Field additions: `schema_version: literal('2')`, `bank: KebabOrUuid`, `kind: enum`, `session_id?: string (1–128)`, `seq?: int ≥ 0`, `contexts?: KebabString[]`, `provenance?: uuid[]`, `valid_from?: iso`, `valid_to?: iso`, `superseded: boolean default false`, `superseded_by?: uuid`, `consolidated: boolean default false`, `consolidated_at?: iso`, `pinned: boolean default false`, `archived: boolean default false`, `archived_reason?: enum`, `archived_at?: iso`, `expires_at?: iso`, `stability?: number`, `stability_since?: iso`, `last_retrieved_at?: iso`, `retrieval_count?: int`, `used_count?: int`, `pending_contradiction: boolean default false`, `dedupe_key_version: enum(['v1','v2'])`. `entry_type` gains `policy`, `observation`; `source` gains `scan`. `repo`/`org`/`domain` become optional at the schema level (K2 enforces them in `kb`).

Read boundary (`normalizeEntry(payload: Record<string, unknown>): StoredEntry`, pure): `bank ??= 'kb'`, `kind ??= 'semantic'`, `schema_version ??= '1'`, booleans `??= false`, `valid_from ??= timestamp_utc` when `kind !== 'episodic'`. Every command that renders or ranks a payload calls it once; nothing else in the read path changes type.

`sourceToConfidence` gains `scan → 'low'`.

Tests first: `tests/unit/types/entry.test.ts` (new) — one case per rule row above, plus "v1 payload parses under v2 schema when `bank`/`kind` supplied"; `tests/unit/lib/entry-normalize.test.ts` — v1 point → `kb/semantic/false*`; v2 point untouched.

### 18.4 `QdrantRepository` extensions (`src/lib/qdrant.ts`)

Indexes appended to `PAYLOAD_INDEXES` (created by the shipped `ensureIndexes()` reconciliation, no new mechanism): `bank`, `kind`, `session_id`, `contexts` (keyword), `seq` (integer), `archived`, `superseded`, `consolidated`, `pinned` (bool), `valid_to`, `expires_at`, `archived_at` (datetime). Twelve new — `entry_type` is already indexed.

New methods:

```ts
scrollOrdered(filter, { orderBy: { key, direction }, limit, withVector? })   // single page; order_by requires an index on key
scrollAll(filter, { batch = 256, withVector = false }, onPage)             // unordered; loops on next_page_offset until null
count(filter): Promise<number>                                              // client.count({ filter, exact: true })
setPayload(id, payload)                                                     // client.setPayload({ points: [id], payload, wait: true })
batchSetPayload(ops: { id, payload }[])                                     // client.batchUpdate({ operations: ops.map(set_payload), wait: true })
fetchStalenessCorpus({ bank, repos }, limit = 1000)                         // replaces fetchByRepo: base filter (§8.1) + repo any-match when bank = kb
```

- **Pagination rule (A11):** the shipped `scroll()` keeps its `order_by: timestamp_utc desc`. `scrollAll` sends **no** `order_by` and pages with `offset: next_page_offset`. `scrollOrdered` sends `order_by` and never `offset`; callers that need "next page" of an ordered scan pass `order_by.start_from` — Phase 2 has no such caller (`timeline --last` is a single bounded page).
- `getById` keeps its `has_id` scroll. `fetchByRepo` is removed once `search.ts` moves to `fetchStalenessCorpus` (single caller).
- `batchSetPayload` chunks at 256 operations; `setPayload`/`batchSetPayload` map failures to `QDRANT_OPERATION_FAILED`.

Tests first: `tests/unit/lib/qdrant.test.ts` — `scrollAll` follows `next_page_offset` across 3 mocked pages and never sends `order_by`; `scrollOrdered` sends `order_by` and no `offset`; `batchSetPayload` chunks 300 ops into 2 calls; `fetchStalenessCorpus` filter shape for `kb` vs private. `tests/integration/lib/qdrant.test.ts` — `ensureIndexes` creates exactly the 12 missing indexes on a v1.2.0-shaped `payload_schema` and none on a second run.

### 18.5 Bank resolution, base filter, dedupe v2 (`src/lib/bank.ts`, `src/lib/filters.ts`, `src/lib/dedupe.ts`)

`bank.ts` and `buildBaseFilter` exactly per §8.1. Composition with the shipped builders: `buildSearchFilters` / `buildListFilters` keep their signatures and gain one input `base: QdrantFilter`; they concatenate `must`, `must_not`, `should` arrays (never nest). The `repo` clause they add today becomes conditional on `bank === 'kb' || explicitRepo`. `search.ts`'s `buildLexicalScrollFilter` receives the same `base` so the lexical scroll never widens across banks.

Dedupe (A7):

```ts
buildDedupeKeyV2({ bank, kind, repo, commit, story, session_id, seq, entry_type, source });
// semantic: v2|bank|repo??na|commit??na|story??na|na|semantic|entry_type|source
// episodic: v2|bank|repo??na|commit??na|story??na|session|seq|episodic|entry_type|source
// self:     sha256('self|' + randomUUID())   → never matches
```

`getByDedupeKey` is unchanged; a v2 write also checks the v1 key when `bank === 'kb' && kind === 'semantic'` so a pre-migration duplicate is still caught (one extra scroll, `kb` semantic only).

Tests first: `tests/unit/lib/bank.test.ts` (resolution order B3 with env/config/flag permutations; `defaultKind`; `policyFor` incl. `kb` purge absence), `tests/unit/lib/filters.test.ts` (`kb` `should`+`is_empty` shape; private exact; `all` excludes `self`; default exclusions; `asOf` shape; `session`), `tests/unit/lib/dedupe.test.ts` (v2 keys, `self` never collides, v1 fallback path).

### 18.6 `memo write` v2 (`src/commands/write.ts`)

Flags added: `--bank <id>`, `--kind <self|episodic|semantic>`, `--session <id>`, `--seq <n>`, `--context <kebab>` (repeatable, Commander `collect`), `--provenance <csv>`, `--manual`, `--supersedes <id>`, `--pin`, `--expires-in <duration>` (`\d+[dhm]`, days/hours/minutes). `--entry-type` help text lists all five values; `--source` accepts `scan`.

Order of operations (replaces steps at `write.ts:103–180`):

1. `bank = resolveBank(flags.bank, env, cfg)`; `kind = flags.kind ?? defaultKind(bank)`; `policy = policyFor(cfg, bank, kind)`.
2. Scope: in `kb`, resolve `repo/org/domain` exactly as today (`REPO_CONTEXT_UNRESOLVED` on miss). In a private bank, use them if present, never require them.
3. `--manual` forces `source = manual`. `entry_type` default: `observation` when `kind === 'episodic'`, else `decision`.
4. Build payload: `schema_version: '2'`, `bank`, `kind`, `contexts`, `provenance`, `pinned`, `valid_from = now` (self, semantic), retention fields from policy (`stability = policy.initial_stability_days`, `stability_since = now`, counters `0`) except `self`; episodic: `session_id`, `expires_at = now + (expiresIn ?? policy.expires_in_days)`, `seq = flags.seq ?? nextSeq(bank, session)` where `nextSeq` = `scrollOrdered({ bank, kind: episodic, session_id }, { orderBy: seq desc, limit: 1 })` + 1, `0` when empty.
5. Validate with `EntryPayloadV2Schema` (§18.3) → `VALIDATION_FAILED` with the same bullet formatting as today.
6. `--supersedes <id>`: `getById`; missing → `ENTRY_NOT_FOUND`; `normalizeEntry(target)` must have the same `bank` and `kind` → else `VALIDATION_FAILED`; already `superseded` → `VALIDATION_FAILED` ("already superseded by <id>").
7. `self` soft cap: `count({ bank, kind: self, superseded: false }) >= policy.soft_cap` → push warning `self entries in <bank>: <n> (soft cap <cap>)`; human mode prints it on stderr, JSON adds `warnings: string[]`. Never blocks.
8. Dedupe per §18.5; duplicate handling unchanged (`--on-duplicate`, TTY prompt, JSON error).
9. Embed and `upsert` as today.
10. If step 6 applied: `setPayload(target.id, { valid_to: now, superseded: true, superseded_by: newId })`. **Not transactional:** if this call fails after the upsert succeeded, the command exits 2 with `QDRANT_OPERATION_FAILED` and the message names the new id and the target id so the operator can re-run `memo write --supersedes` (which now hits the "already superseded" guard if the payload did land) or repair by hand. The new entry is never rolled back.
11. Result JSON: full v2 payload + `created`, `updated`, `duplicate_detected`, `superseded?: <id>`, `warnings?`.

Tests first (`tests/unit/commands/write.test.ts`, `tests/integration/commands/write.test.ts`): AC-2.1 (`--kind self` in `kb` → exit 1 `VALIDATION_FAILED`; with `MEMO_BANK=jarvis-memory` → point carries `bank`, `kind`), AC-2.2 (default kind by bank), AC-2.8 (supersede sets `valid_to`/`superseded_by` on the target; different-kind target rejected), auto-`seq` increments, `--expires-in 2d` vs policy default, soft-cap warning at exactly `soft_cap`, step-10 failure message contains both ids, v1 duplicate still detected in `kb`.

### 18.7 Read-side flags: `search`, `list`, `tags list`, `read`

Shared flag parsing lives in `src/lib/read-flags.ts`: `parseReadFlags(opts, env, cfg) -> { bank, kind, session, includeArchived, includeSuperseded, asOf }`, with `--kind` validated against `self|episodic|semantic|all` and `--as-of` against ISO 8601 (`VALIDATION_FAILED` otherwise). `--as-of` implies `includeSuperseded`.

- `search.ts`: base filter into `buildSearchFilters` and `buildLexicalScrollFilter`; staleness corpus via `fetchStalenessCorpus({ bank, repos })`; `responseFilters` adds `bank`, `kind`, `session?`, `as_of?`; per-result JSON adds `bank`, `kind`, `session_id?`, `seq?`, `valid_from?`, `valid_to?`, `superseded_by?`, `archived?`, `pinned?` (from `normalizeEntry`); human lines prefix `[archived]` / `[superseded]` when included. Ranking is untouched; `self` never enters `rankResults` (excluded by filter unless `--kind self`, and then returned newest-first unranked with `final_score` omitted).
- `list.ts`, `tags.ts`: same base filter; `list` JSON rows add the same v2 fields.
- `read.ts`: prints every v2 field present; `provenance` rendered via one `scroll({ has_id: provenance })` and each missing id suffixed `(deleted)`; JSON gives `provenance: [{ id, deleted: boolean }]`.
- AC-2.3 guard: with no new flags and no migration run, the base filter for `kb`/`all` is `bank ∈ {kb, absent}`, `kind ≠ self`, `archived ≠ true`, `superseded ≠ true` — every v1 point passes, so result sets are identical to v1.2.0. This is asserted by a replay-style test: `candidates.json` fixture ids through the v2 filter path return the same top-N as the recorded Phase 1 run.

Tests first: `tests/unit/lib/read-flags.test.ts`; `tests/unit/commands/search.test.ts` (AC-2.4 two-bank isolation on a mocked repo; filter shape passed to `search()`; `--kind self` path), `list`, `tags`, `read` (`(deleted)` marker) unit updates; `tests/relevance/replay.test.ts` gains the AC-2.3 identity assertion.

### 18.8 `memo timeline` (`src/commands/timeline.ts`)

Flags: `--bank <id>` (resolution B3), `--session <id>`, `--last <n>` (default 50, max 500), `--since <iso>`, `--json`. Two query shapes, both `kind = episodic`, default exclusions applied:

- with `--session`: `scrollOrdered({ ...base, session_id }, { orderBy: { key: 'seq', direction: 'asc' }, limit: last })`; ties on `seq` (only possible with explicit `--seq`) are broken client-side by `timestamp_utc` asc.
- without: `scroll(base, last)` (existing `timestamp_utc desc`), then group by `session_id` preserving order; JSON `sessions: [{ session_id, entries }]`, human prints a session header per group.

`--since` adds `timestamp_utc >= since` to `must`. Never calls embeddings or `rankResults`. Empty bank → exit 0, `count: 0`.

Tests first: `tests/unit/commands/timeline.test.ts` — AC-2.5 (mock returns points out of seq order → output in seq order; a high-similarity entry cannot move), grouping without session, `--last` cap, `--since` filter shape, no embeddings adapter constructed.

### 18.9 `memo recall` (`src/commands/recall.ts`, `src/lib/recall.ts`)

`assembleRecall` is pure per §8.5. Command-side gathering, in this order, with `vector = embed(task)` computed once:

| Section        | Source                                                                                                                                                                  | Cap | Omitted when                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------- |
| `SELF`         | `scroll({ bank, kind: self, superseded ≠ true }, soft_cap + 1)` newest first; warn on stderr if `> soft_cap`                                                            | all | `bank = kb`                                                 |
| `POLICIES`     | `search(vector, base(kb, kind: semantic) + entry_type = policy, 8)` ranked                                                                                              | all | never (empty array in Phase 2 unless PRD-003 entries exist) |
| `SHARED`       | `search(vector, base(kb, kind: semantic) + repo scope per `--scope`, overfetch)` + lexical scroll → `rankResults` → top 8; `stale` annotation computed with `kb` corpus | 8   | never                                                       |
| `MINE`         | same pipeline against `base(bank, kind: semantic)`                                                                                                                      | 5   | `bank = kb`                                                 |
| `LAST SESSION` | `scroll({ bank, kind: episodic }, 1)` → `session_id`; then `scrollOrdered({ bank, kind: episodic, session_id }, { seq asc, limit: 15 })`                                | 15  | `bank = kb`                                                 |
| `CONFLICTS`    | `scroll({ bank, pending_contradiction: true }, 5)` (empty until Phase 4)                                                                                                | 5   | never                                                       |

Calls: 1 embed, ≤3 dense queries, ≤2 lexical scrolls, ≤4 scrolls, 0 writes (A14) — inside the §11 `< 4 s` target. `query_id = randomUUID()` at envelope level exactly as `search` does today. Budget: `tokens(entry) = ceil(renderedLine.length / 4)`; trimming order `conflicts → last_session (oldest first) → mine → shared → policies`; `self` never trimmed even when it alone exceeds the budget (then `truncated` lists every other section and `budget.used_tokens > max_tokens` is reported honestly). Dedup: an id appearing in an earlier section is dropped from later ones before trimming.

Human output per §10. `--scope` accepted values `repo|related` (default config `defaults.search_scope`), applied to `SHARED` only.

Tests first: `tests/unit/lib/recall.test.ts` — AC-2.6 table: SELF complete and first; superseded `self` absent; SELF intact under a budget smaller than SELF; dedup across sections; trimming order; single `query_id`; `bank = kb` omits three sections. `tests/unit/commands/recall.test.ts` — call count/shape on the mocked repo; no `setPayload`/local write occurs.

### 18.10 `memo bank` (`src/commands/bank.ts`)

- `init --id <id> [--rationale] [--tags] [--set-default] [--json]`: validate id (`KebabOrUuid`, and `≠ 'kb'` → `VALIDATION_FAILED`); `count({ bank: id })` `> 0` → print existing summary, exit 0, write nothing; else delegate to the `write` handler with `{ bank: id, kind: 'self', source: 'manual', entryType: 'structure', rationale: flags.rationale ?? 'Bank <id> initialised.', tags: flags.tags ?? 'bank,self' }`; with `--set-default`, `writeConfig({ ...cfg, bank: { default: id } })` (A13). JSON: `{ bank, created: boolean, self_id, default_set: boolean }`.
- `list [--json]`: `aggregateField('bank', scroll)` (the shipped signature is `(field, scroll, filter?)`, not `(scroll, field)`) with v1 points (no `bank`) folded into `kb`; per bank, three `count()` calls (one per kind, default exclusions). JSON `{ banks: [{ bank, counts: { self, episodic, semantic }, total }] }`. `list` and `show` are independent of `inspect`'s `--orgs`/`--repos`/`--domains` narrowing flags — banks are a separate axis and private-bank entries may have no `repo`/`org` at all, so narrowing by those would silently hide private banks; `bank list`/`show` never accept them.
- `show --id <id> [--json]`: `SELF` scroll as in §18.9, counts per kind and per state (`active`, `archived`, `superseded`), and `last_session_id` from the `LAST SESSION` first scroll.
- `inspect`: adds `banks` to `aggregateMultipleFields` output (counts only).

Tests first: `tests/unit/commands/bank.test.ts` — `init` idempotency, `kb` rejected, `--set-default` is the only path that calls `writeConfig`; `list` folds absent `bank` into `kb`; `show` ordering newest-first.

### 18.11 `memo migrate --to-v2` (`src/commands/migrate.ts`, `src/lib/migrate.ts`)

`planMigration(points: StoredEntry[], now, rules: MigrationRule[], policies) -> { ops: { id, payload }[], byRule: Record<string, number>, skipped: number }` — pure; a point with `schema_version === '2'` is `skipped`. Default rules are FR-2.8; `--rules <file>` replaces them with a JSON array evaluated in order, first match wins:

```json
[
  {
    "name": "1",
    "when": { "tags_any": ["intent", "outcome"] },
    "set": { "kind": "episodic", "session_from": "story", "expires_in_days": 90 }
  },
  { "name": "2", "when": {}, "set": { "kind": "semantic" } }
]
```

`when` supports `tags_any`, `tags_all`, `entry_type_in`, `source_in`, `repo_in`; `set.kind` is required; `session_from` (`story | legacy`) and `expires_in_days` apply to episodic only. A rules file that leaves any point unmatched fails validation before the scan (`VALIDATION_FAILED`, "rule set is not exhaustive: add a final rule with empty `when`"). Every op also sets the "all" row of FR-2.8 (`bank = kb`, `schema_version = '2'`, `consolidated/archived/superseded/pinned = false`, counters `0`, `stability` from `banks.kb.<kind>`, `stability_since = now`, `valid_from = timestamp_utc` for semantic).

Command: `scrollAll(filterLacking('schema_version'), { batch: 256 }, page => batchSetPayload(planMigration(page).ops))`; `--dry-run` runs the planner and prints counts, writes nothing; progress on stderr unless `--json`. `filterLacking` = `must: [{ is_empty: { key: 'schema_version' } }]`. Nothing archived, nothing deleted, no vector touched. Second run: `scanned: 0`.

Tests first: `tests/unit/lib/migrate.test.ts` — rule 1 vs rule 2 on fixture points; `story` → `session_id`, absent → `legacy`; `expires_at = timestamp_utc + 90 d`; v2 points skipped; exhaustiveness check; custom rules file. `tests/integration/commands/migrate.test.ts` — AC-2.7: dry-run issues zero `batchSetPayload`; real run issues one per page; second run scans zero; no `delete*` call ever (asserted on the mock).

### 18.12 dev-tasks consumer (FR-2.10) — cross-repo partition

Scope spans two `primary` components (`llipe/memo-cli`, `llipe/dev-tasks`), so per RF-63 this ships as **two stories in producer → consumer order**:

1. memo-cli story set (S2-01…S2-09 below) delivers the CLI contract; the boundary contract is "memo-cli **1.3.0** `--json` envelopes for `write`, `recall`, `timeline`, `bank`, `migrate` as specified in §6.1 and §18.6–§18.11".
2. dev-tasks story (consumer): `memo-cli-usage` SKILL.md/REFERENCE.md and the `developer`, `technical-writer`, `product-engineer`, `planner` definitions — each long-lived agent declares `MEMO_BANK`; session start `memo recall "<task>" --bank $MEMO_BANK --json`; intent/outcome writes become `memo write --kind episodic --session ISSUE-<n> …`; ADRs/decisions stay `kb` semantic; session close is a no-op until Phase 3 adds `used`/`decay`. Acceptance references the 1.3.0 contract, never memo-cli internals. The copy of the skill under this repo's `.claude/skills/memo-cli-usage/` is updated in the same story so both consumers agree.

No `infra-engineer` pass: Phase 2 has no secrets, deploy, DNS, IAM, or shared-project migration scope (`memo migrate` is a user-run payload update on the user's own Qdrant, gated by `--dry-run`).

### 18.13 Delivery slicing (input to `activity-generate-stories`)

| Story | Scope                                                                                                                                                                          | Depends on   | PRD AC                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ---------------------- |
| S2-01 | Config v2 + schema v2 + `normalizeEntry` (§18.2, §18.3)                                                                                                                        | —            | AC-2.1 (schema half)   |
| S2-02 | `QdrantRepository` extensions + 12 indexes (§18.4)                                                                                                                             | —            | —                      |
| S2-03 | `bank.ts`, `filters.ts`, dedupe v2 (§18.5)                                                                                                                                     | S2-01        | AC-2.4 (filter half)   |
| S2-04 | `memo write` v2 incl. `--supersedes`, soft cap (§18.6)                                                                                                                         | S2-01–03     | AC-2.1, AC-2.2, AC-2.8 |
| S2-05 | Read-side flags on `search`/`list`/`tags`/`read`, bank-aware staleness (§18.7)                                                                                                 | S2-02, S2-03 | AC-2.3, AC-2.4         |
| S2-06 | `memo timeline` (§18.8)                                                                                                                                                        | S2-02, S2-03 | AC-2.5                 |
| S2-07 | `memo recall` (§18.9)                                                                                                                                                          | S2-05, S2-06 | AC-2.6                 |
| S2-08 | `memo bank init/list/show`, `inspect` banks facet (§18.10)                                                                                                                     | S2-04        | —                      |
| S2-09 | `memo migrate --to-v2` (§18.11)                                                                                                                                                | S2-01, S2-02 | AC-2.7                 |
| S2-10 | dev-tasks consumer (§18.12)                                                                                                                                                    | S2-04, S2-07 | AC-2.9                 |
| S2-11 | Phase 2 exit gate: `eval:relevance` ≥ 96.4% floor with v2 filters, docs sweep (AC-0.2), coverage gate on touched files, release notes for 1.3.0 (tag/publish remain human-run) | all          | AC-0.1, AC-0.2         |

S2-01, S2-02 are independent and can run first in parallel; S2-03 unblocks the rest.

### 18.14 Design Mode clarifications (resolved before implementation)

The 11 `verifier` Design Mode test plans for S2-01…S2-11 (issues #53, #81–#90) each surfaced open questions the sections above left implicit. None of these change any acceptance criterion; all are gap-fills so `developer` has one unambiguous answer per point instead of a "primary hypothesis." Two (marked ✅ human-confirmed) were explicit product decisions; the rest are direct readings of already-stated normative text or the shipped codebase, made explicit here.

| #   | Story | Question raised                                                                           | Resolution                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ----- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | S2-01 | `normalizeEntry`'s behavior when `timestamp_utc` is absent                                | Not `normalizeEntry`'s concern: `timestamp_utc` is `z.string()` **required** on both `EntryPayloadSchema` (v1) and `EntryPayloadV2Schema` (v2) — no valid stored point can lack it. A point missing it fails schema validation on read, upstream of normalization, and is not a case `normalizeEntry` needs to handle.                                                             |
| 2   | S2-04 | Exit code when a `--supersedes` target does not exist                                     | `ENTRY_NOT_FOUND`, exit `1` — per the existing error catalog (`docs/technical-guidelines.md` §4), unchanged for Phase 2.                                                                                                                                                                                                                                                           |
| 3   | S2-04 | Exit code for the `--supersedes` self-reference guard (`target.id === id`)                | `VALIDATION_FAILED`, exit `1` — same code as every other §18.6 step-6 rejection (other bank, other kind, already superseded); a self-reference is one more shape of "invalid supersede target," not a distinct error class.                                                                                                                                                        |
| 4   | S2-04 | Is the soft-cap warning's `<n>` the pre-write or post-write `self` count?                 | **Pre-write.** §18.6's step order has the soft-cap check (step 7) before dedupe/embed/upsert (steps 8–9); the count reflects the bank's state _before_ this write lands, so the warning reads "you already have `n`, this one makes `n+1`."                                                                                                                                        |
| 5   | S2-05 | `--kind` case sensitivity                                                                 | **Case-insensitive** (human-confirmed): `--kind Self`, `--kind SELF`, `--kind self` all normalize to `self`. `read-flags.ts` lowercases before matching against `self \| episodic \| semantic \| all`.                                                                                                                                                                             |
| 6   | S2-05 | Does `--as-of` accept a date-only value (`2026-01-01`)?                                   | **Yes** (human-confirmed): a date-only string is treated as `2026-01-01T00:00:00.000Z`; a full ISO-8601 datetime is also accepted. `read-flags.ts` validates with a regex covering both shapes before parsing.                                                                                                                                                                     |
| 7   | S2-06 | Exit code for `--last 0`                                                                  | `VALIDATION_FAILED`, exit `1` — consistent with every other out-of-range flag value in the codebase (e.g. `write`'s `--on-duplicate`).                                                                                                                                                                                                                                             |
| 8   | S2-06 | Where does the `--last 501` clamp-to-500 warning go?                                      | Stderr only (human and `--json` modes both clamp silently in the JSON envelope; the warning line is not a JSON field) — `timeline` has no `warnings` array in its envelope (unlike `write`'s v2 result), and adding one is out of scope for this story.                                                                                                                            |
| 9   | S2-07 | `bank=kb` JSON shape: are `self`/`mine`/`last_session` omitted keys or empty arrays/null? | **Omitted keys** — FR-2.6 says "omitted," not "empty." `sections` for a `kb` recall contains only `policies`, `shared`, `conflicts`. `truncated` never names an omitted section, only a present-but-trimmed one.                                                                                                                                                                   |
| 10  | S2-07 | Error code when one section's sub-query fails mid-gather (not the initial embed)          | No new code: the error propagates as whichever underlying call failed (`QDRANT_OPERATION_FAILED` or `EMBEDDING_API_ERROR`); `recall` does not catch and re-wrap per-section failures into a bundle with partial results — a failed section fails the whole command, consistent with A14 (recall does no best-effort degrading, unlike `search`'s lexical-scroll-failure fallback). |
| 11  | S2-08 | Does a second `bank init --set-default` re-write `memo.config.json`?                      | Yes, unconditionally, whenever `--set-default` is passed — `writeConfig` is idempotent (same value in, same value out) and simplicity beats a needless read-compare-skip.                                                                                                                                                                                                          |
| 12  | S2-08 | Do `bank show`'s per-kind counts include superseded/archived entries?                     | Already answered by §18.10: counts are reported **per kind and per state** (`active`, `archived`, `superseded`) — there is no single collapsed per-kind number to be ambiguous about.                                                                                                                                                                                              |
| 13  | S2-08 | Does the `inspect` `banks` facet respect `--orgs`/`--repos`/`--domains`?                  | No — see the §18.10 edit above; banks are an orthogonal axis and private-bank entries may lack `repo`/`org` entirely.                                                                                                                                                                                                                                                              |
| 14  | S2-09 | May a custom `--rules` entry set `kind: episodic`?                                        | Yes — §18.11 already documents `session_from`/`expires_in_days` as episodic-only rule fields, which presupposes a rule can target `episodic`; this only makes it explicit. The exhaustiveness and `set.kind`-required checks apply the same regardless of which kind a rule targets.                                                                                               |
| 15  | S2-09 | Bank-preservation for a point that already has `bank` but no `schema_version`             | Already answered in the story's own edge-case list: the existing `bank` value is preserved, only `schema_version` and the other "all" fields are set. No change needed.                                                                                                                                                                                                            |
| 16  | S2-11 | Does the eval category set change for Phase 2?                                            | No — the same four Phase 1 categories (`concept`, `identifier`, `cross-repo`, `recency`) apply; Phase 2 adds no new memory content types to `tests/fixtures/relevance/`.                                                                                                                                                                                                           |
| 17  | S2-11 | Scope of "eval on an un-migrated `memo_eval` state must also pass"                        | This is S2-05's AC-2.3 identity assertion (default search results identical pre/post the read-side-flags change), not a separate S2-11 concern — S2-11's own eval run happens _after_ S2-09's migration, per task 11.1.                                                                                                                                                            |

Traceability: items 1, 4, 12, 15, 17 resolve by re-reading already-stated text; items 2, 3, 7, 9, 11, 13, 14, 16 resolve by applying an existing repo-wide convention (error catalog, idempotent-write default, orthogonal-facet default); items 5 and 6 were explicit human decisions (2026-09-21).
