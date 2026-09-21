import { MemoConfigSchema } from '../../../src/types/config';

const VALID_BASE = {
  schema_version: '1' as const,
  repo: 'my-app',
  org: 'acme-corp',
  domain: 'developer-tools',
};

describe('MemoConfigSchema', () => {
  // ---------------------------------------------------------------------------
  // Valid inputs
  // ---------------------------------------------------------------------------

  it('accepts a minimal valid config', () => {
    const result = MemoConfigSchema.safeParse(VALID_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relates_to).toEqual([]);
      expect(result.data.defaults.source).toBe('agent');
      expect(result.data.defaults.search_scope).toBe('repo');
    }
  });

  it('accepts a full valid config', () => {
    const result = MemoConfigSchema.safeParse({
      ...VALID_BASE,
      relates_to: ['other-repo', 'third-repo'],
      defaults: { source: 'manual', search_scope: 'related' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts repo names with digits and hyphens', () => {
    const result = MemoConfigSchema.safeParse({
      ...VALID_BASE,
      repo: 'my-app-v2',
    });
    expect(result.success).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Defaults
  // ---------------------------------------------------------------------------

  it('defaults relates_to to empty array when omitted', () => {
    const result = MemoConfigSchema.safeParse(VALID_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relates_to).toEqual([]);
    }
  });

  it('defaults defaults.source to "agent"', () => {
    const result = MemoConfigSchema.safeParse(VALID_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaults.source).toBe('agent');
    }
  });

  it('defaults defaults.search_scope to "repo"', () => {
    const result = MemoConfigSchema.safeParse(VALID_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaults.search_scope).toBe('repo');
    }
  });

  it('defaults entire defaults object when omitted', () => {
    const result = MemoConfigSchema.safeParse(VALID_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaults).toEqual({ source: 'agent', search_scope: 'repo' });
    }
  });

  // ---------------------------------------------------------------------------
  // Unknown-key passthrough
  // ---------------------------------------------------------------------------

  it('passes through unknown keys without error', () => {
    const result = MemoConfigSchema.safeParse({
      ...VALID_BASE,
      future_field: 'some-value',
      nested_future: { a: 1 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)['future_field']).toBe('some-value');
    }
  });

  // ---------------------------------------------------------------------------
  // Required field validation
  // ---------------------------------------------------------------------------

  it('rejects missing schema_version', () => {
    const { schema_version: _sv, ...rest } = VALID_BASE;
    const result = MemoConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects wrong schema_version literal', () => {
    const result = MemoConfigSchema.safeParse({ ...VALID_BASE, schema_version: '2' });
    expect(result.success).toBe(false);
  });

  it('rejects missing repo', () => {
    const { repo: _r, ...rest } = VALID_BASE;
    const result = MemoConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing org', () => {
    const { org: _o, ...rest } = VALID_BASE;
    const result = MemoConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing domain', () => {
    const { domain: _d, ...rest } = VALID_BASE;
    const result = MemoConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Kebab-case validation
  // ---------------------------------------------------------------------------

  it('rejects repo with uppercase letters', () => {
    const result = MemoConfigSchema.safeParse({ ...VALID_BASE, repo: 'MyApp' });
    expect(result.success).toBe(false);
  });

  it('rejects repo with spaces', () => {
    const result = MemoConfigSchema.safeParse({ ...VALID_BASE, repo: 'my app' });
    expect(result.success).toBe(false);
  });

  it('rejects repo with leading hyphen', () => {
    const result = MemoConfigSchema.safeParse({ ...VALID_BASE, repo: '-my-app' });
    expect(result.success).toBe(false);
  });

  it('rejects repo with trailing hyphen', () => {
    const result = MemoConfigSchema.safeParse({ ...VALID_BASE, repo: 'my-app-' });
    expect(result.success).toBe(false);
  });

  it('rejects repo with underscores', () => {
    const result = MemoConfigSchema.safeParse({ ...VALID_BASE, repo: 'my_app' });
    expect(result.success).toBe(false);
  });

  it('rejects non-kebab-case org', () => {
    const result = MemoConfigSchema.safeParse({ ...VALID_BASE, org: 'AcmeCorp' });
    expect(result.success).toBe(false);
  });

  it('rejects non-kebab-case domain', () => {
    const result = MemoConfigSchema.safeParse({ ...VALID_BASE, domain: 'Developer Tools' });
    expect(result.success).toBe(false);
  });

  it('rejects non-kebab-case entry in relates_to', () => {
    const result = MemoConfigSchema.safeParse({
      ...VALID_BASE,
      relates_to: ['valid-repo', 'Invalid_Repo'],
    });
    expect(result.success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // relates_to cross-field validation
  // ---------------------------------------------------------------------------

  it('rejects duplicate entries in relates_to', () => {
    const result = MemoConfigSchema.safeParse({
      ...VALID_BASE,
      relates_to: ['other-repo', 'other-repo'],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('Duplicate'))).toBe(true);
    }
  });

  it('rejects relates_to entry equal to repo', () => {
    const result = MemoConfigSchema.safeParse({
      ...VALID_BASE,
      repo: 'my-app',
      relates_to: ['my-app'],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('must not equal repo'))).toBe(true);
    }
  });

  it('accepts relates_to with no duplicates and no self-reference', () => {
    const result = MemoConfigSchema.safeParse({
      ...VALID_BASE,
      repo: 'my-app',
      relates_to: ['other-repo', 'third-repo'],
    });
    expect(result.success).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // defaults validation
  // ---------------------------------------------------------------------------

  it('rejects invalid defaults.source value', () => {
    const result = MemoConfigSchema.safeParse({
      ...VALID_BASE,
      defaults: { source: 'unknown', search_scope: 'repo' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid defaults.search_scope value', () => {
    const result = MemoConfigSchema.safeParse({
      ...VALID_BASE,
      defaults: { source: 'agent', search_scope: 'global' },
    });
    expect(result.success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // ranking (issue #34)
  // ---------------------------------------------------------------------------

  describe('ranking', () => {
    it('resolves full defaults when the ranking block is absent (AC10)', () => {
      const result = MemoConfigSchema.safeParse(VALID_BASE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ranking).toEqual({
          w_similarity: 0.6,
          w_recency: 0.3,
          w_source: 0.1,
          recency_half_life_days: 365,
        });
      }
    });

    it('resolves full defaults when the ranking block is an empty object', () => {
      const result = MemoConfigSchema.safeParse({ ...VALID_BASE, ranking: {} });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ranking.w_similarity).toBe(0.6);
      }
    });

    // EC-11 / F-2: the documented defaults, written out literally, must
    // themselves pass validation even though 0.6 + 0.3 + 0.1 !== 1.0 in
    // IEEE 754 - the ±0.001 tolerance is load-bearing.
    it('accepts the documented defaults written out literally (EC-11, F-2)', () => {
      const result = MemoConfigSchema.safeParse({
        ...VALID_BASE,
        ranking: { w_similarity: 0.6, w_recency: 0.3, w_source: 0.1 },
      });
      expect(result.success).toBe(true);
    });

    it('accepts a fully specified valid ranking block (AC8)', () => {
      const result = MemoConfigSchema.safeParse({
        ...VALID_BASE,
        ranking: { w_similarity: 0.5, w_recency: 0.4, w_source: 0.1, recency_half_life_days: 30 },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ranking).toEqual({
          w_similarity: 0.5,
          w_recency: 0.4,
          w_source: 0.1,
          recency_half_life_days: 30,
        });
      }
    });

    it('rejects a partial block whose resolved weights break the sum check (AC11)', () => {
      const result = MemoConfigSchema.safeParse({
        ...VALID_BASE,
        ranking: { w_similarity: 0.5 },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.join('.') === 'ranking');
        expect(issue).toBeDefined();
        expect(issue?.message).toContain('0.9');
      }
    });

    it('accepts a partial block that only overrides recency_half_life_days, since the untouched weights still sum to 1.0 (CT-5c)', () => {
      const result = MemoConfigSchema.safeParse({
        ...VALID_BASE,
        ranking: { recency_half_life_days: 30 },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ranking).toEqual({
          w_similarity: 0.6,
          w_recency: 0.3,
          w_source: 0.1,
          recency_half_life_days: 30,
        });
      }
    });

    it('rejects weights summing to 0.9, naming the ranking path and the actual sum (AC9)', () => {
      const result = MemoConfigSchema.safeParse({
        ...VALID_BASE,
        ranking: { w_similarity: 0.5, w_recency: 0.3, w_source: 0.1 },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.join('.') === 'ranking');
        expect(issue?.message).toMatch(/ranking weights/);
        expect(issue?.message).toContain('0.9');
      }
    });

    it('rejects weights summing to 1.1', () => {
      const result = MemoConfigSchema.safeParse({
        ...VALID_BASE,
        ranking: { w_similarity: 0.6, w_recency: 0.4, w_source: 0.1 },
      });
      expect(result.success).toBe(false);
    });

    it('accepts a sum within the ±0.001 tolerance boundary', () => {
      const result = MemoConfigSchema.safeParse({
        ...VALID_BASE,
        ranking: { w_similarity: 0.6005, w_recency: 0.3, w_source: 0.1 },
      });
      expect(result.success).toBe(true);
    });

    it('rejects a sum just outside the ±0.001 tolerance boundary', () => {
      const result = MemoConfigSchema.safeParse({
        ...VALID_BASE,
        ranking: { w_similarity: 0.6015, w_recency: 0.3, w_source: 0.1 },
      });
      expect(result.success).toBe(false);
    });

    it('rejects recency_half_life_days of 0 (R10)', () => {
      const result = MemoConfigSchema.safeParse({
        ...VALID_BASE,
        ranking: { recency_half_life_days: 0 },
      });
      expect(result.success).toBe(false);
    });

    it('rejects a negative recency_half_life_days (R10)', () => {
      const result = MemoConfigSchema.safeParse({
        ...VALID_BASE,
        ranking: { recency_half_life_days: -1 },
      });
      expect(result.success).toBe(false);
    });

    it('rejects a non-finite recency_half_life_days', () => {
      const result = MemoConfigSchema.safeParse({
        ...VALID_BASE,
        ranking: { recency_half_life_days: Infinity },
      });
      expect(result.success).toBe(false);
    });

    it('rejects an individual weight above 1 even if the sum is 1.0 (R11)', () => {
      const result = MemoConfigSchema.safeParse({
        ...VALID_BASE,
        ranking: { w_similarity: 2.0, w_recency: -1.0, w_source: 0.0 },
      });
      expect(result.success).toBe(false);
    });

    it('rejects a string in place of a numeric weight, without coercion (CT-6)', () => {
      const result = MemoConfigSchema.safeParse({
        ...VALID_BASE,
        ranking: { w_similarity: '0.6', w_recency: 0.3, w_source: 0.1 },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.join('.') === 'ranking.w_similarity');
        expect(issue).toBeDefined();
      }
    });

    it('rejects null in place of a numeric weight', () => {
      const result = MemoConfigSchema.safeParse({
        ...VALID_BASE,
        ranking: { w_similarity: 0.6, w_recency: null, w_source: 0.1 },
      });
      expect(result.success).toBe(false);
    });

    it('preserves an unknown key inside ranking and ignores it in the sum (CT-7)', () => {
      const result = MemoConfigSchema.safeParse({
        ...VALID_BASE,
        ranking: {
          w_similarity: 0.6,
          w_recency: 0.3,
          w_source: 0.1,
          w_future_signal: 0.5,
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data.ranking as Record<string, unknown>)['w_future_signal']).toBe(0.5);
      }
    });
  });
});
