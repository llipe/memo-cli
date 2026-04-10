// TODO: Implement in S-003 — MemoError hierarchy + error catalog

export type ErrorCode =
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_INVALID'
  | 'MISSING_CREDENTIAL'
  | 'VALIDATION_FAILED'
  | 'REPO_CONTEXT_UNRESOLVED'
  | 'ENTRY_NOT_FOUND'
  | 'QDRANT_UNREACHABLE'
  | 'QDRANT_OPERATION_FAILED'
  | 'EMBEDDING_API_ERROR'
  | 'COLLECTION_BOOTSTRAP_FAILED'
  | 'UNEXPECTED_ERROR';

export class MemoError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly exitCode: 0 | 1 | 2 = 1,
  ) {
    super(message);
    this.name = 'MemoError';
  }
}
