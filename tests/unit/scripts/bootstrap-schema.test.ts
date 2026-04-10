import { BootstrapEntrySchema, validateBootstrapItems } from '../../../scripts/validate-bootstrap';

describe('BootstrapEntrySchema', () => {
  it('accepts a valid bootstrap item', () => {
    const result = BootstrapEntrySchema.safeParse({
      entry_type: 'structure',
      tags: ['cli', 'commands'],
      files_modified: ['src/index.ts'],
      rationale: 'CLI entrypoint wires command modules.',
      relates_to: ['memo-cli-docs'],
    });

    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = BootstrapEntrySchema.safeParse({
      entry_type: 'structure',
      tags: ['cli', 'commands'],
      files_modified: ['src/index.ts'],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'rationale')).toBe(true);
    }
  });

  it('rejects invalid entry_type values', () => {
    const result = BootstrapEntrySchema.safeParse({
      entry_type: 'note',
      tags: ['cli', 'commands'],
      files_modified: ['src/index.ts'],
      rationale: 'Invalid entry type should fail.',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'entry_type')).toBe(true);
    }
  });

  it('rejects tags outside allowed cardinality', () => {
    const tooFew = BootstrapEntrySchema.safeParse({
      entry_type: 'decision',
      tags: ['onlyone'],
      files_modified: ['src/lib/qdrant.ts'],
      rationale: 'Too few tags.',
    });

    const tooMany = BootstrapEntrySchema.safeParse({
      entry_type: 'decision',
      tags: ['a', 'b', 'c', 'd', 'e', 'f'],
      files_modified: ['src/lib/qdrant.ts'],
      rationale: 'Too many tags.',
    });

    expect(tooFew.success).toBe(false);
    expect(tooMany.success).toBe(false);
  });

  it('rejects extra fields', () => {
    const result = BootstrapEntrySchema.safeParse({
      entry_type: 'integration_point',
      tags: ['qdrant', 'storage'],
      files_modified: ['src/lib/qdrant.ts'],
      rationale: 'Repository boundary for storage integration.',
      confidence: 'medium',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true);
    }
  });
});

describe('validateBootstrapItems', () => {
  it('returns root error when input is not an array', () => {
    const errors = validateBootstrapItems({ not: 'an-array' });
    expect(errors).toEqual(['[root]: expected an array of bootstrap items']);
  });

  it('returns human-readable field path errors', () => {
    const errors = validateBootstrapItems([
      {
        entry_type: 'invalid',
        tags: ['a'],
        files_modified: [],
        rationale: '',
      },
    ]);

    expect(errors.some((error) => error.includes('[0].entry_type'))).toBe(true);
    expect(errors.some((error) => error.includes('[0].tags'))).toBe(true);
    expect(errors.some((error) => error.includes('[0].files_modified'))).toBe(true);
  });
});
