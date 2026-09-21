# Fidelity Report — Story S1-06 (Lexical identifier matching, issue #62, PR #71)

**Verdict: Fidelity High | Highest drift impact: Minor**
Scope: Story S1-06, `issue/62-lexical-identifier-matching` vs `integration/prd-004-phase-1-trustworthy-retrieval`.

## Plain-language summary

This story adds a second, targeted search pass that fires only when a query looks like it names a specific file/flag/ticket (e.g. `search-filters.ts`, `#123`, `--lexical`). Results from that pass are merged with the normal search and get a modest score boost, so file/ticket-naming queries can now surface the entry that actually names them, without weakening ordinary searches. If the extra pass fails, search silently falls back to the normal results — nothing breaks. The code genuinely does what was designed; the one soft spot is in how the improvement was _reported_, not in the mechanism itself.

## AC9 scrutiny (the flagged claim)

Verified directly: the hit-rate function counts a query as a "hit" if **any** expected id lands in top-3, not all of them. `q-identifier-01` ("what does src/lib/retry.ts implement") has **two** expected ids. The developer's own manual on/off comparison shows a real case where dense-only search **does** fail part of an identifier query: with lexical off, only one of the two expected entries stays in top-3 and confidence drops to `medium`; with lexical on, both entries land in top-3 at `high` confidence. This directly contradicts the closeout's framing that "the fixture set has no case where dense search alone fails an identifier query." AC9 as literally worded (an identifier query returns an expected entry in top-3 with lexical on) **is genuinely satisfied** — the 100%-identifier-category aggregate mathematically implies every one of 8 identifier queries hit — but the closeout narrative undersells its own evidence and should be corrected, not because AC9 is unmet.

## Verified findings

- **A4 architecture**: `src/commands/search.ts` unions dense (`rawResults`) and lexical-only candidates by `Map<id>`, keeps Qdrant score for dense, computes local `cosine` only for lexical-only — additive boost, not RRF. Confirmed in diff.
- **Score composition**: `computeCompositeScore` does `Math.min(1, base + tagBoost + lexicalBoost)` — both additive terms share one clamp, as required.
- **`ensureIndexes`**: reads `getCollection().payload_schema`, diffs against `PAYLOAD_INDEXES`, creates only missing entries; called with an empty set on fresh-collection creation and the real existing set otherwise. Genuinely idempotent by inspection, matching the live-run log in the PR body (run 1 creates 2, run 2 creates 0).
- **Graceful degradation**: real failure-injection test exists (`mockQdrant.scroll.mockRejectedValue(...)`), asserts `handleSearch` resolves and returns dense-only results — not just a happy-path test. Minor gap: the test does not assert `debugLog`/MEMO_DEBUG was actually invoked, only that behavior degrades correctly.
- **Relevance floor**: `tests/fixtures/relevance/baseline.json` has zero diff against the integration branch (last touched by the S1-02 PR) — no silent rewrite.
- **Quality gate**: ran `pnpm test` locally on the branch — 526/526 pass, matching the PR's claim.

## Drift catalog

1. **Closeout/PR narrative understates own evidence for AC9** — Impact: Minor. Intent: Unintended (imprecise framing, not a functional defect). Evidence: `tests/fixtures/relevance/queries.json` q-identifier-01 vs. PR body's manual comparison vs. `computeTop3HitRate`'s any-match semantics. Non-blocking. Recommendation: `developer` should amend the closeout note to say the fixture set contains a partial-failure case masked by the any-match metric, not "no case where dense search alone fails."
2. **Degradation test doesn't assert the MEMO_DEBUG log call** — Impact: Minor. Intent: Unintended gap. Non-blocking. Recommendation: `developer`, optional follow-up, add a `debugLog` spy assertion.

No Critical or Major drift found.

## Recommendation

No blocking action required. Route finding #1 to `product-engineer`'s drift-reconciliation for a closeout-note correction; finding #2 is an optional test-hardening follow-up for `developer`.
