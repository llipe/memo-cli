# Traceability Matrix — Issue #87 (Story S2-08: `memo bank init|list|show` and `inspect` banks facet)

|                     |                                                                      |
| ------------------- | -------------------------------------------------------------------- |
| Mode                | Design                                                               |
| Repository          | `llipe/memo-cli`                                                     |
| GitHub Issue        | [#87](https://github.com/llipe/memo-cli/issues/87)                   |
| Companion test plan | `/workstream/test-plan-issue-87.md`                                  |
| Coverage status     | Complete — AC1–AC6 each map to ≥1 positive and ≥1 negative/edge test |

## Document Changelog

| Date       | Change                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------- |
| 2026-09-21 | Initial traceability matrix authored alongside the test plan (Design Mode, pre-implementation). |

---

## AC-ID → Test-Case-ID → Observed-Result → Pass/Fail/Drift

At Design Mode authoring time, no implementation exists yet (`src/commands/bank.ts` is not present in the codebase), so the "Observed Result" and "Pass/Fail/Drift" columns are marked `Pending implementation` for every row. This matrix is the coverage contract to be populated by `developer` during/after implementation and re-checked by `verifier` Audit Mode.

### AC1 — `bank init` creates a bank (validate id, write first `self` entry, JSON envelope)

| Test Case ID | Type                    | Description                                                               | Observed Result        | Pass/Fail/Drift |
| ------------ | ----------------------- | ------------------------------------------------------------------------- | ---------------------- | --------------- |
| E2E-01       | Positive (E2E)          | Fresh init, human output, one `self` write with default rationale/tags    | Pending implementation | Pending         |
| E2E-02       | Positive (Contract/E2E) | Fresh init, JSON envelope `{ bank, created: true, self_id, default_set }` | Pending implementation | Pending         |
| E2E-03       | Positive (Edge)         | UUID-form id accepted                                                     | Pending implementation | Pending         |
| E2E-04       | Positive (E2E)          | `--rationale`/`--tags` overrides honored                                  | Pending implementation | Pending         |
| E2E-05       | Negative                | `--id kb` rejected with `VALIDATION_FAILED`, zero writes                  | Pending implementation | Pending         |
| E2E-06       | Negative                | Malformed id rejected with `VALIDATION_FAILED`                            | Pending implementation | Pending         |
| CT-01        | Contract                | JSON schema/type stability for the `created: true` envelope               | Pending implementation | Pending         |
| EC-01        | Negative/Edge           | `--id` omitted                                                            | Pending implementation | Pending         |
| EC-02        | Negative/Edge           | Reserved word `kb`                                                        | Pending implementation | Pending         |
| EC-03        | Negative/Edge           | Case variant `KB`                                                         | Pending implementation | Pending         |
| EC-04        | Negative/Edge           | Whitespace-padded id                                                      | Pending implementation | Pending         |
| EC-05        | Negative/Edge           | `--tags` with 1 tag (schema violation)                                    | Pending implementation | Pending         |
| EC-06        | Negative/Edge           | `--tags` with 6 tags (schema violation)                                   | Pending implementation | Pending         |
| RT-01        | Randomized              | Valid kebab fuzz corpus accepted                                          | Pending implementation | Pending         |
| RT-02        | Randomized              | Valid UUID v4 fuzz corpus accepted                                        | Pending implementation | Pending         |
| RT-03        | Randomized              | Invalid-string fuzz corpus rejected                                       | Pending implementation | Pending         |
| RT-04        | Randomized (fixed set)  | Reserved-word near-misses                                                 | Pending implementation | Pending         |

### AC2 — Second `init` on the same id is a no-op (`created: false`)

| Test Case ID | Type                                | Description                                                        | Observed Result                                                                                                                                    | Pass/Fail/Drift |
| ------------ | ----------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| E2E-07       | Positive (Idempotency)              | Second `init`, human output, zero additional writes                | Pending implementation                                                                                                                             | Pending         |
| E2E-08       | Positive (Idempotency/Contract)     | Second `init`, JSON `created: false` with existing `self_id`       | Pending implementation                                                                                                                             | Pending         |
| CT-02        | Contract                            | JSON schema stability for the `created: false` envelope            | Pending implementation                                                                                                                             | Pending         |
| EC-07        | Positive/Edge                       | Immediate-succession double `init`, identical `self_id`            | Pending implementation                                                                                                                             | Pending         |
| EC-08        | Edge (needs developer confirmation) | Double `init --set-default` — config-write behavior on second call | Pending implementation — **flagged**: resolve whether `writeConfig` fires again on the idempotent path before marking this row's expectation final | Pending         |

### AC3 — `--set-default` gates `writeConfig`; absence means it is never called

| Test Case ID | Type                  | Description                                                                                 | Observed Result        | Pass/Fail/Drift |
| ------------ | --------------------- | ------------------------------------------------------------------------------------------- | ---------------------- | --------------- |
| E2E-09       | Positive              | `--set-default` → `writeConfig` called once with `bank.default = <id>`, `default_set: true` | Pending implementation | Pending         |
| E2E-10       | Negative (Invariant)  | No `--set-default` → `writeConfig` call count asserted `=== 0`                              | Pending implementation | Pending         |
| CT-03        | Contract              | 4-way matrix of `created` × `--set-default` → `default_set` boolean correctness             | Pending implementation | Pending         |
| CT-09        | Contract              | Shared `MemoError` envelope for `VALIDATION_FAILED`/`CONFIG_NOT_FOUND`                      | Pending implementation | Pending         |
| EC-09        | Negative/Failure mode | `--set-default` with no `memo.config.json` → `CONFIG_NOT_FOUND`, zero Qdrant writes         | Pending implementation | Pending         |
| EC-10        | Negative/Failure mode | `--set-default` with invalid config → `CONFIG_INVALID`, zero Qdrant writes                  | Pending implementation | Pending         |
| EC-18        | Negative (BR2)        | No ownership/permission check exists for any bank id                                        | Pending implementation | Pending         |

### AC4 — `bank list` shows every bank with per-kind counts + total; v1 points fold into `kb`

| Test Case ID | Type                       | Description                                                            | Observed Result        | Pass/Fail/Drift |
| ------------ | -------------------------- | ---------------------------------------------------------------------- | ---------------------- | --------------- |
| E2E-11       | Positive/Edge              | Empty collection → `{ banks: [] }`                                     | Pending implementation | Pending         |
| E2E-12       | Positive                   | Multiple banks + v1 legacy fold into `kb`                              | Pending implementation | Pending         |
| E2E-13       | Positive                   | Human-readable table output                                            | Pending implementation | Pending         |
| CT-04        | Contract                   | JSON schema + `total === sum(counts)` invariant                        | Pending implementation | Pending         |
| CT-05        | Contract/Edge              | Empty-array (not null/omitted) contract                                | Pending implementation | Pending         |
| EC-11        | Edge (State transition)    | Mixed `bank` present / absent / explicit `'kb'` fold into one `kb` row | Pending implementation | Pending         |
| EC-12        | Edge (Data boundary)       | Single-kind bank still reports all three kind keys with `0`            | Pending implementation | Pending         |
| EC-16        | Edge (Resource exhaustion) | Behavior at `FACET_SCROLL_LIMIT` (10,000) boundary                     | Pending implementation | Pending         |

### AC5 — `bank show` prints non-superseded `self` entries + counts + `last_session_id`; unknown bank is zero-count, exit 0

| Test Case ID | Type                                               | Description                                                                   | Observed Result                                                                                                                             | Pass/Fail/Drift |
| ------------ | -------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| E2E-14       | Positive                                           | Populated bank, newest-first ordering, counts, `last_session_id`              | Pending implementation                                                                                                                      | Pending         |
| E2E-15       | Positive/Contract                                  | JSON shape for populated bank                                                 | Pending implementation                                                                                                                      | Pending         |
| E2E-16       | Negative/Edge                                      | Unknown bank → exit 0, zero counts, notice                                    | Pending implementation                                                                                                                      | Pending         |
| CT-06        | Contract                                           | JSON schema for populated bank, strict ordering assertion                     | Pending implementation                                                                                                                      | Pending         |
| CT-07        | Contract/Edge                                      | JSON schema stability under the zero-count/not-found branch                   | Pending implementation                                                                                                                      | Pending         |
| EC-13        | Edge (Data boundary)                               | Archived-only bank — archived entries still print, only `superseded` excluded | Pending implementation                                                                                                                      | Pending         |
| EC-14        | Edge (Data boundary, needs developer confirmation) | All-superseded bank — count vs. printed-list distinction                      | Pending implementation — **flagged**: confirm `counts.kind.self` reflects raw count, not the superseded-filtered list, before marking final | Pending         |
| EC-15        | Edge (Validator scope asymmetry)                   | `show --id kb` is not rejected the way `init --id kb` is                      | Pending implementation                                                                                                                      | Pending         |

### AC6 — `inspect` adds a `banks` facet without changing existing facets

| Test Case ID | Type                                                                  | Description                                                                            | Observed Result                                                                                                                                                             | Pass/Fail/Drift |
| ------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| E2E-17       | Positive                                                              | `inspect --json` includes `banks` alongside unchanged `orgs`/`repos`/`domains`         | Pending implementation                                                                                                                                                      | Pending         |
| E2E-18       | Negative/Regression                                                   | Narrowing flag (`--orgs`) leaves prior behavior untouched                              | Pending implementation                                                                                                                                                      | Pending         |
| CT-08        | Contract                                                              | `banks` follows the existing `FacetEntry` shape; other keys' schemas unchanged         | Pending implementation                                                                                                                                                      | Pending         |
| EC-17        | Edge (Design ambiguity — needs developer/product-engineer resolution) | Narrowing-flag interaction with the new `banks` facet is unspecified by the story text | Pending implementation — **flagged, not blocking**: implementation must pick one of the two interpretations in the test plan §5 EC-17 and this row will be updated to match | Pending         |

---

## Cross-Cutting / Non-AC Coverage

| Item                                                               | Test Case ID(s)                                                                          | Rationale                                                                                                                |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| BR1 — bank created only by writing first `self` entry, no registry | Implicitly covered by AC1's tests (no separate "create bank record" step exists to test) | Design constraint validated by absence of a registry-write assertion                                                     |
| BR2 — bank ids are labels, not identities; no ownership check      | EC-18                                                                                    | Explicit negative test                                                                                                   |
| Migration opt-out                                                  | §7 of the test plan (documentation, not a test case)                                     | Story explicitly opts out of migration-apply testing; substituted with the `writeConfig` invariant (E2E-09/E2E-10/CT-03) |

## Open Items Requiring Developer/Product-Engineer Input Before Final Sign-Off

1. **EC-08** — Does a second `init --set-default` call `writeConfig` again, or is it a no-op once the bank already exists? The story/spec text does not disambiguate this from the `created: false` no-write path.
2. **EC-14** — Does `counts.kind.self` in `bank show` count all `self` points regardless of `superseded` state, or only the non-superseded ones that are also printed? Spec §18.10 says "counts per kind and per state," implying state is a separate breakdown from kind, but this should be confirmed against the implementation.
3. **EC-17** — Does the new `banks` facet respect the existing `--orgs`/`--repos`/`--domains` narrowing flags (excluded when a narrowing flag is set), or is a dedicated `--banks` flag introduced? Story AC6 only guarantees existing facets are "unchanged," not how `banks` interacts with the narrowing mechanism.

These three items are flagged as **Undetermined** design questions rather than defects; they do not block test-plan completion but **MUST** be resolved during implementation and the resulting rows above updated by `developer`/`verifier` before the fidelity audit is considered final.
