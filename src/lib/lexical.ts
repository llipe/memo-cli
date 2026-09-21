/**
 * Lexical identifier matching (Story S1-06, issue #62).
 *
 * Pure and side-effect free: no I/O, no clock reads. This module supplies
 * the client-side half of the lexical-boost pipeline whose server-side half
 * is the Qdrant `text` index declared in `src/lib/qdrant.ts`'s
 * `PAYLOAD_INDEXES` (`tokenizer: word`, `lowercase: true`, `min_token_len:
 * 2`, `max_token_len: 20`). `tokenizeWord` intentionally mirrors those exact
 * settings so a client-computed match agrees with what Qdrant's index would
 * report (spec §8.2, Decision A4: additive boost, not reciprocal rank
 * fusion, because Qdrant text indexes return boolean matches, not BM25
 * scores).
 */

const DEFAULT_MIN_TOKEN_LEN = 2;
const DEFAULT_MAX_TOKEN_LEN = 20;

const ISSUE_REFERENCE_RE = /^#\d+$/;
const TICKET_REFERENCE_RE = /^[A-Z]+-\d+$/;
/** A token with at least one lowercase-to-uppercase transition (covers both camelCase and PascalCase). */
const CASE_TRANSITION_RE = /[a-z][A-Z]/;
const ALPHANUMERIC_ONLY_RE = /^[A-Za-z][A-Za-z0-9]*$/;
/** Trailing sentence punctuation stripped before classification (not internal punctuation - file extensions matter). */
const TRAILING_PUNCTUATION_RE = /[.,!?;:]+$/u;

function stripTrailingPunctuation(token: string): string {
  return token.replace(TRAILING_PUNCTUATION_RE, '');
}

function isCamelCase(token: string): boolean {
  return ALPHANUMERIC_ONLY_RE.test(token) && CASE_TRANSITION_RE.test(token);
}

function isIdentifierToken(token: string): boolean {
  if (token.length === 0) return false;
  if (/[./_-]/.test(token)) return true;
  if (ISSUE_REFERENCE_RE.test(token)) return true;
  if (TICKET_REFERENCE_RE.test(token)) return true;
  if (token.startsWith('--') && token.length > 2) return true;
  if (isCamelCase(token)) return true;
  return false;
}

/**
 * Extracts identifier-shaped tokens from a raw search query (AC3): tokens
 * that contain `.`, `/`, `-`, or `_`, match `#\d+` or `[A-Z]+-\d+`, start
 * with `--`, or are CamelCase. An ordinary prose query returns `[]`.
 *
 * Order is preserved and duplicates are dropped (case-sensitive - `PROJ-45`
 * and `proj-45` are distinct query surface forms and both may legitimately
 * appear, though in practice a query rarely repeats a token).
 */
export function extractIdentifierTokens(query: string | null | undefined): string[] {
  if (typeof query !== 'string') return [];

  const seen = new Set<string>();
  const identifiers: string[] = [];

  for (const raw of query.split(/\s+/)) {
    const token = stripTrailingPunctuation(raw);
    if (token.length === 0) continue;
    if (!isIdentifierToken(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    identifiers.push(token);
  }

  return identifiers;
}

/**
 * Tokenizes text with parity to Qdrant's `word` tokenizer as configured on
 * `rationale`/`files_modified` (`lowercase: true`, `min_token_len: 2`,
 * `max_token_len: 20`): lowercase, split on runs of non-alphanumeric
 * characters, drop tokens outside `[minTokenLen, maxTokenLen]`.
 */
export function tokenizeWord(
  text: string | null | undefined,
  minTokenLen: number = DEFAULT_MIN_TOKEN_LEN,
  maxTokenLen: number = DEFAULT_MAX_TOKEN_LEN,
): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= minTokenLen && token.length <= maxTokenLen);
}

/**
 * Cosine similarity between two vectors, defensively normalized (D-note in
 * S1-06's Technical Notes: vectors are normalized by OpenAI, but this helper
 * never assumes it). Returns `0` for zero-length, mismatched-length, or
 * zero-magnitude vectors rather than `NaN`/throwing.
 */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * `lexical_boost` = (identifiers fully matched in `rationale ∪
 * files_modified`) / (total identifiers) × `factor` (AC6).
 *
 * All-or-nothing per identifier (Business Rules): an identifier like
 * `search-filters.ts` matches a candidate only if *every* one of its word
 * tokens (per `tokenizeWord`) is present in the candidate's tokenized
 * `rationale ∪ files_modified`. An identifier that tokenizes to nothing
 * (every component shorter than `min_token_len`) never counts as matched,
 * but still divides into the denominator.
 */
export function computeLexicalBoost(
  identifiers: readonly string[],
  rationale: string | null | undefined,
  filesModified: readonly unknown[] | null | undefined,
  factor: number,
): number {
  if (!Number.isFinite(factor) || factor <= 0) return 0;
  if (identifiers.length === 0) return 0;

  const corpusTokens = new Set<string>(tokenizeWord(rationale ?? ''));
  if (Array.isArray(filesModified)) {
    for (const file of filesModified) {
      if (typeof file !== 'string') continue;
      for (const token of tokenizeWord(file)) corpusTokens.add(token);
    }
  }

  let matched = 0;
  for (const identifier of identifiers) {
    const idTokens = tokenizeWord(identifier);
    if (idTokens.length === 0) continue;
    if (idTokens.every((token) => corpusTokens.has(token))) matched += 1;
  }

  return (matched / identifiers.length) * factor;
}
