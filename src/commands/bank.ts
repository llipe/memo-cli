import { Command } from 'commander';
import { loadConfig, writeConfig } from '../lib/config.js';
import { buildBaseFilter } from '../lib/filters.js';
import { aggregateField } from '../lib/facets.js';
import { createEmbeddingsAdapter } from '../lib/embeddings.js';
import { MemoError } from '../lib/errors.js';
import { output } from '../lib/output.js';
import { QdrantRepository } from '../lib/qdrant.js';
import type { QdrantFilter, ScrollResult } from '../lib/qdrant.js';
import type { FacetScrollFn } from '../lib/facets.js';
import { DEFAULT_BANK_ID, KebabOrUuid } from '../types/config.js';
import type { MemoConfig } from '../types/config.js';
import { handleWrite } from './write.js';
import type { WriteDeps, WriteFlags } from './write.js';

const SHOW_SCROLL_LIMIT = 10_000;

// ---------------------------------------------------------------------------
// Id validation (spec §18.10, decision A13)
// ---------------------------------------------------------------------------

/**
 * `init`'s id validator: `KebabOrUuid` first (so a case/shape failure and
 * the `kb` reserved-word rejection surface distinguishable messages,
 * §18.14 item EC-03/RT-04 — a caller can tell "this isn't a valid id" from
 * "this is a valid id but it's reserved") and only then the reserved-word
 * check. `list`/`show` never call this — `kb` is a legitimate value there
 * (it's the fallback corpus, not a bank a user creates), an intentional
 * asymmetry (§18.10 edge case).
 */
function validateInitBankId(id: string): void {
  const parsed = KebabOrUuid.safeParse(id);
  if (!parsed.success) {
    throw new MemoError(
      'VALIDATION_FAILED',
      `--id must be a kebab-case bank id or a UUID. Received "${id}".`,
    );
  }
  if (id === DEFAULT_BANK_ID) {
    throw new MemoError(
      'VALIDATION_FAILED',
      `--id cannot be "${DEFAULT_BANK_ID}" (reserved for the shared knowledge base).`,
    );
  }
}

function bankScopeFilter(bank: string): QdrantFilter {
  return bank === DEFAULT_BANK_ID
    ? {
        must: [
          {
            should: [
              { key: 'bank', match: { value: DEFAULT_BANK_ID } },
              { is_empty: { key: 'bank' } },
            ],
          },
        ],
      }
    : { must: [{ key: 'bank', match: { value: bank } }] };
}

// ---------------------------------------------------------------------------
// bank init
// ---------------------------------------------------------------------------

export interface BankInitFlags {
  id: string;
  rationale?: string;
  tags?: string;
  setDefault?: boolean;
  json?: boolean;
}

export interface BankInitDeps {
  loadCfg?: typeof loadConfig;
  writeConfig?: typeof writeConfig;
  createRepo?: (url?: string, key?: string) => QdrantRepository;
  createEmbeddings?: typeof createEmbeddingsAdapter;
  /** Delegate for the actual write (spec §18.10: "delegates to the write handler with fixed flags"). */
  write?: (flags: WriteFlags, deps?: WriteDeps) => Promise<void>;
}

/** Suppresses stdout for the duration of `fn` (used to swallow the delegated write's own output envelope). */
async function silentlyOnStdout<T>(fn: () => Promise<T>): Promise<T> {
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try {
    return await fn();
  } finally {
    process.stdout.write = original;
  }
}

export async function handleBankInit(flags: BankInitFlags, deps: BankInitDeps = {}): Promise<void> {
  const {
    loadCfg = loadConfig,
    writeConfig: writeConfigFn = writeConfig,
    createRepo = (url, key) => new QdrantRepository(url, key),
    createEmbeddings = createEmbeddingsAdapter,
    write = handleWrite,
  } = deps;

  validateInitBankId(flags.id);

  // `--set-default` validates config *before any Qdrant I/O at all* (spec
  // §18.10 edge case: "validate config first"): a missing/invalid
  // memo.config.json fails loud here, before even the existence check.
  let cfg: MemoConfig | undefined;
  if (flags.setDefault === true) {
    cfg = await loadCfg();
  }

  const qdrant = createRepo(process.env['QDRANT_URL'], process.env['QDRANT_API_KEY']);
  await qdrant.ensureCollection();

  const existingCount = await qdrant.count(bankScopeFilter(flags.id));

  let created: boolean;
  let selfId: string;

  if (existingCount > 0) {
    created = false;
    const selfFilter = buildBaseFilter({ bank: flags.id, kind: 'self' });
    const [existing] = await qdrant.scroll(selfFilter, 1);
    selfId = existing !== undefined ? String(existing.id) : '';
  } else {
    created = true;

    let capturedId: string | undefined;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- captured only for restoration below, never called unbound
    const originalUpsert = qdrant.upsert;
    const boundOriginalUpsert: typeof qdrant.upsert = qdrant.upsert.bind(qdrant);
    qdrant.upsert = async (id: string, vector: number[], payload: Record<string, unknown>) => {
      capturedId = id;
      return boundOriginalUpsert(id, vector, payload);
    };

    try {
      await silentlyOnStdout(() =>
        write(
          {
            rationale: flags.rationale ?? `Bank ${flags.id} initialised.`,
            tags: flags.tags ?? 'bank,self',
            bank: flags.id,
            kind: 'self',
            source: 'manual',
            entryType: 'structure',
            json: true,
          },
          { createRepo: () => qdrant, createEmbeddings },
        ),
      );
    } finally {
      qdrant.upsert = originalUpsert;
    }

    selfId = capturedId ?? '';
  }

  let defaultSet = false;
  if (flags.setDefault === true && cfg !== undefined) {
    await writeConfigFn({ ...cfg, bank: { default: flags.id } });
    defaultSet = true;
  }

  const resultData = {
    bank: flags.id,
    created,
    self_id: selfId,
    default_set: defaultSet,
  };

  if (flags.json) {
    output.result(resultData, { json: true });
    return;
  }

  const summary = created
    ? `Bank "${flags.id}" created (self entry ${selfId}).`
    : `Bank "${flags.id}" already exists (self entry ${selfId}).`;
  const lines = [summary];
  if (defaultSet) lines.push(`Set as default bank in memo.config.json.`);
  output.result(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// bank list
// ---------------------------------------------------------------------------

export interface BankListFlags {
  json?: boolean;
}

export interface BankListDeps {
  createRepo?: (url?: string, key?: string) => QdrantRepository;
  aggregate?: typeof aggregateField;
}

interface BankListEntry {
  bank: string;
  counts: { self: number; episodic: number; semantic: number };
  total: number;
}

export async function handleBankList(flags: BankListFlags, deps: BankListDeps = {}): Promise<void> {
  const { createRepo = (url, key) => new QdrantRepository(url, key), aggregate = aggregateField } =
    deps;

  const qdrant = createRepo(process.env['QDRANT_URL'], process.env['QDRANT_API_KEY']);
  await qdrant.ensureCollection();

  const scroll: FacetScrollFn = (f, limit) => qdrant.scroll(f, limit);
  const bankFacet = await aggregate('bank', scroll);
  const bankNames = new Set(bankFacet.map((b) => b.name));

  // v1 legacy points carry no `bank` field at all; fold them into `kb`
  // (spec §18.10) even when no point has an *explicit* `bank: 'kb'` value.
  const bankAbsentCount = await qdrant.count({ must: [{ is_empty: { key: 'bank' } }] });
  if (bankAbsentCount > 0) {
    bankNames.add(DEFAULT_BANK_ID);
  }

  const banks: BankListEntry[] = [];
  for (const name of Array.from(bankNames).sort((a, b) => a.localeCompare(b))) {
    const [self, episodic, semantic] = await Promise.all([
      qdrant.count(buildBaseFilter({ bank: name, kind: 'self' })),
      qdrant.count(buildBaseFilter({ bank: name, kind: 'episodic' })),
      qdrant.count(buildBaseFilter({ bank: name, kind: 'semantic' })),
    ]);
    const total = self + episodic + semantic;
    banks.push({ bank: name, counts: { self, episodic, semantic }, total });
  }

  if (flags.json) {
    output.result({ banks }, { json: true });
    return;
  }

  if (banks.length === 0) {
    output.result('No banks found.');
    return;
  }

  const lines: string[] = [`Banks (${String(banks.length)}):`];
  for (const b of banks) {
    lines.push(
      `  ${b.bank}  self=${String(b.counts.self)} episodic=${String(b.counts.episodic)} semantic=${String(b.counts.semantic)}  total=${String(b.total)}`,
    );
  }
  output.result(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// bank show
// ---------------------------------------------------------------------------

export interface BankShowFlags {
  id: string;
  json?: boolean;
}

export interface BankShowDeps {
  createRepo?: (url?: string, key?: string) => QdrantRepository;
}

type ShowKind = 'self' | 'episodic' | 'semantic';
type ShowState = 'active' | 'archived' | 'superseded';

interface StateCounts {
  active: number;
  archived: number;
  superseded: number;
}

interface SelfEntrySummary {
  id: string;
  rationale?: string;
  tags?: string[];
  timestamp_utc?: string;
}

function emptyStateCounts(): StateCounts {
  return { active: 0, archived: 0, superseded: 0 };
}

function stateOf(payload: Record<string, unknown>): ShowState {
  if (payload['superseded'] === true) return 'superseded';
  if (payload['archived'] === true) return 'archived';
  return 'active';
}

export async function handleBankShow(flags: BankShowFlags, deps: BankShowDeps = {}): Promise<void> {
  const { createRepo = (url, key) => new QdrantRepository(url, key) } = deps;

  const qdrant = createRepo(process.env['QDRANT_URL'], process.env['QDRANT_API_KEY']);
  await qdrant.ensureCollection();

  // Single scroll over the whole bank (all kinds, all states) - the counts
  // and the printed list are both derived from this one pass, avoiding a
  // 3x3 grid of remote `count()` calls for what's expected to be a modest
  // per-bank point count (spec §18.10).
  const allPoints: ScrollResult[] = await qdrant.scroll(
    bankScopeFilter(flags.id),
    SHOW_SCROLL_LIMIT,
  );

  const counts: Record<ShowKind, StateCounts> = {
    self: emptyStateCounts(),
    episodic: emptyStateCounts(),
    semantic: emptyStateCounts(),
  };

  const selfEntries: SelfEntrySummary[] = [];
  let lastSessionId: string | null = null;
  let lastSessionTimestamp: string | undefined;

  for (const point of allPoints) {
    const payload = point.payload ?? {};
    const kind = payload['kind'];
    if (kind !== 'self' && kind !== 'episodic' && kind !== 'semantic') continue;

    counts[kind][stateOf(payload)] += 1;

    if (kind === 'self' && payload['superseded'] !== true) {
      selfEntries.push({
        id: String(point.id),
        rationale: typeof payload['rationale'] === 'string' ? payload['rationale'] : undefined,
        tags: Array.isArray(payload['tags']) ? (payload['tags'] as string[]) : undefined,
        timestamp_utc:
          typeof payload['timestamp_utc'] === 'string' ? payload['timestamp_utc'] : undefined,
      });
    }

    if (
      kind === 'episodic' &&
      payload['archived'] !== true &&
      payload['superseded'] !== true &&
      typeof payload['session_id'] === 'string'
    ) {
      const ts = typeof payload['timestamp_utc'] === 'string' ? payload['timestamp_utc'] : '';
      if (lastSessionTimestamp === undefined || ts > lastSessionTimestamp) {
        lastSessionTimestamp = ts;
        lastSessionId = payload['session_id'];
      }
    }
  }

  // `qdrant.scroll` already orders desc by `timestamp_utc`; `selfEntries`
  // preserves that order (newest-first, AC5) since it's built by a single
  // forward pass over `allPoints`.

  const resultData = {
    bank: flags.id,
    entries: selfEntries,
    counts,
    last_session_id: lastSessionId,
  };

  if (flags.json) {
    output.result(resultData, { json: true });
    return;
  }

  if (allPoints.length === 0) {
    output.result(`Bank "${flags.id}" has no entries.`);
    return;
  }

  const lines: string[] = [`Bank "${flags.id}":`];
  if (selfEntries.length === 0) {
    lines.push('  (no active self entries)');
  } else {
    for (const e of selfEntries) {
      lines.push(`  ${e.id}  ${e.rationale ?? ''}`);
    }
  }
  lines.push('');
  lines.push(
    `  self:      active=${String(counts.self.active)} archived=${String(counts.self.archived)} superseded=${String(counts.self.superseded)}`,
  );
  lines.push(
    `  episodic:  active=${String(counts.episodic.active)} archived=${String(counts.episodic.archived)} superseded=${String(counts.episodic.superseded)}`,
  );
  lines.push(
    `  semantic:  active=${String(counts.semantic.active)} archived=${String(counts.semantic.archived)} superseded=${String(counts.semantic.superseded)}`,
  );
  lines.push(`  last_session_id: ${lastSessionId ?? '(none)'}`);
  output.result(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

const bankInit = new Command('init')
  .description('Create a bank by writing its first self entry (PRD B5)')
  .requiredOption('--id <id>', 'bank id (kebab-case or UUID)')
  .option('--rationale <text>', 'rationale for the self entry (default: "Bank <id> initialised.")')
  .option('--tags <csv>', 'comma-separated tags, 2-5 (default: "bank,self")')
  .option('--set-default', 'set this bank as config.bank.default')
  .option('--json', 'output as JSON')
  .action(async (opts: Record<string, unknown>) => {
    await handleBankInit({
      id: opts['id'] as string,
      rationale: opts['rationale'] as string | undefined,
      tags: opts['tags'] as string | undefined,
      setDefault: opts['setDefault'] as boolean | undefined,
      json: opts['json'] as boolean | undefined,
    });
  });

const bankList = new Command('list')
  .description('List every bank with counts per kind')
  .option('--json', 'output as JSON')
  .action(async (opts: Record<string, unknown>) => {
    await handleBankList({ json: opts['json'] as boolean | undefined });
  });

const bankShow = new Command('show')
  .description("Show a bank's self entries and counts per kind/state")
  .requiredOption('--id <id>', 'bank id')
  .option('--json', 'output as JSON')
  .action(async (opts: Record<string, unknown>) => {
    await handleBankShow({
      id: opts['id'] as string,
      json: opts['json'] as boolean | undefined,
    });
  });

const bank = new Command('bank').description('Manage memory banks (PRD B5)');
bank.addCommand(bankInit);
bank.addCommand(bankList);
bank.addCommand(bankShow);

export default bank;
