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
});
