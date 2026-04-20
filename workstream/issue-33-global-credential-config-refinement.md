# Issue Refinement: #33 — Global Credential Configuration with Local Directory Overrides

## Changelog

| Version | Date       | Summary                  | Author              |
|---------|------------|--------------------------|---------------------|
| 1.0     | 2026-04-18 | Initial refinement       | product-engineer    |

---

## Summary

- **Goal:** Replace the single-source `.env` credential model with a layered, AWS-CLI-style resolution that lets a globally installed `memo` binary share credentials across all repositories on the same machine, while allowing per-directory overrides.
- **Primary user impact:** Developers with `memo` installed globally no longer need a `.env` file in each repository. Credentials are set once via `memo setup credentials` and reused everywhere.
- **Non-goals:**
  - Remote/distributed config registry (Phase 2).
  - Multi-profile / named-profile support (may follow in a later story).
  - Changes to the `memo.config.json` repo identity schema.
  - Credential rotation or vault integration.

---

## Problem Being Solved

Currently, `memo-cli` reads `QDRANT_URL`, `QDRANT_API_KEY`, `EMBEDDINGS_PROVIDER`, and `EMBEDDINGS_API_KEY` exclusively from environment variables, typically via a `.env` file populated manually in each project. This forces every repository to carry its own `.env` even when the Qdrant instance and embeddings provider are shared across all projects on the same machine. For a globally installed tool, this is a significant friction point.

---

## Design: Layered Credential Resolution

Credentials are resolved in priority order (highest first):

| Priority | Source | Location | Notes |
|----------|--------|----------|-------|
| 1 | Environment variables | `process.env` | Existing behavior; always wins |
| 2 | Local directory file | `.memo.local` in CWD | Per-project override; **must be gitignored** |
| 3 | Global user config | `~/.config/memo/config.json` | Machine-wide default; written by `memo setup credentials` |

Partial merges are supported: a field present in a lower-priority source fills in gaps not covered by higher-priority sources.

### Global Config Format (`~/.config/memo/config.json`)

```json
{
  "qdrant_url": "https://...",
  "qdrant_api_key": "eyJ...",
  "embeddings_provider": "openai",
  "embeddings_api_key": "sk-..."
}
```

### Local Override Format (`.memo.local` in CWD)

Same JSON schema as global config. Only fields present in the file are applied; absent fields fall through to global config or env vars.

### File Permissions

On POSIX systems, both files are written with mode `0600` (owner read/write only). Windows is not affected.

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Config format | JSON (same as `memo.config.json`) | Consistent with existing tooling; easy to read/write with existing Zod/Node.js stack |
| Global config path | `~/.config/memo/config.json` | Follows XDG Base Directory spec; widely used by modern CLI tools |
| Local override filename | `.memo.local` | Clear memo namespace; `.local` suffix signals machine-local content not for VCS |
| **Not** INI format | JSON chosen over INI | INI would require a new parser dependency; JSON matches the existing stack |
| No named profiles (v1) | Single credential set per scope | Keeps complexity low; profiles can follow as a later story |
| `.gitignore` auto-injection | Yes, for `--local` | Prevents accidental credential commits |

---

## Acceptance Criteria

- [ ] `memo setup credentials` prompts interactively for all four credential fields and writes to `~/.config/memo/config.json`.
- [ ] `memo setup credentials --local` writes to `.memo.local` in CWD and injects `.memo.local` into `.gitignore` if not already present.
- [ ] All commands resolve credentials in layered priority order; partial overrides are supported.
- [ ] `memo setup show` displays resolved credential config with per-field source annotations (`env` / `local` / `global`).
- [ ] `memo setup show --json` outputs source map without echoing secret values (`{ "field": { "source": "...", "present": true } }`).
- [ ] Missing `QDRANT_URL` from all sources → `MISSING_CREDENTIAL` error with hint pointing to `memo setup credentials`.
- [ ] Global config directory is created automatically on first write.
- [ ] `0600` permissions applied on POSIX after write.
- [ ] `memo.config.json` (repo identity) is fully unaffected.

---

## Constraints

- **Security:** Secret field values must never be printed to stdout or logged, in any output mode.
- **Backward compatibility:** Existing `.env` / env-var-only workflows must continue to work without change (env vars remain priority 1).
- **No new runtime dependencies:** Use Node.js built-ins (`os.homedir()`, `fs.chmod()`) and existing `zod`/`dotenv` stack.
- **Windows:** `0600` chmod is skipped on Windows (`process.platform !== 'win32'`); document this limitation.

---

## Risks and Edge Cases

| Risk / Edge Case | Mitigation |
|------------------|------------|
| `.memo.local` accidentally committed | Auto-inject into `.gitignore` on `--local` write |
| Global config file not yet created; command expects credentials | Clear `MISSING_CREDENTIAL` error with actionable hint |
| Multiple `QDRANT_URL` sources (env + global) | Env always wins; log source in `show` for debugging |
| Partial `.memo.local` (only some fields set) | Layer merge fills remaining fields from global config |
| XDG `$HOME` not writable | Propagate `NODE:EACCES` as `MemoError('CONFIG_WRITE_FAILED', ...)` |
| Existing `process.env` reads in commands | All six existing commands + future `get` (#32) must be updated |

---

## Dependencies

- S-002 (Issue #2) — `memo setup` base implementation (delivered ✅)
- Issue #32 — `memo get` — coordinate migration to `loadCredentialConfig` across all commands

---

## Testing Notes

- **Unit tests:** `loadCredentialConfig` — all three layers independently, partial merge, env override, missing credential, `getGlobalConfigPath` helper.
- **Unit tests:** `memo setup credentials` wizard — global write path (mocked `fs`), `--local` path, `.gitignore` injection (file exists vs not exists).
- **Unit tests:** `memo setup show` — source annotation rendering, JSON output structure.
- **Integration tests:** Not required for this story (credential resolution is tested via unit tests with mock FS).
- **Manual check:** Run `memo search "..."` with only `~/.config/memo/config.json` set, no `.env` in CWD — verify it works.
- **Manual check:** Add `.memo.local` with a different `QDRANT_URL`, verify local override is used.

---

## Open Questions

- Should `EMBEDDINGS_PROVIDER` default to `openai` at the resolution layer (applied when no source provides a value), or should it remain a hard-coded default in `EmbeddingsFactory`? **Proposed:** Keep default in `EmbeddingsFactory`; `loadCredentialConfig` returns `undefined` for unset optional fields and callers apply defaults.
- Named profiles (e.g., `memo setup credentials --profile staging`)? **Deferred** to a follow-up story.
