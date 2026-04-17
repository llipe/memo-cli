import { MemoError } from '../../../src/lib/errors';

describe('MemoError', () => {
  it('has code, exitCode, and message', () => {
    const err = new MemoError('CONFIG_NOT_FOUND', 'config not found');
    expect(err.code).toBe('CONFIG_NOT_FOUND');
    expect(err.exitCode).toBe(1);
    expect(err.message).toBe('config not found');
  });

  it('default exitCode is 1', () => {
    const err = new MemoError('UNEXPECTED_ERROR', 'unexpected');
    expect(err.exitCode).toBe(1);
  });

  it('can set exitCode to 0', () => {
    const err = new MemoError('UNEXPECTED_ERROR', 'unexpected', 0);
    expect(err.exitCode).toBe(0);
  });

  it('can set exitCode to 2', () => {
    const err = new MemoError('UNEXPECTED_ERROR', 'unexpected', 2);
    expect(err.exitCode).toBe(2);
  });

  it('name is MemoError', () => {
    const err = new MemoError('UNEXPECTED_ERROR', 'unexpected');
    expect(err.name).toBe('MemoError');
  });

  it('instanceof Error', () => {
    const err = new MemoError('UNEXPECTED_ERROR', 'unexpected');
    expect(err).toBeInstanceOf(Error);
  });

  it('covers all error codes', () => {
    const codes = [
      'CONFIG_NOT_FOUND',
      'CONFIG_INVALID',
      'MISSING_CREDENTIAL',
      'VALIDATION_FAILED',
      'REPO_CONTEXT_UNRESOLVED',
      'ENTRY_NOT_FOUND',
      'QDRANT_UNREACHABLE',
      'QDRANT_OPERATION_FAILED',
      'EMBEDDING_API_ERROR',
      'COLLECTION_BOOTSTRAP_FAILED',
      'UNEXPECTED_ERROR',
    ] as const;

    for (const code of codes) {
      const err = new MemoError(code, 'test');
      expect(err.code).toBe(code);
    }
  });
});
