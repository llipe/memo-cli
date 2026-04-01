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

| Persona | Description | Key Use Case |
|---------|-------------|--------------|
| **AI agent** | GitHub Copilot, Claude, Cursor, or any agent with CLI access | Reads before starting tasks (`memo search`), writes after completing them (`memo write`) |
| **Solo developer with AI agent** | Individual developer using an AI coding assistant | Persists decisions across sessions; avoids re-explaining context to the agent |
| **Developer team (multi-repo)** | Teams owning multiple interconnected products/services | Cross-team ecosystem queries; integration knowledge sharing |

### Secondary Users

| Persona | Description | Key Use Case |
|---------|-------------|--------------|
| **Tech lead / architect** | Senior developers reviewing architectural consistency | `memo list` for audits; `memo ask` for ecosystem-wide queries |
| **New team member (human or agent)** | Developer onboarding to a codebase or team | `memo ask` to understand the ecosystem without reading all code |
| **DevOps / scan agent** | Automated agents bootstrapping knowledge bases | `memo scan` to generate baseline entries from existing codebases |

---

## 4. Strategic Goals

1. **Zero-friction decision capture:** Agents must be able to record a decision in one command, immediately after completing a task, with no workflow disruption.
2. **Consistency across sessions and stories:** Any agent starting a task must be able to retrieve prior decisions for that repo with a single query.
3. **Ecosystem intelligence for multi-repo teams:** Any agent or developer must be able to understand how another product in the org works and where to integrate — without leaving their workflow.
4. **Bootstrap legacy knowledge:** `memo scan` must enable teams to retroactively capture architectural knowledge from existing codebases with minimal manual effort.
5. **Near-zero operational cost:** The full system must run on free-tier infrastructure for typical team usage, with total annual cost well under $10 USD.

---

## 5. Current State

**Greenfield — v1.0 in active development.**

No prior codebase exists. The repository (`memo-cli`) is being initialized. The functional specification (`def-funcional-original.md`) defines the full intended feature set. Implementation follows a 5-phase roadmap (see Section 6).

---

## 6. Vision & Roadmap

### Long-Term Vision

Memo becomes the shared long-term memory layer for AI-assisted software development ecosystems — a queryable organizational brain that agents consult and contribute to automatically, making every decision discoverable and every integration self-documenting.

### MVP Proposal — Phase 1

The MVP delivers the core loop: **an agent can write a decision and retrieve it later**. This alone eliminates the #1 problem — agents starting from scratch every session — and proves the architecture end-to-end before investing in multi-repo, scan, or ecosystem features.

**In scope:**

| Area | What ships | Notes |
|------|-----------|-------|
| **Project setup** | TypeScript + pnpm, Qdrant client, embeddings adapter, CI, npm package skeleton | The foundation everything else depends on |
| **`memo write`** | Save a decision with full payload, Zod validation, embedding generation, Qdrant upsert | The write path — core value |
| **`memo search`** | Semantic vector search with `--repo` filter, `--scope company`, `--tags`, `--limit` | The read path — core value |
| **`memo list`** | Chronological listing with `--repo`, `--from`, `--to`, `--limit` | Audit trail; useful from day one |
| **Output modes** | Human-readable (default) + `--json` for agents | Agents must be able to parse results |
| **Config basics** | `.env` credential loading, `QDRANT_URL`, `QDRANT_API_KEY`, `EMBEDDINGS_API_KEY` | Minimum config to connect |
| **OpenAI adapter** | `text-embedding-3-small` as the default embeddings provider | Ship one provider; others come later |
| **Error handling** | Typed `MemoError` hierarchy, deterministic exit codes (0/1/2) | Agent-friendly failure signals |
| **Tests** | Unit tests for `lib/` + integration tests for `write`, `search`, `list` commands | Quality gate from the start |

**Explicitly NOT in MVP:**

| Deferred | Reason |
|----------|--------|
| `memo scan` | Requires LLM adapter, filesystem walker, complex prompts — Phase 3 |
| `memo ask` | Depends on `memo.config.json` relationships and combined entry logic — Phase 4 |
| `memo setup` | Config management is Phase 2; MVP uses manual `.env` + simple config |
| `memo.config.json` registry | Multi-repo relationships are Phase 2 |
| Additional embedding providers (Voyage, Cohere, Ollama) | OpenAI is sufficient for MVP; adapter interface ships, implementations follow |
| Telemetry | Nice-to-have; defer to Phase 2+ |
| Long-rationale summarization | Optimization; full text embedding works acceptably at MVP scale |

**MVP success criteria:**

1. An agent can run `memo write --repo my-app --tags auth,jwt --rationale "..."` and get exit code 0.
2. An agent can run `memo search "authentication strategy" --repo my-app` and get relevant results with rationale text.
3. A developer can run `memo list --repo my-app --limit 10` and see recent decisions in chronological order.
4. All three commands work with `--json` flag producing parseable output.
5. CI pipeline is green (lint + type-check + tests + build).
6. Package is installable via `npm install -g @memo-ai/cli` and the `memo` binary runs.

**Estimated scope:** ~8–12 user stories, targeting Phases 1 of the roadmap.

### Full Roadmap Phases

| Phase | Scope | Target |
|-------|-------|--------|
| 1 — Core (MVP) | `memo write`, `memo search`, `memo list`, Qdrant + embeddings, OpenAI adapter | Weeks 1–2 |
| 2 — Config & Relationships | `memo.config.json`, `memo setup`, multi-repo resolution, additional providers | Week 3 |
| 3 — Scan | `memo scan` — codebase archaeology + LLM analysis | Week 4 |
| 4 — Ask & Ecosystem | `memo ask` — cross-repo integration queries | Week 5 |
| 5 — Adoption | Initial org scans, team rollout, agent system prompt finalization, telemetry | Week 6 |

---

## 7. Success Metrics

| Metric | Target |
|--------|--------|
| Agent write compliance | ≥ 95% of completed stories have a `memo write` entry |
| Pre-task search adoption | Agents query before starting non-trivial tasks |
| Cross-repo query usage | Teams use `memo ask` for at least 50% of cross-product integration work |
| Cost per 10K entries (year 1) | < $5 USD total |
| CLI startup time | < 200ms |
| Search relevance | Agent rates top-3 results as useful in > 80% of queries |

---

## 8. Competitive Landscape

| Tool | What It Solves | Gap Memo Covers |
|------|---------------|-----------------|
| **Memorix** | Session continuity per agent, per machine | No cross-repo or cross-team visibility |
| **Mem0** | Conversational memory with LLM compression | No structured schema, no repo relationships, lossy compression |
| **Beads** | Task planning and execution with dependencies | Does not capture rationale or architectural knowledge |
| **ADR tools** | Markdown decision documents in the repo | No semantic search, no cross-repo agent access |
| **Wikis / Confluence** | Human-authored knowledge bases | Not agent-queryable, not linked to commits or stories |

**Memo's differentiating features:** `memo scan` (codebase archaeology), `memo ask` (ecosystem-wide integration queries), compound semantic + exact filtering, full rationale fidelity (no LLM compression), and sub-$5/year operational cost.

---

## 9. Key Constraints

| Constraint | Detail |
|------------|--------|
| **Cost** | Must operate on Qdrant free tier + minimal embedding cost; no paid infrastructure required |
| **Runtime dependency** | Requires Node.js 24 LTS on the user's machine |
| **Qdrant free tier** | ~1 GB storage ≈ 100K entries; sufficient for most teams |
| **LLM dependency for scan** | `memo scan` requires a configurable LLM API (GPT-4o-mini recommended); ~$0.10/repo |
| **No internet required for core** | Local Qdrant + Ollama setup must be fully functional offline |
| **Agent compatibility** | CLI output must be parseable by agents; structured JSON output required via `--json` |

---

## 10. Key Stakeholders

| Role | Interest |
|------|----------|
| **Solo developer / adopter** | Fast onboarding, low friction, immediate value on first session |
| **Engineering lead / tech lead** | Architectural consistency, audit trail, team adoption |
| **AI agent (Copilot / Claude / Cursor)** | Reliable CLI interface, fast response, structured output |
| **Open source community** (future) | Extensibility, documentation quality, provider support |

---

## 11. Assumptions

- Users have a Qdrant instance available (cloud free tier or local Docker).
- Users have an API key for at least one supported embeddings provider (OpenAI recommended).
- AI agents have the ability to execute CLI commands and parse stdout.
- Teams have adopted or are adopting an AI coding assistant as part of their workflow.
- Decision rationale written by the agent is sufficiently precise for future semantic retrieval.
- The `decisions` collection schema will remain stable within v1.x.

---

## 12. Open Questions

- **Multi-tenancy:** How will shared Qdrant instances handle access control if multiple teams share one cluster?
- **Web UI:** Is a read-only browser interface for `memo list` / `memo search` on the roadmap?
- **Schema versioning:** What is the migration strategy if the entry payload schema changes in v2?
- **Agent auto-write:** Should later versions support automatic `memo write` hooks via git commit hooks or CI triggers?
- **Org-level central config:** Where is the "central" `memo.config.json` hosted and accessed from in multi-repo setups?
