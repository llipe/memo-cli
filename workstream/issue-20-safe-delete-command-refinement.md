# Issue Refinement: 20 - [PRD-001] Story: Add safe delete command for memo entries

## Changelog

| Version | Date       | Summary            | Author          |
| ------- | ---------- | ------------------ | --------------- |
| 1.0     | 2026-04-17 | Initial refinement | developer-agent |

## Summary

- Goal: Introduce a `memo delete` workflow that supports deleting a single entry by id in both interactive and agent (`--json`) modes, plus guarded bulk deletion by repo/org in interactive mode.
- Primary user impact: Developers can safely remove stale or incorrect entries without manual Qdrant operations.
- Non-goals: Recovery/undo support and bulk deletion by arbitrary filters beyond repo/org.

## Acceptance Criteria

- [ ] `memo delete --id <entry-id>` deletes exactly one entry in interactive mode.
- [ ] `memo delete --id <entry-id> --json` is supported for agent mode and returns machine-readable result.
- [ ] Interactive bulk deletion by repo is supported (e.g. `memo delete --all-by-repo <repo>`).
- [ ] Interactive bulk deletion by org is supported (e.g. `memo delete --all-by-org <org>`).
- [ ] Bulk deletion by repo/org is blocked in agent mode (`--json`) with a clear user error.
- [ ] Interactive bulk deletion requires explicit confirmation before execution.
- [ ] Output reports deletion scope and deleted count for all successful deletion operations.
- [ ] Unit and integration tests cover single delete, bulk delete, and guardrail/confirmation behavior.

## Constraints

- Bulk deletion MUST be interactive-only.
- Confirmation MUST be required for interactive bulk delete operations.
- Existing command style and error taxonomy (`MemoError`) MUST be preserved.

## Risks and Edge Cases

- Risk: Accidental data loss from broad deletion scope.
- Risk: Ambiguous CLI flags (e.g., combining `--id` with bulk flags).
- Edge case: Target id does not exist.
- Edge case: Repo/org filter resolves to zero entries.
- Edge case: User declines confirmation prompt.

## Dependencies

- Qdrant repository layer must support point deletion by id and filtered deletion by payload fields.
- Existing output and error helpers must be extended consistently.

## Testing Notes

- Unit tests: option validation, agent-mode guardrails, confirmation flow behavior, output payload shape.
- Integration tests: end-to-end deletion of one entry and batch deletions by repo/org against test Qdrant.
- Manual checks: interactive confirmation prompt for bulk delete accepts/rejects and behaves correctly.

## Open Questions

- Should single-entry interactive deletion also ask for confirmation, or only bulk deletion?
- Should interactive confirmation support an explicit bypass flag (for example `--yes`) for local scripting?
