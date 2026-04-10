import type { MemoConfig } from '../types/config.js';

export interface ResolveScopeReposInput {
  repo: string;
  scope: 'repo' | 'related';
  config?: MemoConfig | null;
}

export function resolveScopeRepos(input: ResolveScopeReposInput): string[] {
  if (input.scope !== 'related') {
    return [input.repo];
  }

  const relatedRepos = input.config?.relates_to ?? [];
  return [...new Set([input.repo, ...relatedRepos])];
}
