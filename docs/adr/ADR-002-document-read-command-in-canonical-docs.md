# ADR-002: Document `memo read --id` in Canonical Docs

## Status

Accepted

## Context

Issue #32 introduced a new read-only command, `memo read --id <id>`, implemented in `src/commands/read.ts` and registered in `src/index.ts`.

The command was already reflected in task/workstream artifacts and user-facing usage examples, but key canonical documentation inventories (system overview, technical architecture command trees, and current-state capability tables) were not fully aligned.

This produced documentation drift where the codebase behavior included a command that was missing from some architecture and capability references.

## Decision

Update canonical documentation to explicitly include `memo read` wherever command inventories and current-state capability summaries are maintained:

- Add `memo read` to command inventory and runtime flows in `docs/system-overview.md`.
- Add `commands/read.ts` to architecture and repository structure sections in `docs/technical-guidelines.md`.
- Add issue #32 (`memo read --id`) to delivered capabilities in `docs/product-context.md`.
- Add `read.ts` to command tree in `README.md` for consistency with project structure.

No behavior, CLI contract, tests, or implementation code changes were made.

## Alternatives Considered

1. Leave docs unchanged because README already had `memo read` usage.
Rejected: canonical docs would remain internally inconsistent and not represent current behavior.

2. Update only one canonical doc (for example, system overview).
Rejected: partial updates preserve cross-document drift.

3. Introduce a new standalone feature note file.
Rejected: violates update-in-place principle and creates unnecessary documentation sprawl.

## Consequences

Positive:
- Canonical docs now consistently represent implemented command surface.
- Reduced ambiguity for contributors and agents relying on command inventories.
- Maintains current-state documentation policy.

Negative:
- Requires ongoing discipline to keep command inventory sections synchronized as commands evolve.

Follow-up:
- Future command additions should include a documentation parity checklist across system overview, technical guidelines, product context, and README structure.

## Related

- Requirements: `docs/requirements/prd-001-mvp.md`
- Workstream:
  - `workstream/issue-32-read-specific-id-refinement.md`
  - `workstream/tasks-issue-32-read-specific-id.md`
- Docs updated:
  - `docs/system-overview.md`
  - `docs/technical-guidelines.md`
  - `docs/product-context.md`
  - `README.md`
