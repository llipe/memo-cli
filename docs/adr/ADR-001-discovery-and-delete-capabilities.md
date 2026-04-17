# ADR-001: Discovery and Delete Capabilities (tags, inspect, delete)

## Status

Accepted

## Context

Memo CLI v1.0 provided four commands: `setup`, `write`, `search`, and `list`. While agents and developers could write and retrieve decisions, there was no way to:

- Discover which tags, organizations, repositories, or domains existed in the knowledge base.
- Safely delete individual entries or bulk-delete by repository or organization.

These gaps created friction when managing a growing knowledge base:

- Agents could not enumerate available tags for filtering without first performing a write or search.
- Entries written to stale or retired repositories had no removal path.
- No global inventory existed, making cross-repo knowledge base health checks impossible.

GitHub Issues #18 (`memo tags list`), #19 (`memo inspect`), and #20 (`memo delete`) were raised to address these gaps.

## Decision

Three new commands and one shared library module were added to the CLI:

### `memo tags list` (`src/commands/tags.ts`)
- Lists all unique tags in the current (or related) repository scope with counts.
- Flags: `--scope` (`repo` | `related`), `--sort` (`frequency` | `alpha`), `--json`.
- Backed by `aggregateField('tags', scroll, filter?)` in `lib/facets.ts`.

### `memo inspect` (`src/commands/inspect.ts`)
- Scans the entire Qdrant collection (no scope restriction) and surfaces org, repo, and domain facets.
- Flags: `--orgs`, `--repos`, `--domains`, `--json` (filter to specific facet(s); default: show all).
- Backed by `aggregateMultipleFields(scroll)` in `lib/facets.ts`, which performs a single scroll pass.

### `memo delete` (`src/commands/delete.ts`)
- Deletes a single entry by UUID (`--id`) or bulk-deletes by repo (`--all-by-repo`) or org (`--all-by-org`).
- Always previews the match set and requires confirmation; `--yes` skips the prompt.
- `--json` output is supported for single-entry deletes only; bulk delete with `--json` is a `VALIDATION_FAILED` error by design to protect against accidental programmatic bulk deletion.
- Delegates to `QdrantRepository.deleteById()` and `QdrantRepository.deleteByFilter()`.

### `src/lib/facets.ts` (new shared aggregation utility)
- `aggregateField(field, scroll, filter?)` — array-aware count aggregation for a single named field.
- `aggregateMultipleFields(scroll)` — single-pass simultaneous aggregation of `org`, `repo`, and `domain`, enriching repo entries with their first-observed org and domain.
- Used by both `tags` and `inspect` commands.

### Error codes added to `src/lib/errors.ts`
- `ENTRY_NOT_FOUND` (exit `1`) — raised by `deleteById()` when the specified UUID does not exist.
- `DELETE_FAILED` (exit `1`) — raised when a delete operation is accepted but cannot complete.

### QdrantRepository methods added to `src/lib/qdrant.ts`
- `deleteById(id: string): Promise<void>` — deletes a single point; throws `ENTRY_NOT_FOUND` if absent.
- `deleteByFilter(filter: QdrantFilter): Promise<number>` — filter-based delete; returns deleted count.

## Alternatives Considered

### Alternative 1: Server-side facets API
Qdrant does not expose a native facets/aggregation API at the collection level (as of Qdrant 1.7). Using scroll + in-memory aggregation is the idiomatic approach for this use case.

### Alternative 2: Separate facets for each command (no shared lib)
Each command could have maintained its own scroll loop and accumulator. Rejected: `tags` and `inspect` have identical scroll mechanics; extracting `facets.ts` avoids duplication and reduces test surface.

### Alternative 3: Allow `--json` for bulk delete
Allowing agents to call `memo delete --all-by-org my-company --json` without any TTY check would make it trivially easy to wipe an entire organization's entries in a single non-interactive invocation. Rejected in favor of an explicit bulk-delete guard: `--json` combined with bulk flags always returns `VALIDATION_FAILED`.

## Consequences

**Positive:**
- Agents can enumerate the knowledge base structure programmatically (`memo inspect --json`).
- Tags are discoverable before writing or filtering (`memo tags list --json`).
- Stale entries can be removed safely with review checkpoints.
- `facets.ts` is a reusable aggregation primitive for future commands.

**Negative / trade-offs:**
- Bulk delete in JSON mode is blocked; callers must use interactive-mode or `--yes` for scripts.
- Scroll-based aggregation scales linearly with collection size; large collections may observe latency.

**Follow-up actions:**
- Monitor Qdrant release notes for a native facet/aggregation API that could replace the scroll approach.
- Consider a `--dry-run` flag for `memo delete` in a future iteration.

## Related

- Requirements: [`docs/requirements/prd-001-mvp.md`](../requirements/prd-001-mvp.md)
- Workstream: [`workstream/tasks-issues-18-19-20-plan.md`](../../workstream/tasks-issues-18-19-20-plan.md)
- Docs updated:
  - [`docs/system-overview.md`](../system-overview.md)
  - [`docs/product-context.md`](../product-context.md)
  - [`docs/technical-guidelines.md`](../technical-guidelines.md)
  - [`README.md`](../../README.md)
