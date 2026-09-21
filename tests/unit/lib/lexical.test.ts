import {
  cosine,
  computeLexicalBoost,
  extractIdentifierTokens,
  tokenizeWord,
} from '../../../src/lib/lexical';

describe('extractIdentifierTokens', () => {
  it('extracts a file path token', () => {
    expect(extractIdentifierTokens('why does search-filters.ts build should clauses')).toEqual([
      'search-filters.ts',
    ]);
  });

  it('extracts a dotted name', () => {
    expect(extractIdentifierTokens('what is ranking.lexical_boost_factor for')).toEqual([
      'ranking.lexical_boost_factor',
    ]);
  });

  it('extracts kebab-case and snake_case tokens', () => {
    expect(extractIdentifierTokens('rate-limiting and tag_boost_factor')).toEqual([
      'rate-limiting',
      'tag_boost_factor',
    ]);
  });

  it('extracts an issue reference (#123)', () => {
    expect(extractIdentifierTokens('why did #123 change this')).toEqual(['#123']);
  });

  it('extracts a ticket reference (PROJ-45)', () => {
    expect(extractIdentifierTokens('what does PROJ-45 require')).toEqual(['PROJ-45']);
  });

  it('extracts a flag token (--flag)', () => {
    expect(extractIdentifierTokens('what does --lexical do')).toEqual(['--lexical']);
  });

  it('extracts a CamelCase token', () => {
    expect(extractIdentifierTokens('what does extractIdentifierTokens return')).toEqual([
      'extractIdentifierTokens',
    ]);
  });

  it('extracts a PascalCase token', () => {
    expect(extractIdentifierTokens('what is QdrantRepository for')).toEqual(['QdrantRepository']);
  });

  it('returns [] for a prose-only query', () => {
    expect(extractIdentifierTokens('why does search stop working sometimes')).toEqual([]);
  });

  it('returns [] for an empty query', () => {
    expect(extractIdentifierTokens('')).toEqual([]);
  });

  it('returns [] for a non-string query', () => {
    expect(extractIdentifierTokens(undefined)).toEqual([]);
    expect(extractIdentifierTokens(null)).toEqual([]);
  });

  it('strips trailing punctuation before classifying', () => {
    expect(extractIdentifierTokens('what about search-filters.ts?')).toEqual(['search-filters.ts']);
  });

  it('is punctuation-heavy safe and never throws', () => {
    expect(() => extractIdentifierTokens('!!! ... --- ??? ,,,')).not.toThrow();
  });

  it('deduplicates repeated identifier tokens preserving first-seen order', () => {
    expect(extractIdentifierTokens('search-filters.ts and search-filters.ts again')).toEqual([
      'search-filters.ts',
    ]);
  });
});

describe('tokenizeWord (tokenizer parity)', () => {
  it('lowercases and splits on non-alphanumeric runs', () => {
    expect(tokenizeWord('Search-Filters.ts')).toEqual(['search', 'filters', 'ts']);
  });

  it('drops tokens shorter than min_token_len (default 2)', () => {
    expect(tokenizeWord('a.b.abc')).toEqual(['abc']);
  });

  it('drops tokens longer than max_token_len (default 20)', () => {
    const longToken = 'x'.repeat(21);
    expect(tokenizeWord(longToken)).toEqual([]);
  });

  it('keeps a token exactly at max_token_len (20)', () => {
    const token = 'x'.repeat(20);
    expect(tokenizeWord(token)).toEqual([token]);
  });

  it('returns [] for empty/non-string input', () => {
    expect(tokenizeWord('')).toEqual([]);
    expect(tokenizeWord(undefined)).toEqual([]);
    expect(tokenizeWord(null)).toEqual([]);
  });
});

describe('cosine', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });

  it('returns 0 for zero-length vectors', () => {
    expect(cosine([], [])).toBe(0);
  });

  it('returns 0 for zero-magnitude vectors', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  it('returns 0 for mismatched-length vectors', () => {
    expect(cosine([1, 0], [1, 0, 0])).toBe(0);
  });
});

describe('computeLexicalBoost', () => {
  const factor = 0.15;

  it('returns the full factor when the only identifier fully matches rationale', () => {
    const boost = computeLexicalBoost(
      ['search-filters.ts'],
      'Documents why search-filters.ts builds should clauses',
      undefined,
      factor,
    );
    expect(boost).toBeCloseTo(factor, 6);
  });

  it('returns the full factor when the only identifier fully matches files_modified', () => {
    const boost = computeLexicalBoost(
      ['search-filters.ts'],
      'unrelated rationale text',
      ['src/lib/search-filters.ts'],
      factor,
    );
    expect(boost).toBeCloseTo(factor, 6);
  });

  it('returns a partial fraction when only some identifiers match', () => {
    const boost = computeLexicalBoost(
      ['search-filters.ts', 'nonexistent-file.ts'],
      'Documents why search-filters.ts builds should clauses',
      undefined,
      factor,
    );
    expect(boost).toBeCloseTo(0.5 * factor, 6);
  });

  it('returns 0 when no identifiers match', () => {
    const boost = computeLexicalBoost(
      ['nonexistent-file.ts'],
      'totally unrelated rationale',
      undefined,
      factor,
    );
    expect(boost).toBe(0);
  });

  it('returns 0 for factor 0', () => {
    const boost = computeLexicalBoost(
      ['search-filters.ts'],
      'Documents why search-filters.ts builds should clauses',
      undefined,
      0,
    );
    expect(boost).toBe(0);
  });

  it('returns 0 for an empty identifiers list', () => {
    expect(computeLexicalBoost([], 'search-filters.ts', undefined, factor)).toBe(0);
  });

  it('applies all-or-nothing matching per identifier (partial token match does not count)', () => {
    const boost = computeLexicalBoost(
      ['search-filters.ts'],
      'mentions search but not the full filename',
      undefined,
      factor,
    );
    expect(boost).toBe(0);
  });

  it('scales linearly across multiple fully-matched identifiers', () => {
    const boost = computeLexicalBoost(
      ['search-filters.ts', 'ranking.ts'],
      'search-filters.ts and ranking.ts both changed',
      undefined,
      factor,
    );
    expect(boost).toBeCloseTo(factor, 6);
  });
});
