# Product Context — Memo

> Shared Multi-Agent Memory for Software Ecosystems · v1.0 · April 2026

---

## 1. Executive Summary

Memo is an organizational intelligence CLI for developers and development teams using AI agents. It captures, stores, and makes queryable the architectural decisions, technical rationale, and integration contracts generated during software development — at both the individual repository and the full multi-repo ecosystem scale. Its primary consumers are AI agents (GitHub Copilot, Claude, Cursor, etc.), which use it to maintain continuity and consistency across sessions, stories, and teams.

---

## 2. Problem Statement

AI agents have no memory between sessions and no visibility into the broader codebase ecosystem. Every time an agent starts a new task, it begins from scratch. In platforms with multiple repositories and interconnected products, this causes:

- **Repeated debates:** Architectural and technical decisions already resolved are relitigated in every session because the agent has no access to prior reasoning.
- **Inconsistency across stories and repos:** Without a shared knowledge base, agents make decisions that contradict earlier choices or other teams' work.
- **Integration friction:** When a developer or agent needs to integrate with another product, there is no fast path to understand how it is built or where the right integration point is.
- **Knowledge loss on rotation:** When developers change projects or teams, the rationale for past decisions is lost. Only code remains — not context.
- **No ecosystem-level intelligence:** Existing tools (ADRs, wikis, readmes) are human-written and not accessible to agents in a queryable, semantic form.

---

## 3. Target Users / Market

### Primary Users

| Persona                          | Description                                                  | Key Use Case                                                                             |
| -------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **AI agent**                     | GitHub Copilot, Claude, Cursor, or any agent with CLI access | Reads before starting tasks (`memo search`), writes after completing them (`memo write`) |
| **Solo developer with AI agent** | Individual developer using an AI coding assistant            | Persists decisions across sessions; avoids re-explaining context to the agent            |
| **Developer team (multi-repo)**  | Teams owning multiple interconnected products/services       | Cross-team ecosystem queries; integration knowledge sharing                              |

### Secondary Users

| Persona                              | Description                                           | Key Use Case                                                     |
| ------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------- |
| **Tech lead / architect**            | Senior developers reviewing architectural consistency | `memo list` for audits; `memo ask` for ecosystem-wide queries    |
| **New team member (human or agent)** | Developer onboarding to a codebase or team            | `memo ask` to understand the ecosystem without reading all code  |
| **DevOps / scan agent**              | Automated agents bootstrapping knowledge bases        | `memo scan` to generate baseline entries from existing codebases |

---

## 4. Strategic Goals

1. **Zero-friction decision capture:** Agents must be able to record a decision in one command, immediately after completing a task, with no workflow disruption.
2. **Consistency across sessions and stories:** Any agent starting a task must be able to retrieve prior decisions for that repo with a single query.
3. **Ecosystem intelligence for multi-repo teams:** Any agent or developer must be able to understand how another product in the org works and where to integrate — without leaving their workflow.
4. **Bootstrap legacy knowledge:** `memo scan` must enable teams to retroactively capture architectural knowledge from existing codebases with minimal manual effort.
5. **Near-zero operational cost:** The full system must run on free-tier infrastructure for typical team usage, with total annual cost well under $10 USD.

---

## 5. Current State

**v1.0 — MVP complete. Discovery and delete capabilities delivered.**

The MVP (Phase 1) has been fully implemented and merged. All eight original user stories (S-001 through S-008) are delivered, plus three additional capabilities from the post-MVP backlog:

| Story | Scope                                                            | Status      |
| ----- | ---------------------------------------------------------------- | ----------- |
| S-001 | Project setup (TypeScript, pnpm, CI, npm skeleton)               | ✅ Complete |
| S-002 | `memo setup` (init / show / validate)                            | ✅ Complete |
| S-003 | Foundation libraries (errors, output, qdrant, embeddings, retry) | ✅ Complete |
| S-004 | `memo write` with duplicate detection                            | ✅ Complete |
| S-005 | `memo search` with semantic + pre-filters                        | ✅ Complete |
| S-006 | `memo list` with date-range filtering                            | ✅ Complete |
| S-007 | Bootstrap documentation and validation                           | ✅ Complete |
| S-008 | First release packaging and publish workflow                     | ✅ Complete |
| #18   | `memo tags list` — browse unique tags with sort and scope options | ✅ Complete |
| #19   | `memo inspect` — discover orgs, repos, and domains in the store  | ✅ Complete |
| #20   | `memo delete` — safe single and bulk delete with guardrails      | ✅ Complete |

The package is published as `@memo-ai/cli` on npm. CI/CD pipelines are green. The publish workflow triggers on semver tag push.

---

## 6. Vision & Roadmap

### Long-Term Vision

Memo becomes the shared long-term memory layer for AI-assisted software development ecosystems — a queryable organizational brain that agents consult and contribute to automatically, making every decision discoverable and every integration self-documenting.

### MVP Proposal — Phase 1

The MVP delivers the core loop: **an agent can write a decision and retrieve it later**. To accelerate adoption in existing repositories, MVP also includes a **minimal scan bootstrap** where an AI agent infers initial architecture definitions and stores them via `memo write`.

**In scope:**

| Area                              | What ships                                                                                                                                                                          | Notes                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Project setup**                 | TypeScript + pnpm, Qdrant client, embeddings adapter, CI, npm package skeleton                                                                                                      | The foundation everything else depends on                                  |
| **`memo write`**                  | Save a decision with full payload, Zod validation, embedding generation, Qdrant upsert                                                                                              | The write path — core value                                                |
| **`memo search`**                 | Semantic vector search with `--repo` filter, `--scope company`, `--tags`, `--limit`                                                                                                 | The read path — core value                                                 |
| **`memo list`**                   | Chronological listing with `--repo`, `--from`, `--to`, `--limit`                                                                                                                    | Audit trail; useful from day one                                           |
| **`memo setup`**                  | Initialize local `memo.config.json` in a repository, define repo identity, and enable repo/org defaults for other commands                                                          | Required to make repo-aware behavior explicit in MVP                       |
| **Minimal `memo scan` bootstrap** | Agent-assisted scan prompt that infers definitions from selected files and persists them through `memo write` with `source: manual` and `entry_type: structure`/`integration_point` | Delivers scan value early without full filesystem walker/LLM orchestration |
| **Output modes**                  | Human-readable (default) + `--json` for agents                                                                                                                                      | Agents must be able to parse results                                       |
| **Config basics**                 | `.env` credential loading plus local `memo.config.json` created by `memo setup`                                                                                                     | MVP commands rely on explicit local repo/org/domain defaults               |
| **OpenAI adapter**                | `text-embedding-3-small` as the default embeddings provider                                                                                                                         | Ship one provider; others come later                                       |
| **Error handling**                | Typed `MemoError` hierarchy, deterministic exit codes (0/1/2)                                                                                                                       | Agent-friendly failure signals                                             |
| **Tests**                         | Unit tests for `lib/` + integration tests for `write`, `search`, `list` commands                                                                                                    | Quality gate from the start                                                |

**Explicitly NOT in MVP:**

| Deferred                                                | Reason                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Full `memo scan` automation                             | Full filesystem walker, artifact prioritization, autonomous chunking, confidence scoring, and bulk upserts remain Phase 3 |
| `memo ask`                                              | Depends on `memo.config.json` relationships and combined entry logic — Phase 4                                            |
| Central org config registry                             | HTTP-distributed shared config remains Phase 2; MVP starts with local `memo.config.json` only                             |
| Additional embedding providers (Voyage, Cohere, Ollama) | OpenAI is sufficient for MVP; adapter interface ships, implementations follow                                             |
| Telemetry                                               | Nice-to-have; defer to Phase 2+                                                                                           |
| Long-rationale summarization                            | Optimization; full text embedding works acceptably at MVP scale                                                           |

**MVP success criteria:**

1. An agent can run `memo write --repo my-app --tags auth,jwt --rationale "..."` and get exit code 0.
2. An agent can run `memo search "authentication strategy" --repo my-app` and get relevant results with rationale text.
3. A developer can run `memo list --repo my-app --limit 10` and see recent decisions in chronological order.
4. All three commands work with `--json` flag producing parseable output.
5. A developer can run `memo setup init` inside a repo and create a valid local `memo.config.json` used as the default repo/org context by other commands.
6. A Copilot-driven minimal scan can produce at least 5 valid baseline entries (`source: manual`, `entry_type: structure|integration_point`) for a target repo.
7. CI pipeline is green (lint + type-check + tests + build).
8. Package is installable via `npm install -g @memo-ai/cli` and the `memo` binary runs.

**Initial MVP test proposal for minimal scan:**

1. Pick a small reference repository/module (20-50 files).
2. Ask Copilot to analyze a bounded set of artifacts (`README`, routes/controllers, schema/migrations, package.json) using a fixed extraction prompt.
3. Require Copilot output in a strict JSON schema per inferred definition:
   - `entry_type`, `tags`, `files_modified`, `rationale`, `relates_to`
4. Convert each JSON item into `memo write` commands and execute them with `--json`.
5. Run `memo search` queries that validate retrieval quality (for example: auth flow, event publishing, API contracts).
6. Pass criteria:
   - At least 5 entries written successfully
   - 0 invalid payload writes
   - Top-3 results judged relevant in at least 4 of 5 validation queries
   - End-to-end run time under 15 minutes for the pilot sample

This validates the minimal scan concept before building full `memo scan` automation.

**Estimated scope:** ~8–12 user stories, targeting Phases 1 of the roadmap.

### Full Roadmap Phases

| Phase                      | Scope                                                                                                                                                        | Target    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 1 — Core (MVP)             | `memo setup`, local `memo.config.json`, `memo write`, `memo search`, `memo list`, minimal agent-assisted scan bootstrap, Qdrant + embeddings, OpenAI adapter | Weeks 1–2 |
| 2 — Config & Relationships | Central config distribution, multi-repo resolution, additional providers                                                                                     | Week 3    |
| 3 — Scan                   | `memo scan` — codebase archaeology + LLM analysis                                                                                                            | Week 4    |
| 4 — Ask & Ecosystem        | `memo ask` — cross-repo integration queries                                                                                                                  | Week 5    |
| 5 — Adoption               | Initial org scans, team rollout, agent system prompt finalization, telemetry                                                                                 | Week 6    |

---

## 7. Success Metrics

| Metric                        | Target                                                                  |
| ----------------------------- | ----------------------------------------------------------------------- |
| Agent write compliance        | ≥ 95% of completed stories have a `memo write` entry                    |
| Pre-task search adoption      | Agents query before starting non-trivial tasks                          |
| Cross-repo query usage        | Teams use `memo ask` for at least 50% of cross-product integration work |
| Cost per 10K entries (year 1) | < $5 USD total                                                          |
| CLI startup time              | < 200ms                                                                 |
| Search relevance              | Agent rates top-3 results as useful in > 80% of queries                 |

---

## 8. Competitive Landscape

| Tool                   | What It Solves                                | Gap Memo Covers                                                |
| ---------------------- | --------------------------------------------- | -------------------------------------------------------------- |
| **Memorix**            | Session continuity per agent, per machine     | No cross-repo or cross-team visibility                         |
| **Mem0**               | Conversational memory with LLM compression    | No structured schema, no repo relationships, lossy compression |
| **Beads**              | Task planning and execution with dependencies | Does not capture rationale or architectural knowledge          |
| **ADR tools**          | Markdown decision documents in the repo       | No semantic search, no cross-repo agent access                 |
| **Wikis / Confluence** | Human-authored knowledge bases                | Not agent-queryable, not linked to commits or stories          |

**Memo's differentiating features:** `memo scan` (codebase archaeology), `memo ask` (ecosystem-wide integration queries), compound semantic + exact filtering, full rationale fidelity (no LLM compression), and sub-$5/year operational cost.

---

## 9. Key Constraints

| Constraint                        | Detail                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| **Cost**                          | Must operate on Qdrant free tier + minimal embedding cost; no paid infrastructure required |
| **Runtime dependency**            | Requires Node.js 24 LTS on the user's machine                                              |
| **Qdrant free tier**              | ~1 GB storage ≈ 100K entries; sufficient for most teams                                    |
| **LLM dependency for scan**       | `memo scan` requires a configurable LLM API (GPT-4o-mini recommended); ~$0.10/repo         |
| **No internet required for core** | Local Qdrant + Ollama setup must be fully functional offline                               |
| **Agent compatibility**           | CLI output must be parseable by agents; structured JSON output required via `--json`       |

---

## 10. Key Stakeholders

| Role                                     | Interest                                                        |
| ---------------------------------------- | --------------------------------------------------------------- |
| **Solo developer / adopter**             | Fast onboarding, low friction, immediate value on first session |
| **Engineering lead / tech lead**         | Architectural consistency, audit trail, team adoption           |
| **AI agent (Copilot / Claude / Cursor)** | Reliable CLI interface, fast response, structured output        |
| **Open source community** (future)       | Extensibility, documentation quality, provider support          |

---

## 11. Assumptions

- Users have a Qdrant instance available (cloud free tier or local Docker).
- Users have an API key for at least one supported embeddings provider (OpenAI recommended).
- AI agents have the ability to execute CLI commands and parse stdout.
- Teams have adopted or are adopting an AI coding assistant as part of their workflow.
- Decision rationale written by the agent is sufficiently precise for future semantic retrieval.
- The `decisions` collection schema will remain stable within v1.x.
- In v1, there is no user identity model inside Memo; any repository using the shared config can read/write across any configured repo.
- A central org config endpoint will be available over HTTP at deployment time.

---

## 12. Decisions and Remaining Open Questions

### Confirmed Decisions

- **Multi-tenancy / access model (v1):** Memo has no concept of end users or team-level ACLs. Configuration is repository-scoped, and repositories using Memo can read/write entries for any configured repo in the shared cluster.
- **Web UI roadmap:** A read-only browser interface for `memo list` / `memo search` is on the roadmap. In MVP, all write/modify operations remain CLI-only.
- **Schema versioning direction:** v2 migration strategy is not defined yet. Schema evolution must stay flexible and backward-compatible by default.
- **Org-level central config:** Central `memo.config.json` is expected to be HTTP-accessible; final hosting details are decided at deployment.

### Proposed Implementation Path: Agent Auto-Write (Post-MVP)

1. **Git hook mode (local):** add an optional `post-commit` hook that calls a helper (`memo hooks post-commit`) to gather commit hash + changed files, request a rationale from the active agent prompt, and execute `memo write`.
2. **CI mode (fallback):** add a GitHub Actions job that runs on merged PRs, builds a rationale from PR title/body + changed files, and writes a low-confidence entry with `source=manual` or `source=scan` and a `generated_by=ci` tag.
3. **Idempotency:** compute a deterministic dedupe key (`repo + commit + story`) to prevent duplicate writes across hook and CI flows.
4. **Safety controls:** include `--dry-run`, `--confirm`, and `--json` modes, with telemetry events for hook success/failure.

### Remaining Open Questions

- What minimum metadata should auto-write require when story/task IDs are unavailable?
- Should CI-generated entries be editable in place by a follow-up agent write, or appended as a new revision?
