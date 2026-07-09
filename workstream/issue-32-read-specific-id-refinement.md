# Issue Refinement: #32 - Read a Specific Memo Entry by ID

## Changelog

| Version | Date       | Summary                                                 | Author           |
|---------|------------|---------------------------------------------------------|------------------|
| 1.0     | 2026-07-09 | Refined existing issue and aligned CLI to `memo read` | product-engineer |
| 1.1     | 2026-07-09 | Finalized naming: adopt `memo read --id` only         | product-engineer |

## Summary

- Goal: Provide a dedicated read command for fetching one exact memo entry by Qdrant point ID.
- Preferred CLI: `memo read --id <id>` (example: `memo read --id 123`).
- Primary user impact: Agents and developers can retrieve the full payload for one known entry without running semantic search or broad list queries.
- Non-goals:
  - Bulk reads.
  - Changes to search ranking.
  - Any write/update/delete behavior.

## Problem Being Solved

Today, users can discover entries with `memo search` and `memo list`, but there is no first-class command focused on reading one exact entry by ID. This creates friction in automation and manual inspection workflows where the entry ID is already known.

## Scope and Command Contract

- Command: `memo read --id <id>`
- Required flag: `--id` (string, Qdrant point ID)
- Optional flag: `--json` for machine-readable output
- Behavior:
  - Resolve one exact entry by ID.
  - Return full stored payload.
  - Read-only operation.

## Acceptance Criteria

- [ ] `memo read --id <id>` returns exactly one entry in human-readable format.
- [ ] `memo read --id <id> --json` returns the full payload as a flat JSON object.
- [ ] Missing `--id` fails with `VALIDATION_FAILED` and a clear message.
- [ ] Non-existent ID fails with `ENTRY_NOT_FOUND` and exit code `1`.
- [ ] Command does not require `memo.config.json`.
- [ ] Command auto-ensures the collection before lookup (consistent with existing read operations).
- [ ] Human output omits empty fields but includes all present payload fields.

## Business Rules

- ID is treated as an opaque string. No command-side UUID format enforcement is required unless already standardized elsewhere.
- Lookup is globally scoped to the collection (no repo/org/domain filter required when ID is provided).
- The command MUST NOT modify data.

## Technical Notes

- Add/confirm repository helper: `getById(id: string): Promise<ScrollResult | null>` in `src/lib/qdrant.ts`.
- Add command implementation file: `src/commands/read.ts`.
- Register command in `src/index.ts`.
- Recommended human output field order:
  - `id`, `repo`, `org`, `domain`, `entry_type`, `source`, `confidence`, `tags`, `rationale`, `commit`, `story`, `files_modified`, `relates_to`, `timestamp_utc`
- In JSON mode, return payload fields without extra wrapper object.

## Risks and Edge Cases

- Invalid or stale IDs: return `ENTRY_NOT_FOUND`.
- Empty payload fields: ensure output rendering omits empty values to avoid noisy output.
- Potential naming confusion with previous proposal (`memo get <id>`): resolved by standardizing on `memo read --id <id>` in docs/tests.

## Dependencies

- Existing Qdrant repository read path and error taxonomy (`MemoError`).
- Existing output module patterns for human/JSON rendering.

## Testing Notes

- Unit tests:
  - Flag validation (`--id` required).
  - Found/not-found behavior.
  - Human vs JSON output shape.
- Integration tests:
  - End-to-end read by known ID.
  - Not-found behavior with expected error code.
- CLI docs/help text should include examples for `memo read --id` and `--json`.

## Decision

- Adopt `memo read --id <id>` as the only supported command contract for this story.
- Do not add a `memo get` alias in this scope.
