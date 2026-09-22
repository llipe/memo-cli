# ADR-003: One Collection, `bank` + `kind` Payload Isolation

## Status

Accepted

## Context

PRD-004 Phase 2 ("Banks, kinds, sessions, recall") introduced per-agent, private memory (`self` persona, `episodic` session narration) alongside the existing shared `kb` semantic knowledge base, plus session-ordered replay (`memo timeline`) and one-call context restore (`memo recall`). Before this phase, the Qdrant `decisions` collection held a single kind of point — shared semantic decisions, implicitly scoped by `repo`/`org`/`domain` only.

Extending memo-cli to support multiple isolated memory namespaces (banks) and multiple memory natures (kinds) raised a foundational data-model question: does each bank get its own Qdrant collection, or does the whole system stay on one collection with isolation enforced in the payload and query layer?

A second, related decision: on read, should stored payloads be strictly re-validated against the current (v2) Zod schema, or trusted as already-shaped and defaulted at the boundary?

GitHub issues #81 (payload schema/config v2), #82 (bank resolution, filters), #84 (search/list/read v2 wiring), #85 (`memo timeline`), #86 (`memo migrate --to-v2`), #87 (`memo bank`), and #88 (`memo recall`) implement the decision recorded here (spec §3 decisions A1, A2, A10).

## Decision

**A1 — One collection; `bank` and `kind` are indexed payload keywords.** The existing `decisions` collection (renamed conceptually, not physically, to "the memo collection") holds every entry regardless of bank or kind. `bank` (kebab-case id or UUID, default `kb`) and `kind` (`self | episodic | semantic`) are new indexed keyword payload fields. Every read path (`search`, `list`, `tags list`, `read`, `timeline`, `recall`, `bank show`) composes a shared `buildBaseFilter()` (`src/lib/filters.ts`) that always includes the bank/kind/state predicate — there is no read path that can accidentally cross a bank boundary by omission, because the filter is built once and reused, not reimplemented per command.

**A2 — Boolean mirrors for state, datetimes for "when".** Lifecycle state (`archived`, `superseded`, `consolidated`, `pinned`) is stored as indexed booleans, each with a companion datetime (`archived_at`, `valid_to`, `consolidated_at`) carrying the timestamp. Qdrant filters on booleans are exact and index-backed, and `must_not archived=true` matches points that lack the field entirely — which is exactly the v1-point default behavior this phase needs, with no `is_null` special-casing.

**A10 — Payloads are never Zod-parsed on read; `normalizeEntry()` fills v1 gaps at the boundary.** `src/lib/entry-normalize.ts`'s `normalizeEntry()` is a pure function that defaults `bank ??= 'kb'`, `kind ??= 'semantic'`, `schema_version ??= '1'`, every lifecycle boolean `??= false`, and `valid_from ??= timestamp_utc` for non-episodic kinds. It is applied at every read boundary (`search`/`list` via `projectV2Fields()`'s additive-only JSON projection, `read`/`write --supersedes` directly) instead of re-validating stored payloads against `EntryPayloadV2Schema`.

## Alternatives Considered

### Alternative 1: One Qdrant collection per bank

Rejected. Qdrant Cloud's free/low tiers price and provision per collection; one collection per long-lived agent does not scale to "hundreds of agents" the way one shared collection with a payload predicate does. It would also force every cross-cutting operation (facets, `inspect`, org-wide `delete`) to fan out across N collections instead of a single scroll/filter pass, and would prevent a bank's `self`/`episodic` entries from ever being promoted into `kb` via a simple payload rewrite (they would need a cross-collection copy instead).

### Alternative 2: Separate index/keyword strategy per bank (dynamic collection naming or prefixed indexes)

Rejected as unnecessary complexity: a single `bank` keyword index does the same isolation job as a naming convention would, without multiplying the number of indexes `ensureIndexes()` has to reconcile or the number of `QdrantRepository` code paths that need bank-awareness.

### Alternative 3: Strict Zod re-validation of every stored payload on read

Rejected. The collection was seeded and written to under the v1 schema for a full prior phase (Phase 1) and will continue to accept reads from memo-cli 1.2.x during the 1.3.0 rollout window (`docs/requirements/prd-004-long-lived-agent-memory.md` §15's rollback row: "v1 filters still match; `bank` absent treated as `kb` only by 1.3, so 1.2 sees all points as before"). Re-parsing every stored point against the current v2 schema on every read would reject or throw on legitimately-unmigrated v1 points, breaking read availability during the exact window `memo migrate --to-v2` exists to bridge. A pure, additive `normalizeEntry()` boundary function achieves the same "every field is well-defined for ranking/display" guarantee without coupling read availability to migration completeness.

## Consequences

**Positive:**

- One collection keeps cost, index management, and cross-bank/cross-agent operations (`inspect`, org-wide `delete`, facets) linear in complexity regardless of how many banks exist.
- The shared `buildBaseFilter()` predicate means bank/kind isolation is enforced in exactly one place; a new read command inherits correct isolation by construction instead of by each author remembering to add a filter clause (verified live: AC-2.4, `memo search --bank a-memory` never returns `b-memory` entries).
- `normalizeEntry()` makes v1→v2 a purely additive, backward-compatible transition: a v1 point is a valid v2 point with defaults, not an invalid one requiring migration before it is readable. `memo migrate --to-v2 --dry-run` is optional cleanup, not a read-availability gate.
- Rollback safety: reinstalling memo-cli 1.2.x after a 1.3.0 rollout still reads every point correctly, because 1.3.0 never wrote a schema shape 1.2.x cannot tolerate (additive-only payload).

**Negative / trade-offs:**

- A single collection means banks are a namespace, not a hard security boundary — this is stated explicitly in `docs/requirements/prd-004-long-lived-agent-memory.md` §17 ("Banks are a namespace, not a security boundary; the v1 shared-cluster policy applies"). Anyone with collection-level Qdrant credentials can bypass the CLI's filter layer and read across banks directly against the API.
- Every read command must remember to route through `buildBaseFilter()`/`resolveBank()` rather than building an ad hoc filter; this is a discipline the codebase enforces by convention and code review, not by the type system.
- `normalizeEntry()`'s trust-on-read model means a malformed or hand-edited payload (bypassing the CLI) is not caught by a read-time schema failure — it is silently defaulted. Write-time validation (`EntryPayloadV2Schema`'s `superRefine`) remains the only hard gate.

**Follow-up actions:**

- None required for Phase 2 close; the cross-repo tuning gap (PRD §18 Q3) and any bank-scoped security hardening remain open items tracked outside this ADR.

## Related

- Requirements: [`docs/requirements/prd-004-long-lived-agent-memory.md`](../requirements/prd-004-long-lived-agent-memory.md) §3 (decisions A1, A2, A10), §17 (Security & Compliance)
- Spec: [`workstream/specification-prd-004-long-lived-agent-memory.md`](../../workstream/specification-prd-004-long-lived-agent-memory.md) §3 "Key architectural decisions"
- Workstream: [`workstream/user-stories-prd-004-phase-2.md`](../../workstream/user-stories-prd-004-phase-2.md) (S2-01 through S2-11), [`workstream/tasks-prd-004-phase-2-plan.md`](../../workstream/tasks-prd-004-phase-2-plan.md)
- Issues: #81, #82, #84, #85, #86, #87, #88
- Docs updated:
  - [`docs/data-model.md`](../data-model.md) ("Config v2", "Entry Payload Schema v2", "Payload Indexes")
  - [`docs/system-overview.md`](../system-overview.md) (Timeline/Recall/Bank/Migrate flows)
  - [`docs/technical-guidelines.md`](../technical-guidelines.md) (architecture trees)
