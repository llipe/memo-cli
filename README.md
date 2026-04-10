# memo-cli

> Agent-first CLI for capturing and querying development decisions via a Qdrant vector store.

`@memo-ai/cli` lets agents and developers record architectural decisions, integration points, and structural choices during development, then retrieve them semantically at any time.

---

## Requirements

| Tool | Version |
|------|---------|
| Node.js | ≥ 24 LTS |
| pnpm | ≥ 9.x |
| Qdrant | ≥ 1.7 (local or cloud) |

---

## Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/llipe/memo-cli.git
cd memo-cli
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your Qdrant and embeddings credentials:

```dotenv
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=                   # leave empty for unauthenticated local Qdrant
EMBEDDINGS_PROVIDER=openai
EMBEDDINGS_API_KEY=sk-...
```

### 4. Build

```bash
pnpm run build
```

### 5. Verify

```bash
./dist/index.js --help
```

---

## Development Scripts

| Script | Description |
|--------|-------------|
| `pnpm run build` | Compile TypeScript to `dist/` |
| `pnpm run typecheck` | Type-check without emitting files |
| `pnpm run lint` | ESLint (v9 flat config) |
| `pnpm run lint:fix` | ESLint with auto-fix |
| `pnpm run format` | Prettier format |
| `pnpm run test` | Run Jest test suite |
| `pnpm run test:coverage` | Run Jest with coverage report |

---

## Quick Start

### Global Install (from npm)

```bash
npm install -g @memo-ai/cli
memo --version
```

### First-Run Example

```bash
# Initialize memo config for this repository
memo setup init

# Write a decision
memo write \
  --rationale "Chose Qdrant over Pinecone for self-hosting flexibility and payload filtering." \
  --tags "architecture,storage,qdrant" \
  --entry-type decision \
  --source agent

# Search decisions
memo search "why did we choose the vector database"

# Search within related repos and require tags
memo search "how do we persist decisions" \
  --scope related \
  --tags "qdrant,write-flow"

# Machine-readable search output
memo search "how do we persist decisions" --json

# List recent entries
memo list --limit 10
```

Bootstrap onboarding workflow:

- See `docs/bootstrap-guide.md` for the prompt template, JSON conversion examples, and validation steps.

---

## Project Structure

```
src/
├── index.ts          # CLI entry point (Commander root)
├── commands/         # One module per subcommand
├── lib/              # Shared utilities (qdrant, config, output, errors, …)
├── adapters/         # Provider implementations (OpenAI, Voyage, …)
└── types/            # Zod schemas and TypeScript types
tests/
├── unit/
└── integration/
```

---

## License

MIT
