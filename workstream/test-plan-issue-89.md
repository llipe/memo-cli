# Test Plan — Issue #89 (Story S2-10: dev-tasks consumer — `MEMO_BANK`, `memo recall`, episodic writes)

**Mode:** Design Mode (verifier)
**Repository:** `llipe/memo-cli` (cross-repo: also targets `llipe/dev-tasks`)
**Source artifacts:**

- `workstream/user-stories-prd-004-phase-2.md` — Story S2-10 (AC1–AC7)
- `workstream/specification-prd-004-long-lived-agent-memory.md` §18.12 (cross-repo partition, RF-63)
- `docs/requirements/prd-004-long-lived-agent-memory.md` §7.2 FR-2.10, §13 AC-2.9
- Issue #89 body + task checklist (`workstream/tasks-prd-004-phase-2-plan.md`, task 10.0–10.20)

**Document changelog:**

| Date       | Change             | Author   |
| ---------- | ------------------ | -------- |
| 2026-09-21 | Initial test plan. | verifier |

---

## 0. Framing: why this plan is not a code-test plan

Story S2-10 is prompt/skill documentation, not application code. Its own Testing Requirements section states **Unit Tests: none** and **Integration Tests: none** — there is no `src/` change in this repository, only `.claude/skills/memo-cli-usage/{SKILL.md,REFERENCE.md}` and (in the sibling `llipe/dev-tasks` repository) four agent/command definition files. Per the verifier charter's black-box-first rule, this plan derives assertions from **observable behavior of a documentation artifact**: (a) does the documented developer session actually work when run against a real memo-cli 1.3.0 build, and (b) does every command example in the docs match the real `--help` output and JSON envelope shape.

**Blocking precondition found during intake:** as of this writing, the working tree's built CLI reports `memo --version` → `1.2.0`, and none of `recall`, `timeline`, `bank`, `migrate` exist as subcommands (`node dist/index.js recall --help` falls through to the top-level help listing only `setup, write, search, list, tags, inspect, delete, read`). This confirms the story's own stated dependency ("MUST NOT start until S2-04 and S2-07 are merged") is not yet satisfied in this checkout. Every scenario below that requires a live 1.3.0 build is **not executable until S2-04/S2-07 merge**; this plan is written to be ready the moment they do, and the traceability matrix marks those rows `blocked (dependency)` rather than `fail`.

---

## 1. Acceptance Criteria Extraction

| AC ID | Text (paraphrased)                                                                                                                                                                                                            | PRD/Spec anchor          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| AC1   | Each long-lived agent (`planner`, `product-engineer`, `developer`, `technical-writer`) declares a bank id `<agent>-memory` and exports it as `MEMO_BANK`.                                                                     | Spec §18.12; Story S2-10 |
| AC2   | Session start in the `developer` prompt is one `memo recall "<task>" --bank $MEMO_BANK --json` call, replacing a four-command sequence; old sequence stays documented as a fallback for `memo --version < 1.3.0`.             | PRD FR-2.10, AC-2.9      |
| AC3   | Intent/outcome entries: `memo write --kind episodic --session ISSUE-<n> --bank $MEMO_BANK …`; ADR/decision entries stay `memo write --kind semantic` in `kb` with `--provenance` or `--manual`.                               | PRD FR-2.10, AC-2.9      |
| AC4   | Session close documented as a no-op in Phase 2 ("`memo used`/`memo decay` arrive with 1.4.0").                                                                                                                                | Story S2-10              |
| AC5   | `memo-cli-usage` SKILL.md/REFERENCE.md document banks, kinds, `recall`, `timeline`, `bank`, `migrate`, read-side flags, migration guidance (dry-run first); every command example is valid against the 1.3.0 `--help` output. | Story S2-10              |
| AC6   | This repository's `.claude/skills/memo-cli-usage/` copy is byte-identical to the dev-tasks version after the change.                                                                                                          | Story S2-10              |
| AC7   | "Installed but unconfigured" and "not installed" documented behaviors are unchanged by this story.                                                                                                                            | Story S2-10              |

Business rules extracted: bank id is stable for the agent's life and derives from the agent definition name (PRD §15); acceptance references only the 1.3.0 JSON-envelope boundary contract, never memo-cli internals (RF-63).

Non-goal / scope boundary: no data migration in this repository for this story — see §6 (Migration/opt-out).

---

## 2. E2E Scenarios (`activity-e2e-test-design`, framed as manual developer-session scripts)

Since there is no automated harness for prompt prose, each scenario is a literal command transcript a human (or the `developer` agent itself, in a real session) runs and checks output against. Target sandbox: `memo_eval` collection, never `decisions` (production).

### E2E-1 — Session start via single `recall` call (AC1, AC2)

Preconditions: memo-cli 1.3.0 build available on PATH or via `node dist/index.js`; `MEMO_BANK=developer-memory` exported per the updated `developer` prompt.

```
export MEMO_BANK=developer-memory
memo recall "implement task 10.0" --bank $MEMO_BANK --json
```

Expected: exits 0; JSON envelope contains a `query_id`, and `SELF`/`POLICIES`/`SHARED`/`MINE`/`LAST SESSION`/`CONFLICTS` sections (spec §18.9) — first call on a fresh bank should show `MINE` and `LAST SESSION` empty/omitted, `SELF` empty, no crash. Confirms the doc's single-call replacement for the old four-command sequence actually resolves.

### E2E-2 — Two episodic writes land in the bank, `kb` receives none (AC3, Manual/UI Testing in story)

```
memo write --kind episodic --session ISSUE-89 --bank $MEMO_BANK \
  --rationale "Intent: update memo-cli-usage skill for 1.3.0 contract" \
  --tags dev-tasks,memo-cli,skill-update --json

memo write --kind episodic --session ISSUE-89 --bank $MEMO_BANK \
  --rationale "Outcome: skill + prompts updated, manual session recorded" \
  --tags dev-tasks,memo-cli,skill-update --json
```

Expected: both exit 0; JSON `kind: "episodic"`, `bank: "developer-memory"`, `session_id: "ISSUE-89"`, monotonically increasing `seq` (0 then 1, per §18.6 `nextSeq`). Then:

```
memo timeline --bank $MEMO_BANK --session ISSUE-89 --json
```

Expected: both entries returned in `seq` order. Then:

```
memo search "skill update" --bank kb --json
```

Expected: neither episodic entry appears (base filter excludes non-`kb`/other-bank entries per §18.7 AC-2.3 guard) — confirms "`kb` receives no episodic entry."

### E2E-3 — ADR/decision entries stay semantic in `kb` (AC3)

```
memo write --kind semantic --provenance <existing-entry-id> \
  --rationale "ADR: adopt banks for long-lived agent memory" \
  --tags adr,memory,banks --entry-type decision --json
```

Expected: exits 0; JSON `bank: "kb"` (default, no `--bank` given), `kind: "semantic"`. Confirms decision/ADR entries are not routed into a private bank.

### E2E-4 — Session close is a documented no-op (AC4)

No command to run — this is a documentation-only assertion: grep the updated `developer` prompt/skill text for the session-close paragraph and confirm it states no memo action occurs in Phase 2 and names `memo used`/`memo decay` as arriving in 1.4.0. Record as `manual doc read`, not a shell transcript.

### E2E-5 — `MEMO_BANK` unset falls back to `kb` (AC7, edge case; see §4)

```
unset MEMO_BANK
memo recall "implement task 10.0" --json
```

Expected: succeeds against `bank = kb`; `SELF`, `MINE`, `LAST SESSION` sections omitted per spec §18.9's "Omitted when `bank = kb`" column; documented in the skill as expected, not a bug.

---

## 3. Contract Validation (`activity-contract-test-design`, framed as a documentation-contract check)

This is **not** a code contract test (no consumer/provider pact) — it is a check that every command example the updated skill docs present as fact actually matches the real CLI's `--help` output and JSON shape at 1.3.0. Method: for every fenced command example in `SKILL.md`/`REFERENCE.md` that invokes `memo <subcommand>`, run `node dist/index.js <subcommand> --help` against a locally built 1.3.0 and diff flag names/defaults against the doc's prose.

| Contract check ID | Doc claim                                                                                                                               | Verification command                                                            | Pass condition                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| CV-1              | `memo recall "<task>" --bank $MEMO_BANK --json` is valid syntax                                                                         | `node dist/index.js recall --help`                                              | `--bank`, `--json` flags listed; positional `<task>` argument documented                               |
| CV-2              | `memo write --kind episodic --session ISSUE-<n> --bank $MEMO_BANK …` is valid syntax                                                    | `node dist/index.js write --help`                                               | `--kind`, `--session`, `--bank` flags listed with the value sets in spec §18.6                         |
| CV-3              | `memo write --kind semantic … --provenance <csv>` / `--manual` valid syntax                                                             | `node dist/index.js write --help`                                               | `--provenance`, `--manual` flags listed                                                                |
| CV-4              | `memo timeline --bank <id> --session <id> --json` valid syntax                                                                          | `node dist/index.js timeline --help`                                            | `--bank`, `--session`, `--last`, `--since`, `--json` flags listed (spec §18.8)                         |
| CV-5              | `memo bank init/list/show` documented sub-verbs and flags                                                                               | `node dist/index.js bank --help` and `node dist/index.js bank init --help` etc. | sub-verbs `init`, `list`, `show`, `inspect` (as applicable) exist with documented flags (spec §18.10)  |
| CV-6              | `memo migrate --to-v2 --dry-run` documented as dry-run-first                                                                            | `node dist/index.js migrate --help`                                             | `--to-v2`, `--dry-run`, `--rules` flags listed (spec §18.11)                                           |
| CV-7              | JSON envelope fields named in the doc (`query_id`, `bank`, `kind`, `session_id`, `seq`, `warnings`) match the actual JSON keys returned | run each command with `--json` and inspect keys                                 | keys match 1:1; no doc-only field that the CLI does not emit, and no emitted field the doc contradicts |
| CV-8              | `memo --version` gate for the fallback sequence (`< 1.3.0` triggers the four-command fallback)                                          | `node dist/index.js --version`                                                  | doc's version-comparison guidance is unambiguous and matches semver ordering                           |

**Current status of CV-1 through CV-8:** all `blocked (dependency)` — the checked-out build reports `memo --version` = `1.2.0` and `recall`/`timeline`/`bank`/`migrate` are absent from `--help`. Re-run this table in full once S2-04/S2-07 merge and before the S2-10 PR is marked ready.

---

## 4. Edge-Case Catalog (`activity-edge-case-refinement`)

Categorized per the story's own Edge-Case Matrix (all three are explicitly documented fallback paths, not undefined behavior):

| Category                   | Case                                                             | Expected documented behavior                                                                                                                                             | AC                    |
| -------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| State / config             | `MEMO_BANK` unset                                                | Falls back to `kb`; `recall` omits the bank-private sections (`SELF`, `MINE`, `LAST SESSION`); this omission is explicitly called out in the doc, not silently different | AC7, spec §18.9       |
| Version skew               | memo-cli 1.2.x installed (pre-1.3.0)                             | The old four-command session-start sequence is used instead of `memo recall`; doc states the version check (`memo --version < 1.3.0`) that triggers the fallback         | AC2                   |
| Failure mode               | `memo recall` exits 2 on embeddings failure                      | Session continues without the recalled context; a warning is surfaced (not a silent swallow, not a hard session abort)                                                   | AC2, edge-case matrix |
| Auth/permissions           | Not installed at all                                             | Documented behavior "unchanged" per AC7 — i.e., whatever the current skill says for "memo-cli absent" must still hold verbatim after this story's diff                   | AC7                   |
| Installed but unconfigured | `memo setup` never run                                           | Documented behavior "unchanged" per AC7                                                                                                                                  | AC7                   |
| Boundary                   | Two episodic writes in the same session with no explicit `--seq` | `seq` auto-increments (0, 1, …) per §18.6 `nextSeq`; doc's example transcript should show this, not manual `--seq` values, to avoid implying `--seq` is required         | AC3                   |

Verification method for each row: read the updated skill text for the explicit fallback/edge-case paragraph (documentation review), plus — where a live 1.3.0 build exists — reproduce the case live (E2E-5 above covers the `MEMO_BANK` unset row).

---

## 5. Randomized/Property-Based Tactics (`activity-random-test-tactics`)

**Does not apply — explicit opt-out.** This story changes only prose and command examples in skill/prompt files; there is no input domain, state machine, or numeric boundary in this repository's changed surface for a fuzzer or property test to exercise (the underlying `memo write`/`recall`/`timeline`/`migrate` commands already carry their own randomized/property coverage under stories S2-04/S2-07, which is out of scope for this consumer-side audit).

---

## 6. Migration / Opt-Out Rationale

No migration artifact applies to this story. This repository's stored data model is unchanged by S2-10 — the only changes are prompt/skill prose in `.claude/skills/memo-cli-usage/` (and, in `llipe/dev-tasks`, agent/command definitions). There is no `memo migrate` invocation, no schema version bump, and no payload rewrite tied to this story; `memo migrate --to-v2` itself is delivered and tested under task 9.0 / S2-04-S2-09, not here. This is consistent with the story's own "Migration Requirements: not required" section and with the task list's task 10.18.

---

## 7. Execution Checklist

- [ ] Confirm S2-04/S2-07 merged and a 1.3.0 build is available (`node dist/index.js --version` = `1.3.0`) before running any command below.
- [ ] Run E2E-1 through E2E-5 in `memo_eval`, never `decisions`.
- [ ] Run CV-1 through CV-8 against the updated `SKILL.md`/`REFERENCE.md` in both `llipe/dev-tasks` and this repository's copy.
- [ ] Walk the edge-case catalog (§4) against the updated doc text.
- [ ] Run `diff -r .claude/skills/memo-cli-usage <dev-tasks>/.claude/skills/memo-cli-usage` and confirm zero output (AC6).
- [ ] Attach the E2E transcript summary and the CV table results to the PR per task 10.15/10.17.
- [ ] Hand off to `developer` for implementation; re-invoke `verifier` in Audit Mode once the PR is opened.
