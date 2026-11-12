/**
 * `assembleRecall` (issue #86, S2-07) — spec §8.5/§18.9, PRD FR-2.6/AC-2.6.
 *
 * Pure, side-effect free: no I/O, no ambient clock reads, no randomness.
 * Given the six already-gathered candidate sections (command-side, per the
 * §18.9 table) plus a token budget, this module owns:
 *
 *   - cross-section id dedup (an id kept in an earlier canonical section is
 *     dropped from every later one, before caps are applied — EC-04/EC-05,
 *     EC-17);
 *   - per-section caps (`SHARED` 8, `MINE` 5, `LAST SESSION` 15 most-recent
 *     by `seq`, `CONFLICTS` 5; `SELF`/`POLICIES` uncapped);
 *   - token-budget trimming in the fixed order `conflicts → last_session
 *     (oldest first) → mine (down to a floor of 2) → shared → mine (the
 *     floor) → policies`, stopping at the first fitting budget; `SELF` is
 *     never trimmed (K4) — even when it alone
 *     exceeds `max_tokens`, in which case every other active section is
 *     trimmed to empty and reported in `truncated`, and `budget.used_tokens`
 *     is reported honestly (never clamped);
 *   - `bank = kb` section omission (FR-2.6): `self`, `mine`, `last_session`
 *     are omitted keys — not empty arrays — from the returned bundle.
 *
 * The command layer (`src/commands/recall.ts`) is the only place that talks
 * to Qdrant/embeddings; this module never imports either.
 */

import { DEFAULT_BANK_ID } from '../types/config.js';

/** One candidate entry as seen by `assembleRecall` — already ranked/ordered by the caller where applicable. */
export interface RecallEntry {
  id: string | number;
  /**
   * The canonical rendered line for this entry (JSON: rationale + ids +
   * scores, per spec §8.5) — `tokens = ceil(renderedLine.length / 4)` is
   * computed once, here, from this string so every caller shares one token
   * estimator.
   */
  renderedLine: string;
  /** `LAST SESSION` ordering key (spec §18.9: `seq asc`). Ignored by every other section. */
  seq?: number;
  /** The JSON-ready projection for this entry, echoed verbatim into the output bundle. */
  data: Record<string, unknown>;
}

export interface RecallLastSessionInput {
  sessionId: string | null;
  entries: RecallEntry[];
}

/**
 * The six gathered sections plus envelope-level identity (spec §18.9's
 * gathering table). Callers pass empty inputs for `self`/`mine`/
 * `lastSession` when `bank = kb` — `assembleRecall` ignores them
 * unconditionally in that mode rather than trusting the caller not to have
 * fetched them (defense in depth for the FR-2.6 omission contract).
 */
export interface RecallInputs {
  bank: string;
  queryId: string;
  self: RecallEntry[];
  policies: RecallEntry[];
  shared: RecallEntry[];
  mine: RecallEntry[];
  lastSession: RecallLastSessionInput;
  conflicts: RecallEntry[];
}

export interface RecallBudget {
  maxTokens: number;
}

export type RecallSectionName = 'policies' | 'shared' | 'mine' | 'last_session' | 'conflicts';

export interface RecallBundle {
  query_id: string;
  bank: string;
  budget: { max_tokens: number; used_tokens: number };
  sections: {
    self?: Record<string, unknown>[];
    policies: Record<string, unknown>[];
    shared: Record<string, unknown>[];
    mine?: Record<string, unknown>[];
    last_session?: { session_id: string | null; entries: Record<string, unknown>[] };
    conflicts: Record<string, unknown>[];
  };
  truncated: RecallSectionName[];
  /** Entries each section lost to the budget; a section that lost none is absent. */
  dropped: Partial<Record<RecallSectionName, number>>;
}

/** Token estimate: `ceil(chars / 4)` of the rendered line (spec §8.5/§18.9, AC3). */
export function estimateTokens(renderedLine: string): number {
  return Math.ceil(renderedLine.length / 4);
}

const SHARED_CAP = 8;
const MINE_CAP = 5;
const LAST_SESSION_CAP = 15;
const CONFLICTS_CAP = 5;

/** How many top `MINE` entries can survive until `SHARED` is empty (issue #118). */
const MINE_FLOOR = 2;

/** Canonical order of the `truncated` array (CT-04). */
const TRIM_ORDER: RecallSectionName[] = ['conflicts', 'last_session', 'mine', 'shared', 'policies'];

/**
 * Trim passes (AC3, issue #118): lowest-priority first; `self` is never a
 * member. `MINE` appears twice so a bank's best lessons outlast `SHARED`,
 * whose 8 entries alone can exceed the default budget.
 */
const TRIM_PASSES: { name: RecallSectionName; floor: boolean }[] = [
  { name: 'conflicts', floor: false },
  { name: 'last_session', floor: false },
  { name: 'mine', floor: true },
  { name: 'shared', floor: false },
  { name: 'mine', floor: false },
  { name: 'policies', floor: false },
];

function lastIndexWhere(
  entries: readonly WorkingEntry[],
  matches: (entry: WorkingEntry) => boolean,
): number {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry !== undefined && matches(entry)) return i;
  }
  return -1;
}

/**
 * The `MINE` entries to protect: the best up to `MINE_FLOOR` that fit beside
 * `SELF` and `POLICIES`, which both outlast them. Protecting a lesson too long
 * to fit would clear `SHARED` for nothing, and must not cost a smaller lesson
 * ranked below it.
 */
function protectedMine(mine: readonly WorkingEntry[], available: number): Set<WorkingEntry> {
  const kept = new Set<WorkingEntry>();
  let used = 0;
  for (const entry of mine) {
    if (kept.size === MINE_FLOOR) break;
    if (used + entry.tokens > available) continue;
    used += entry.tokens;
    kept.add(entry);
  }
  return kept;
}

interface WorkingEntry {
  id: string | number;
  tokens: number;
  seq?: number;
  data: Record<string, unknown>;
}

function toWorking(entry: RecallEntry): WorkingEntry {
  return {
    id: entry.id,
    tokens: estimateTokens(entry.renderedLine),
    ...(entry.seq !== undefined ? { seq: entry.seq } : {}),
    data: entry.data,
  };
}

function sumTokens(entries: readonly WorkingEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.tokens, 0);
}

/**
 * Cross-section id dedup (EC-04/EC-05, EC-17): iterates sections in
 * canonical order (`self, policies, shared, mine, last_session, conflicts`)
 * — only the sections actually active for this `bank` — and drops any id
 * already seen from a later section, strictly *before* caps are applied.
 */
function dedupeSections(
  bank: string,
  self: WorkingEntry[],
  policies: WorkingEntry[],
  shared: WorkingEntry[],
  mine: WorkingEntry[],
  lastSession: WorkingEntry[],
  conflicts: WorkingEntry[],
): {
  self: WorkingEntry[];
  policies: WorkingEntry[];
  shared: WorkingEntry[];
  mine: WorkingEntry[];
  lastSession: WorkingEntry[];
  conflicts: WorkingEntry[];
} {
  const isKb = bank === DEFAULT_BANK_ID;
  const seen = new Set<string>();

  function pass(entries: WorkingEntry[]): WorkingEntry[] {
    const kept: WorkingEntry[] = [];
    for (const entry of entries) {
      const key = String(entry.id);
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(entry);
    }
    return kept;
  }

  const dedupedSelf = isKb ? [] : pass(self);
  const dedupedPolicies = pass(policies);
  const dedupedShared = pass(shared);
  const dedupedMine = isKb ? [] : pass(mine);
  const dedupedLastSession = isKb ? [] : pass(lastSession);
  const dedupedConflicts = pass(conflicts);

  return {
    self: dedupedSelf,
    policies: dedupedPolicies,
    shared: dedupedShared,
    mine: dedupedMine,
    lastSession: dedupedLastSession,
    conflicts: dedupedConflicts,
  };
}

/**
 * Applies the trimming algorithm (AC2/AC3): visits `TRIM_PASSES` in sequence;
 * a section is entered (and added to `truncated`) as soon as `total` still
 * exceeds `maxTokens` when the loop reaches it — even if the section has no
 * entries to remove — because the algorithm is still "attempting" to trim it
 * to satisfy the budget (AC2's literal "every other section is trimmed to
 * empty and listed in truncated" when `SELF` alone exceeds the budget). The
 * one exception is the `MINE` floor pass, which only counts when it removes
 * something: a `MINE` wholly inside its floor was not cut.
 * Entries are removed one at a time (oldest-first for `last_session`,
 * otherwise from the tail — the lowest-ranked end of an already-ranked
 * array) until the section is empty or the budget fits.
 */
function trim(
  sections: Record<RecallSectionName, WorkingEntry[]>,
  selfTokens: number,
  maxTokens: number,
  activeOrder: RecallSectionName[],
): { truncated: RecallSectionName[]; usedTokens: number } {
  let total = selfTokens + activeOrder.reduce((sum, name) => sum + sumTokens(sections[name]), 0);
  const entered = new Set<RecallSectionName>();

  const protectedEntries = protectedMine(
    sections.mine,
    maxTokens - selfTokens - sumTokens(sections.policies),
  );

  for (const { name, floor } of TRIM_PASSES) {
    if (!activeOrder.includes(name)) continue;
    if (total <= maxTokens) break;
    const arr = sections[name];
    const isRemovable = (entry: WorkingEntry): boolean => !floor || !protectedEntries.has(entry);
    if (!floor || arr.some(isRemovable)) entered.add(name);
    while (total > maxTokens) {
      // `last_session` drops oldest first; the rest drop their lowest-ranked.
      const index = name === 'last_session' ? 0 : lastIndexWhere(arr, isRemovable);
      if (index === -1 || arr.length === 0) break;
      const [removed] = arr.splice(index, 1);
      if (removed === undefined) break;
      total -= removed.tokens;
    }
  }

  return { truncated: activeOrder.filter((name) => entered.has(name)), usedTokens: total };
}

function projectAll(entries: readonly WorkingEntry[]): Record<string, unknown>[] {
  return entries.map((entry) => entry.data);
}

/**
 * Assembles the recall bundle (spec §8.5, PRD FR-2.6/AC-2.6). Pure: given
 * identical inputs, returns byte-identical output on repeated calls, and
 * never mutates its inputs.
 */
export function assembleRecall(inputs: RecallInputs, budget: RecallBudget): RecallBundle {
  const isKb = inputs.bank === DEFAULT_BANK_ID;

  const selfWorking = inputs.self.map(toWorking);
  const policiesWorking = inputs.policies.map(toWorking);
  const sharedWorking = inputs.shared.map(toWorking);
  const mineWorking = inputs.mine.map(toWorking);
  const lastSessionWorking = inputs.lastSession.entries.map(toWorking);
  const conflictsWorking = inputs.conflicts.map(toWorking);

  const deduped = dedupeSections(
    inputs.bank,
    selfWorking,
    policiesWorking,
    sharedWorking,
    mineWorking,
    lastSessionWorking,
    conflictsWorking,
  );

  // Caps (spec §8.5): applied strictly after dedup (EC-17). `self`/`policies`
  // are uncapped; `last_session` keeps the most-recent (highest `seq`) 15 —
  // sorted ascending first so "most recent" and "oldest-first trimming"
  // share one consistent ordering (AC5, AC6, EC-14).
  const cappedShared = deduped.shared.slice(0, SHARED_CAP);
  const cappedMine = deduped.mine.slice(0, MINE_CAP);
  const sortedLastSession = [...deduped.lastSession].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const cappedLastSession =
    sortedLastSession.length > LAST_SESSION_CAP
      ? sortedLastSession.slice(sortedLastSession.length - LAST_SESSION_CAP)
      : sortedLastSession;
  const cappedConflicts = deduped.conflicts.slice(0, CONFLICTS_CAP);

  const sections: Record<RecallSectionName, WorkingEntry[]> = {
    policies: [...deduped.policies],
    shared: [...cappedShared],
    mine: [...cappedMine],
    last_session: [...cappedLastSession],
    conflicts: [...cappedConflicts],
  };

  const activeOrder = isKb
    ? TRIM_ORDER.filter((name) => name !== 'mine' && name !== 'last_session')
    : TRIM_ORDER;

  const selfTokens = sumTokens(deduped.self);
  const countsBeforeTrim = activeOrder.map((name) => [name, sections[name].length] as const);
  const { truncated, usedTokens } = trim(sections, selfTokens, budget.maxTokens, activeOrder);

  // `truncated` also names a section that had nothing to cut (AC2); `dropped`
  // says what was actually lost, so "no lessons" never reads as "lessons cut".
  const dropped: RecallBundle['dropped'] = {};
  for (const [name, before] of countsBeforeTrim) {
    const lost = before - sections[name].length;
    if (lost > 0) dropped[name] = lost;
  }

  return {
    query_id: inputs.queryId,
    bank: inputs.bank,
    budget: { max_tokens: budget.maxTokens, used_tokens: usedTokens },
    sections: {
      ...(isKb ? {} : { self: projectAll(deduped.self) }),
      policies: projectAll(sections.policies),
      shared: projectAll(sections.shared),
      ...(isKb ? {} : { mine: projectAll(sections.mine) }),
      ...(isKb
        ? {}
        : {
            last_session: {
              session_id: inputs.lastSession.sessionId,
              entries: projectAll(sections.last_session),
            },
          }),
      conflicts: projectAll(sections.conflicts),
    },
    truncated,
    dropped,
  };
}
