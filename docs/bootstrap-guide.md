# Bootstrap Guide: Prompt + Validation Workflow

Use this guide to generate high-signal bootstrap memory entries from existing repository artifacts and validate them before writing to Memo.

## When to Use This

Use the bootstrap flow when a repository has little or no memory entries yet, and you want a reliable starting set of `structure` and `integration_point` records.

## Artifact Selection Guide

Prioritize artifacts that reveal architecture and coupling. Start small and focused.

1. Core orientation files:

- `README.md`
- `docs/product-context.md`
- `docs/technical-guidelines.md`

2. Architecture and requirement files:

- `docs/requirements/*.md`
- `workstream/specification-*.md`
- `workstream/user-stories-*.md`

3. Configuration and runtime boundaries:

- `package.json`
- `tsconfig.json`
- `eslint.config.ts`
- `jest.config.ts`

4. Key modules and adapters:

- `src/index.ts`
- `src/commands/*.ts`
- `src/lib/*.ts`
- `src/adapters/*.ts`

Selection rules:

- Prefer files that define contracts, boundaries, or integration behavior.
- Skip generated files and lockfiles.
- Choose 8-20 artifacts per prompt batch.
- Keep each batch scoped to one domain (CLI flow, storage, config, etc.).

## Prompt Template

Use this prompt with your AI assistant after pasting artifact excerpts.

```text
You are generating bootstrap memory entries for memo-cli.

Goal:
- Produce JSON array entries that can be written via memo CLI using source=manual.
- Focus on high-value architectural facts only.

Output rules:
- Return JSON array only. No markdown. No prose outside JSON.
- Each object MUST include exactly these fields:
  - entry_type
  - tags
  - files_modified
  - rationale
  - relates_to (optional)
- Allowed entry_type values: decision, integration_point, structure.
- tags must be kebab-case strings, with 2 to 5 tags.
- files_modified must be a non-empty array of repository-relative paths.
- rationale must be 1..5000 chars and describe a concrete, useful fact.
- relates_to is optional; include only when explicit cross-repo dependency evidence exists.
- Do NOT output confidence, source, title, score, or any extra fields.

Quality rules:
- Prefer specific, evidence-backed statements over generic summaries.
- Avoid duplicate rationales.
- Keep each rationale to one actionable architectural fact.

Artifacts:
{{PASTE_ARTIFACT_SNIPPETS_HERE}}
```

## Worked Conversion Examples

Each example shows generated JSON and the corresponding `memo write` command.

### Example 1: Structure Entry

JSON object:

```json
{
  "entry_type": "structure",
  "tags": ["cli", "commander", "entrypoint"],
  "files_modified": ["src/index.ts", "src/commands/write.ts"],
  "rationale": "The CLI root in src/index.ts registers command modules under src/commands, establishing a command-per-file structure.",
  "relates_to": ["memo-cli-docs"]
}
```

Write command:

```bash
memo write --source manual --json '{
  "entry_type":"structure",
  "tags":["cli","commander","entrypoint"],
  "files_modified":["src/index.ts","src/commands/write.ts"],
  "rationale":"The CLI root in src/index.ts registers command modules under src/commands, establishing a command-per-file structure.",
  "relates_to":["memo-cli-docs"]
}'
```

### Example 2: Integration Point Entry

JSON object:

```json
{
  "entry_type": "integration_point",
  "tags": ["qdrant", "storage", "repository"],
  "files_modified": ["src/lib/qdrant.ts", "src/lib/search-filters.ts"],
  "rationale": "QdrantRepository encapsulates ensureCollection, upsert, search, and scroll, making Qdrant the primary memory persistence integration boundary."
}
```

Write command:

```bash
memo write --source manual --json '{
  "entry_type":"integration_point",
  "tags":["qdrant","storage","repository"],
  "files_modified":["src/lib/qdrant.ts","src/lib/search-filters.ts"],
  "rationale":"QdrantRepository encapsulates ensureCollection, upsert, search, and scroll, making Qdrant the primary memory persistence integration boundary."
}'
```

### Example 3: Decision Entry

JSON object:

```json
{
  "entry_type": "decision",
  "tags": ["embeddings", "openai", "adapter"],
  "files_modified": ["src/adapters/openai-embeddings.ts", "src/lib/embeddings.ts"],
  "rationale": "The project standardizes on text-embedding-3-small through OpenAIEmbeddingsAdapter behind a provider factory to keep embedding provider selection replaceable."
}
```

Write command:

```bash
memo write --source manual --json '{
  "entry_type":"decision",
  "tags":["embeddings","openai","adapter"],
  "files_modified":["src/adapters/openai-embeddings.ts","src/lib/embeddings.ts"],
  "rationale":"The project standardizes on text-embedding-3-small through OpenAIEmbeddingsAdapter behind a provider factory to keep embedding provider selection replaceable."
}'
```

## Validation Workflow

1. Save generated JSON to a local file, for example `bootstrap.json`.
2. Validate before writing:

```bash
node --loader ts-node/esm scripts/validate-bootstrap.ts ./bootstrap.json
```

3. If validation passes, write each item through `memo write --source manual --json`.

## Verification Queries

After writing entries, run search checks to confirm discoverability.

```bash
memo search "how is the CLI command layer structured" --tags "cli,commander"
memo search "where does qdrant integration happen" --tags "qdrant,repository"
memo search "which embedding provider is currently used" --tags "embeddings,openai"
```

Expected result:

- Queries return the new bootstrap entries with matching rationale and file references.
