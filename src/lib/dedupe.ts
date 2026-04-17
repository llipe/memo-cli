import { createHash } from 'node:crypto';
import type { EntryPayload } from '../types/entry.js';

export interface DedupeKeyParams {
  repo: string;
  commit: string | undefined;
  story: string | undefined;
  entry_type: string;
  source: string;
}

export function buildDedupeKey(params: DedupeKeyParams): string {
  const { repo, commit, story, entry_type, source } = params;
  const canonical = `v1|${repo}|${commit ?? 'na'}|${story ?? 'na'}|${entry_type}|${source}`;
  return createHash('sha256').update(canonical).digest('hex');
}

export function sourceToConfidence(source: 'agent' | 'manual'): 'high' | 'medium' {
  return source === 'agent' ? 'high' : 'medium';
}

export function buildEmbedText(rationale: string, tags: string[]): string {
  const firstSentence = rationale.split(/[.!?]/)[0]?.trim() ?? rationale.slice(0, 100);
  const normalizedTags = tags.join(' ');
  return `${firstSentence}\n${normalizedTags}\n${rationale}`;
}

const CONFIDENCE_ORDER: Record<string, number> = { high: 2, medium: 1, low: 0 };

export function consolidate(existing: EntryPayload, incoming: EntryPayload): EntryPayload {
  const tags = [...new Set([...incoming.tags, ...existing.tags])].slice(0, 5) as [
    string,
    string,
    ...string[],
  ];
  const files_modified = [
    ...new Set([...(existing.files_modified ?? []), ...(incoming.files_modified ?? [])]),
  ];
  const relates_to = [...new Set([...(existing.relates_to ?? []), ...(incoming.relates_to ?? [])])];

  const existingConf = CONFIDENCE_ORDER[existing.confidence] ?? 0;
  const incomingConf = CONFIDENCE_ORDER[incoming.confidence] ?? 0;
  const confidence = incomingConf >= existingConf ? incoming.confidence : existing.confidence;

  const rationale =
    incoming.rationale.length > existing.rationale.length ? incoming.rationale : existing.rationale;

  return {
    ...existing,
    tags,
    files_modified: files_modified.length > 0 ? files_modified : existing.files_modified,
    relates_to: relates_to.length > 0 ? relates_to : existing.relates_to,
    confidence,
    rationale,
    timestamp_utc: existing.timestamp_utc,
  };
}

export function update(existing: EntryPayload, patch: Partial<EntryPayload>): EntryPayload {
  return {
    ...existing,
    tags: patch.tags ?? existing.tags,
    files_modified: patch.files_modified ?? existing.files_modified,
    relates_to: patch.relates_to ?? existing.relates_to,
    story: patch.story ?? existing.story,
  };
}
