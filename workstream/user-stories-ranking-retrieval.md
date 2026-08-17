# User Stories — Ranking & Retrieval Improvement

## GitHub Issues

| Story   | Issue                                              | Title                                            |
| ------- | -------------------------------------------------- | ------------------------------------------------ |
| Story 1 | [#34](https://github.com/llipe/memo-cli/issues/34) | feat: composite ranking score for search results |
| Story 2 | [#35](https://github.com/llipe/memo-cli/issues/35) | feat: dynamic confidence tiers in search output  |
| Story 3 | [#36](https://github.com/llipe/memo-cli/issues/36) | feat: tag overlap boosting in search results     |
| Story 4 | [#38](https://github.com/llipe/memo-cli/issues/38) | feat: staleness detection flag on search results |
| Story 5 | [#37](https://github.com/llipe/memo-cli/issues/37) | feat: memo ask command with LLM re-ranking       |

## Dependency Map

```
Story 1 — Composite Ranking Score (#34)
    └── Story 2 — Confidence Tiers (#35)
    └── Story 4 — Staleness Detection (#38)
    └── Story 5 — ask command (#37)
              └── Story 2 — Confidence Tiers (#35) [also required]

Story 3 — Tag Overlap Boosting (#36)   ← independent
```

## Recommended Implementation Order

| #   | Story                   | Issue | Depends On | Complexity |
| --- | ----------------------- | ----- | ---------- | ---------- |
| 1   | Composite Ranking Score | #34   | —          | Medium     |
| 2   | Tag Overlap Boosting    | #36   | —          | Low        |
| 3   | Confidence Tiers        | #35   | #34        | Low        |
| 4   | Staleness Detection     | #38   | #34        | Medium     |
| 5   | `ask` Command           | #37   | #34, #35   | High       |

Stories 1 (#34) and 3 (#36) can be worked in parallel. Stories 2 (#35) and 4 (#38) unlock after Story 1 ships.

---

## Story 1 — Composite Ranking Score (#34)

As an AI agent consuming `memo search`, I want results ordered by a composite score that weights semantic similarity, entry recency, and source reliability — so that the most actionable and trustworthy decisions surface at the top, not just the most semantically similar ones.

### Files to Create/Modify

- `src/types/config.ts` — Add `RankingConfig` Zod schema; extend `MemoConfig`
- `src/lib/ranking.ts` — **New** — `computeRecencyScore`, `computeSourceScore`, `computeCompositeScore`, `rankResults`
- `src/lib/qdrant.ts` — Over-fetch `limit * 3` candidates (capped at 50)
- `src/lib/config.ts` — Load and validate `ranking` block; apply defaults
- `src/commands/search.ts` — Apply `rankResults` after fetch; slice to `--limit`
- `src/commands/setup.ts` — Extend `validate` to check weights sum
- `tests/unit/lib/ranking.test.ts` — **New** — unit tests

---

## Story 2 — Dynamic Confidence Tiers (#35)

As an AI agent consuming `memo search`, I want each result to include a semantic confidence tier (`exact`, `high`, `medium`, `low`) derived from `final_score` — so I can programmatically decide whether to act on a result, surface it for review, or discard it.

### Files to Create/Modify

- `src/types/config.ts` — Add `confidence_thresholds` to `RankingConfig`
- `src/lib/ranking.ts` — Add `computeConfidenceTier`
- `src/commands/search.ts` — Attach `confidence_tier` to each result
- `src/lib/output.ts` — Display tier label in human output

---

## Story 3 — Tag Overlap Boosting (#36)

As an AI agent consuming `memo search`, I want results whose tags overlap with terms present in my query to receive a score boost — so that entries tagged with directly relevant concepts rank higher than semantically similar but differently-categorized ones.

### Files to Create/Modify

- `src/lib/ranking.ts` — Add `computeTagBoost`; apply in `rankResults`
- `src/types/config.ts` — Add `tag_boost_factor` to `RankingConfig`
- `src/commands/search.ts` — Pass raw query string into `rankResults`

---

## Story 4 — Staleness Detection (#38)

As an AI agent consuming `memo search`, I want each result to include a `stale` flag when the entry is old and a newer entry with overlapping tags exists in the same repo — so I don't act on superseded decisions without awareness.

### Files to Create/Modify

- `src/lib/staleness.ts` — **New** — `computeJaccardOverlap`, `detectStaleness`
- `src/lib/qdrant.ts` — Add `fetchByRepo(repo)` via Qdrant scroll
- `src/commands/search.ts` — Run staleness detection after ranking
- `src/types/config.ts` — Add staleness fields to `RankingConfig`
- `tests/unit/lib/staleness.test.ts` — **New** — unit tests

---

## Story 5 — `memo ask` Command (#37)

As an AI agent or developer, I want to run `memo ask "<question>"` and receive a direct, cited answer synthesized from the knowledge base — so I can get advisory responses grounded in stored decisions without manually interpreting raw search results.

### Files to Create/Modify

- `src/commands/ask.ts` — **New** — full command implementation
- `src/lib/llm.ts` — **New** — LLM client adapter
- `src/adapters/openai-llm.ts` — **New** — OpenAI chat completion adapter
- `src/index.ts` — Register `ask` command
- `src/types/config.ts` — Add `AskConfig` Zod schema
- `tests/unit/commands/ask.test.ts` — **New** — unit tests
- `tests/unit/lib/llm.test.ts` — **New** — unit tests
