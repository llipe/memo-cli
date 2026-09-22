import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { loadConfig } from '../lib/config.js';
import { MemoError } from '../lib/errors.js';
import { DEFAULT_MIGRATION_RULES, parseMigrationRules, planMigration } from '../lib/migrate.js';
import type { MigrationRule } from '../lib/migrate.js';
import { output } from '../lib/output.js';
import { QdrantRepository } from '../lib/qdrant.js';
import type { QdrantFilter, ScrollResult } from '../lib/qdrant.js';
import {
  DEFAULT_KB_EPISODIC_POLICY,
  DEFAULT_KB_SEMANTIC_POLICY,
  DEFAULT_PRIVATE_EPISODIC_POLICY,
  DEFAULT_PRIVATE_SELF_SOFT_CAP,
  DEFAULT_PRIVATE_SEMANTIC_POLICY,
} from '../types/config.js';
import type { MemoConfig } from '../types/config.js';

/**
 * `memo migrate --to-v2` (spec §5.5, §18.11; PRD FR-2.8, AC-2.7; issue #88 /
 * Story S2-09). Thin command wrapper over the pure `planMigration` planner
 * (`src/lib/migrate.ts`): scan every point lacking `schema_version` via
 * `scrollAll` (batch 256), plan each page, and - unless `--dry-run` - issue
 * one `batchSetPayload` per non-empty page. Never archives, deletes, or
 * re-embeds anything (Business Rules); no vector is ever read or sent.
 */
export interface MigrateFlags {
  toV2?: boolean;
  dryRun?: boolean;
  rules?: string;
  json?: boolean;
}

export interface MigrateDeps {
  createRepo?: (url?: string, key?: string) => QdrantRepository;
  loadCfg?: typeof loadConfig;
  readRulesFile?: (path: string) => Promise<string>;
  now?: () => string;
}

export interface MigrateResult {
  scanned: number;
  migrated: number;
  skipped: number;
  by_rule: Record<string, number>;
  dry_run: boolean;
}

/**
 * A `MemoConfig` shaped just enough to satisfy `policyFor` when no
 * `memo.config.json` is found - mirrors `write.ts`'s `fallbackConfig()`
 * (same `DEFAULT_*` constants `MemoConfigSchema` itself resolves to), so an
 * unconfigured migration run and a configured-with-defaults run compute the
 * same `stability`/`expires_in_days` values.
 */
function fallbackConfig(): Pick<MemoConfig, 'banks'> {
  return {
    banks: {
      kb: { episodic: DEFAULT_KB_EPISODIC_POLICY, semantic: DEFAULT_KB_SEMANTIC_POLICY },
      private: {
        self: { soft_cap: DEFAULT_PRIVATE_SELF_SOFT_CAP },
        episodic: DEFAULT_PRIVATE_EPISODIC_POLICY,
        semantic: DEFAULT_PRIVATE_SEMANTIC_POLICY,
      },
    },
  };
}

/** `must: [{ is_empty: { key: 'schema_version' } }]` (spec §18.11's `filterLacking`). */
const UNMIGRATED_FILTER: QdrantFilter = { must: [{ is_empty: { key: 'schema_version' } }] };

/**
 * Loads and validates `--rules <file>` (AC4), or the default FR-2.8 rules
 * when `--rules` is absent. Runs entirely before any Qdrant I/O (CT-6): a
 * missing file, invalid JSON, an invalid rule shape, or a non-exhaustive
 * rule set all throw `VALIDATION_FAILED` here, before `scrollAll` is ever
 * called.
 */
async function resolveRules(
  rulesPath: string | undefined,
  readRulesFile: (path: string) => Promise<string>,
): Promise<MigrationRule[]> {
  if (rulesPath === undefined) return DEFAULT_MIGRATION_RULES;

  let raw: string;
  try {
    raw = await readRulesFile(rulesPath);
  } catch (err) {
    throw new MemoError(
      'VALIDATION_FAILED',
      `Could not read --rules file "${rulesPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new MemoError('VALIDATION_FAILED', `--rules file "${rulesPath}" is not valid JSON.`);
  }

  return parseMigrationRules(parsed);
}

export async function handleMigrate(flags: MigrateFlags, deps: MigrateDeps = {}): Promise<void> {
  const {
    createRepo = (url, key) => new QdrantRepository(url, key),
    loadCfg = loadConfig,
    readRulesFile = (path: string) => readFile(path, 'utf-8'),
    now = () => new Date().toISOString(),
  } = deps;

  if (flags.toV2 !== true) {
    throw new MemoError('VALIDATION_FAILED', '`memo migrate` currently requires `--to-v2`.');
  }

  // Rules first (AC4 "before any scan") — zero `scrollAll` calls on failure.
  const rules = await resolveRules(flags.rules, readRulesFile);

  const cfg = await loadCfg().catch((err: unknown) => {
    if (
      err instanceof MemoError &&
      (err.code === 'CONFIG_NOT_FOUND' || err.code === 'CONFIG_INVALID')
    ) {
      return null;
    }
    throw err;
  });
  const policies = (cfg ?? fallbackConfig()) as unknown as MemoConfig;

  const qdrant = createRepo(process.env['QDRANT_URL'], process.env['QDRANT_API_KEY']);
  await qdrant.ensureCollection();

  const dryRun = flags.dryRun === true;
  const isJson = flags.json === true;
  const nowIso = now();

  let scanned = 0;
  let migrated = 0;
  let skipped = 0;
  const byRule: Record<string, number> = {};
  let pageNumber = 0;

  await qdrant.scrollAll(UNMIGRATED_FILTER, { batch: 256 }, async (page: ScrollResult[]) => {
    pageNumber++;
    scanned += page.length;

    const plan = planMigration(page, nowIso, rules, policies);
    migrated += plan.ops.length;
    skipped += plan.skipped;
    for (const [name, count] of Object.entries(plan.byRule)) {
      byRule[name] = (byRule[name] ?? 0) + count;
    }

    if (!dryRun && plan.ops.length > 0) {
      await qdrant.batchSetPayload(plan.ops);
    }

    if (!isJson) {
      process.stderr.write(
        `migrate: page ${String(pageNumber)} — scanned ${String(page.length)} (${dryRun ? 'dry-run, ' : ''}running totals: scanned=${String(scanned)}, migrated=${String(migrated)}, skipped=${String(skipped)})\n`,
      );
    }
  });

  const result: MigrateResult = { scanned, migrated, skipped, by_rule: byRule, dry_run: dryRun };

  if (isJson) {
    output.result(result, { json: true });
    return;
  }

  output.result(
    [
      `Migration ${dryRun ? '(dry-run) ' : ''}summary:`,
      `  scanned:  ${String(result.scanned)}`,
      `  migrated: ${String(result.migrated)}`,
      `  skipped:  ${String(result.skipped)}`,
      `  by_rule:  ${JSON.stringify(result.by_rule)}`,
    ].join('\n'),
  );
}

const migrate = new Command('migrate')
  .description('Migrate legacy v1 payloads to schema v2, idempotently (spec §5.5, §18.11)')
  .option('--to-v2', 'target schema version — currently the only supported target (required)')
  .option('--dry-run', 'plan only; write nothing; exit 0')
  .option('--rules <file>', 'JSON file replacing the default FR-2.8 rule set')
  .option('--json', 'output as JSON')
  .action(async (opts: Record<string, unknown>) => {
    await handleMigrate({
      toV2: opts['toV2'] as boolean | undefined,
      dryRun: opts['dryRun'] as boolean | undefined,
      rules: opts['rules'] as string | undefined,
      json: opts['json'] as boolean | undefined,
    });
  });

export default migrate;
