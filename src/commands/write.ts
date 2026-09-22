import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';
import { defaultKind, policyFor, resolveBank } from '../lib/bank.js';
import {
  buildDedupeKey,
  buildDedupeKeyV2,
  buildEmbedText,
  consolidate,
  sourceToConfidence,
  update,
} from '../lib/dedupe.js';
import { parseDuration, DAY_MS } from '../lib/duration.js';
import { normalizeEntry } from '../lib/entry-normalize.js';
import { createEmbeddingsAdapter } from '../lib/embeddings.js';
import { MemoError } from '../lib/errors.js';
import { output } from '../lib/output.js';
import type { QdrantFilter, ScrollResult } from '../lib/qdrant.js';
import { QdrantRepository } from '../lib/qdrant.js';
import {
  DEFAULT_BANK_ID,
  DEFAULT_KB_EPISODIC_POLICY,
  DEFAULT_KB_SEMANTIC_POLICY,
  DEFAULT_PRIVATE_EPISODIC_POLICY,
  DEFAULT_PRIVATE_SELF_SOFT_CAP,
  DEFAULT_PRIVATE_SEMANTIC_POLICY,
} from '../types/config.js';
import type { KindPolicy, MemoConfig, SelfPolicy } from '../types/config.js';
import { EntryPayloadV2Schema } from '../types/entry.js';
import type { EntryKind, EntryPayload, EntryPayloadV2 } from '../types/entry.js';

export type DuplicateAction = 'consolidate' | 'update' | 'replace' | 'create-new';

export interface WriteFlags {
  rationale: string;
  tags: string;
  repo?: string;
  org?: string;
  domain?: string;
  entryType?: string;
  source?: string;
  story?: string;
  commit?: string;
  files?: string;
  relatesTo?: string;
  onDuplicate?: string;
  json?: boolean;
  // Phase 2 (S2-04, issue #83, spec §18.6) — banks, kinds, sessions, supersede.
  bank?: string;
  kind?: string;
  session?: string;
  seq?: number;
  context?: string[];
  provenance?: string;
  manual?: boolean;
  supersedes?: string;
  pin?: boolean;
  expiresIn?: string;
}

export interface WriteDeps {
  loadCfg?: typeof loadConfig;
  createRepo?: (url?: string, key?: string) => QdrantRepository;
  createEmbeddings?: typeof createEmbeddingsAdapter;
  promptDuplicate?: (existing: EntryPayload) => Promise<DuplicateAction | null>;
}

async function defaultPromptDuplicate(): Promise<DuplicateAction | null> {
  if (!process.stdout.isTTY) return null;
  const { createInterface } = await import('node:readline');
  const actions: DuplicateAction[] = ['consolidate', 'update', 'replace', 'create-new'];
  let selected = 0;

  process.stdout.write('\n  Duplicate entry detected. Choose resolution:\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  const render = (): void => {
    actions.forEach((a, i) => {
      const marker = i === selected ? '▶ ' : '  ';
      process.stdout.write(`  ${marker}${a}\n`);
    });
  };

  render();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return new Promise((resolve) => {
    process.stdin.on('data', (key: string) => {
      if (key === '[A' && selected > 0) {
        process.stdout.moveCursor(0, -actions.length);
        selected--;
        render();
      } else if (key === '[B' && selected < actions.length - 1) {
        process.stdout.moveCursor(0, -actions.length);
        selected++;
        render();
      } else if (key === '\r' || key === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        rl.close();
        resolve(actions[selected] ?? null);
      } else if (key === '') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        rl.close();
        resolve(null);
      }
    });
  });
}

/**
 * A `MemoConfig` shaped just enough to satisfy `policyFor`/`resolveBank` when
 * no `memo.config.json` was found (spec §18.6 step 1 still needs a policy to
 * resolve retention fields even for an unconfigured private-bank write). Uses
 * the same `DEFAULT_*` constants `MemoConfigSchema` itself resolves to, so an
 * unconfigured write and a configured-with-defaults write behave identically.
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

function normalizeKind(flag: string | undefined): EntryKind | undefined {
  if (flag === undefined) return undefined;
  if (flag === 'self' || flag === 'episodic' || flag === 'semantic') return flag;
  throw new MemoError(
    'VALIDATION_FAILED',
    `--kind must be one of self, episodic, semantic. Received "${flag}".`,
  );
}

function parseCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return items.length > 0 ? items : undefined;
}

/**
 * `nextSeq` (spec §18.6 step 4, Technical Notes): `scrollOrdered` on
 * `{ bank, kind: 'episodic', session_id }` ordered `seq desc, limit 1`,
 * `+1` of the top result, `0` when the session has no prior entries.
 */
async function nextSeq(qdrant: QdrantRepository, bank: string, sessionId: string): Promise<number> {
  const filter: QdrantFilter = {
    must: [
      { key: 'bank', match: { value: bank } },
      { key: 'kind', match: { value: 'episodic' } },
      { key: 'session_id', match: { value: sessionId } },
    ],
  };
  const results = await qdrant.scrollOrdered(filter, {
    orderBy: { key: 'seq', direction: 'desc' },
    limit: 1,
  });
  const top = results[0]?.payload?.['seq'];
  return typeof top === 'number' ? top + 1 : 0;
}

export async function handleWrite(flags: WriteFlags, deps: WriteDeps = {}): Promise<void> {
  const {
    loadCfg = loadConfig,
    createRepo = (url, key) => new QdrantRepository(url, key),
    createEmbeddings = createEmbeddingsAdapter,
    promptDuplicate = defaultPromptDuplicate,
  } = deps;

  // Parse tags
  const tags = flags.tags
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  // Resolve context
  const cfg = await loadCfg().catch((err: unknown) => {
    if (
      err instanceof MemoError &&
      (err.code === 'CONFIG_NOT_FOUND' || err.code === 'CONFIG_INVALID')
    ) {
      return null;
    }
    throw err;
  });

  // §18.6 step 1: bank, kind, policy. Validates PRD K1 (self in kb) before any I/O.
  const bank = resolveBank(flags.bank, process.env, cfg ?? undefined);
  const kind = normalizeKind(flags.kind) ?? defaultKind(bank);
  const effectiveConfig = (cfg ?? fallbackConfig()) as unknown as MemoConfig;
  const policy = policyFor(effectiveConfig, bank, kind);

  // §18.6 step 2: scope. Required in `kb`, optional (used if given) elsewhere.
  const repo = flags.repo ?? cfg?.repo;
  const org = flags.org ?? cfg?.org;
  const domain = flags.domain ?? cfg?.domain;

  if (bank === DEFAULT_BANK_ID && !(repo && org && domain)) {
    throw new MemoError(
      'REPO_CONTEXT_UNRESOLVED',
      'Could not resolve repo context. Provide --repo, --org, and --domain or run `memo setup init`.',
    );
  }

  // §18.6 step 3: source/entry_type defaults. `--manual` wins over a conflicting `--source`.
  const source = (
    flags.manual === true ? 'manual' : (flags.source ?? cfg?.defaults.source ?? 'agent')
  ) as 'agent' | 'manual' | 'scan';
  const entry_type = (flags.entryType ?? (kind === 'episodic' ? 'observation' : 'decision')) as
    'decision' | 'integration_point' | 'structure' | 'policy' | 'observation';
  const confidence = sourceToConfidence(source);
  const now = new Date().toISOString();
  const id = randomUUID();

  const provenance = parseCsv(flags.provenance);
  const contexts =
    flags.context && flags.context.length > 0 ? Array.from(new Set(flags.context)) : undefined;

  // K3, checked before any I/O (spec §18.6 step 1's "before any I/O" principle):
  // agent-authored semantic entries need at least one provenance id unless --manual.
  if (
    kind === 'semantic' &&
    source === 'agent' &&
    (provenance === undefined || provenance.length === 0)
  ) {
    throw new MemoError(
      'VALIDATION_FAILED',
      'Entry validation failed:\n  • provenance: agent-authored "semantic" entries require at least one "provenance" id (K3)',
    );
  }

  // §18.14 item 3: a `--supersedes` self-reference is guarded before any I/O too
  // (unreachable via the CLI's own id generation, but defensive against a
  // crafted/injected id — F-3, EC-6).
  if (flags.supersedes !== undefined && flags.supersedes === id) {
    throw new MemoError(
      'VALIDATION_FAILED',
      `--supersedes cannot reference the entry's own id (${id}).`,
    );
  }

  // I/O begins here: Qdrant repository, embeddings adapter, collection bootstrap.
  const repo_url = process.env['QDRANT_URL'];
  const repo_key = process.env['QDRANT_API_KEY'];
  const qdrant = createRepo(repo_url, repo_key);
  const embeddings = createEmbeddings();

  await qdrant.ensureCollection();

  // §18.6 step 4: episodic-only fields (session, auto-seq, expires_at).
  let sessionId: string | undefined;
  let seq: number | undefined;
  let expiresAt: string | undefined;

  if (kind === 'episodic') {
    sessionId = flags.session;
    seq = flags.seq ?? (await nextSeq(qdrant, bank, sessionId ?? ''));

    const kindPolicy = policy as KindPolicy;
    const expiresInMs =
      flags.expiresIn !== undefined
        ? parseDuration(flags.expiresIn, '--expires-in')
        : (kindPolicy.expires_in_days ?? 0) * DAY_MS;
    expiresAt = new Date(Date.parse(now) + expiresInMs).toISOString();
  }

  // §18.5/A7: v2 dedupe key.
  const dedupe_key_sha256 = buildDedupeKeyV2({
    bank,
    kind,
    repo,
    commit: flags.commit,
    story: flags.story,
    session_id: sessionId,
    seq,
    entry_type,
    source,
  });

  // §18.6 step 4 (cont'd): full v2 payload build.
  const rawPayload: Record<string, unknown> = {
    id,
    schema_version: '2',
    bank,
    kind,
    repo,
    org,
    domain,
    rationale: flags.rationale,
    tags,
    entry_type,
    source,
    confidence,
    timestamp_utc: now,
    commit: flags.commit,
    story: flags.story,
    files_modified: parseCsv(flags.files),
    relates_to: parseCsv(flags.relatesTo),
    session_id: sessionId,
    seq,
    contexts,
    provenance,
    pinned: flags.pin === true,
    dedupe_key_sha256,
    dedupe_key_version: 'v2',
  };

  if (kind !== 'episodic') {
    rawPayload['valid_from'] = now;
  }
  if (kind === 'episodic') {
    rawPayload['expires_at'] = expiresAt;
  }
  if (kind !== 'self') {
    const kindPolicy = policy as KindPolicy;
    if (kindPolicy.initial_stability_days !== undefined) {
      rawPayload['stability'] = kindPolicy.initial_stability_days;
      rawPayload['stability_since'] = now;
    }
    rawPayload['retrieval_count'] = 0;
    rawPayload['used_count'] = 0;
  }

  // §18.6 step 5: validate.
  const parsed = EntryPayloadV2Schema.safeParse(rawPayload);
  if (!parsed.success) {
    const messages = parsed.error.errors
      .map((e) => `  • ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new MemoError('VALIDATION_FAILED', `Entry validation failed:\n${messages}`);
  }

  const payload: EntryPayloadV2 = parsed.data;

  // §18.6 step 6: `--supersedes` target validation.
  let supersedeTargetId: string | undefined;
  if (flags.supersedes !== undefined) {
    const target = await qdrant.getById(flags.supersedes);
    if (!target) {
      throw new MemoError('ENTRY_NOT_FOUND', `Entry not found: ${flags.supersedes}`);
    }

    const targetEntry = normalizeEntry(target.payload ?? {});
    if (targetEntry.bank !== bank || targetEntry.kind !== kind) {
      throw new MemoError(
        'VALIDATION_FAILED',
        `--supersedes target ${flags.supersedes} is bank=${targetEntry.bank}/kind=${targetEntry.kind}, ` +
          `but this write is bank=${bank}/kind=${kind}. A supersede target must match both.`,
      );
    }
    if (targetEntry.superseded) {
      throw new MemoError(
        'VALIDATION_FAILED',
        `--supersedes target ${flags.supersedes} is already superseded by ${String(
          targetEntry['superseded_by'],
        )}.`,
      );
    }

    supersedeTargetId = flags.supersedes;
  }

  // §18.6 step 7: `self` soft-cap warning. Never blocks. Pre-write count (§18.14 item 4).
  const warnings: string[] = [];
  if (kind === 'self') {
    const selfCountFilter: QdrantFilter = {
      must: [
        { key: 'bank', match: { value: bank } },
        { key: 'kind', match: { value: 'self' } },
        { key: 'superseded', match: { value: false } },
      ],
    };
    const selfCount = await qdrant.count(selfCountFilter);
    const softCap = (policy as SelfPolicy).soft_cap;
    if (selfCount >= softCap) {
      const message = `self entries in ${bank}: ${String(selfCount)} (soft cap ${String(softCap)})`;
      warnings.push(message);
      if (!flags.json) {
        process.stderr.write(chalk.yellow(message) + '\n');
      }
    }
  }

  // §18.6 step 8: dedupe (A7, §18.5). `self` never dedupes.
  let existing: ScrollResult | null = null;
  if (kind !== 'self') {
    existing = await qdrant.getByDedupeKey(dedupe_key_sha256);
    if (!existing && bank === DEFAULT_BANK_ID && kind === 'semantic' && repo !== undefined) {
      // AC10: a `kb` semantic write also checks the v1 key so a pre-migration
      // duplicate is detected.
      const v1Key = buildDedupeKey({
        repo,
        commit: flags.commit,
        story: flags.story,
        entry_type,
        source,
      });
      existing = await qdrant.getByDedupeKey(v1Key);
    }
  }

  let finalPayload: EntryPayloadV2 = payload;
  let created = true;
  let updated = false;
  let duplicate_detected = false;

  if (existing) {
    duplicate_detected = true;
    const existingPayload = existing.payload;

    let action: DuplicateAction | null = null;

    if (flags.onDuplicate) {
      const validActions: DuplicateAction[] = ['consolidate', 'update', 'replace', 'create-new'];
      if (!validActions.includes(flags.onDuplicate as DuplicateAction)) {
        throw new MemoError(
          'VALIDATION_FAILED',
          `Invalid --on-duplicate value "${flags.onDuplicate}". Valid values: consolidate, update, replace, create-new.`,
        );
      }
      action = flags.onDuplicate as DuplicateAction;
    } else if (flags.json) {
      output.error(
        'VALIDATION_FAILED',
        'Duplicate entry detected for repo+commit. Re-run with --on-duplicate consolidate|update|replace|create-new.',
        { json: true },
      );
      process.exit(1);
    } else {
      action = await promptDuplicate((existingPayload ?? payload) as unknown as EntryPayload);
      if (action === null) {
        output.info('Write cancelled.');
        return;
      }
    }

    // Existing v1 consolidate/update actions, unchanged (spec §18.6 step 5,
    // AC10): composed here rather than reimplemented, over the v2 shape.
    if (action === 'consolidate' && existingPayload) {
      finalPayload = consolidate(
        existingPayload as unknown as EntryPayload,
        payload as unknown as EntryPayload,
      ) as unknown as EntryPayloadV2;
      created = false;
      updated = true;
    } else if (action === 'update' && existingPayload) {
      finalPayload = update(
        existingPayload as unknown as EntryPayload,
        payload as unknown as EntryPayload,
      ) as unknown as EntryPayloadV2;
      created = false;
      updated = true;
    } else if (action === 'replace') {
      // New entry with new id but same dedupe key — treat as a new independent entry.
      finalPayload = { ...payload, id: randomUUID() };
      created = true;
    }
    // create-new: keep original payload with new uuid (already set above)
  }

  // §18.6 step 9: embed and upsert.
  const spinner = output.spinner('Embedding and storing entry…');
  spinner.start();

  try {
    const embedText = buildEmbedText(finalPayload.rationale, finalPayload.tags);
    const vector = await embeddings.embed(embedText);
    await qdrant.upsert(finalPayload.id, vector, finalPayload);
    spinner.succeed('Entry stored.');
  } catch (err) {
    spinner.fail('Failed to store entry.');
    throw err;
  }

  // §18.6 step 10: supersede target update. Not transactional — the new
  // entry is never rolled back if this fails (Business Rules).
  let supersededResultId: string | undefined;
  if (supersedeTargetId !== undefined) {
    try {
      await qdrant.setPayload(supersedeTargetId, {
        valid_to: now,
        superseded: true,
        superseded_by: finalPayload.id,
      });
      supersededResultId = supersedeTargetId;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new MemoError(
        'QDRANT_OPERATION_FAILED',
        `New entry ${finalPayload.id} was stored, but updating supersede target ${supersedeTargetId} failed: ${detail}. ` +
          `Re-run \`memo write --supersedes ${supersedeTargetId}\` (it will hit the "already superseded" guard if the payload did land) or repair the target by hand.`,
        2,
      );
    }
  }

  // §18.6 step 11: result. The stored payload's own `superseded` lifecycle
  // boolean (schema-defaulted `false`, meaningful for read-side filtering) is
  // a different signal than the envelope's optional `superseded?: <id>` —
  // this write's own supersede *outcome* (AC11, SC-13/CT-4: absent, not
  // `false`, when this write did not supersede anything). The stored point
  // sent to `qdrant.upsert` above already carries the correct boolean; only
  // the returned envelope substitutes/omits it.
  const { superseded: _storedSupersededFlag, ...payloadForEnvelope } = finalPayload;
  const resultData = {
    ...payloadForEnvelope,
    created,
    updated,
    duplicate_detected,
    ...(supersededResultId !== undefined ? { superseded: supersededResultId } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
  output.result(resultData, { json: flags.json });
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

function parseSeqFlag(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new MemoError('VALIDATION_FAILED', `--seq must be a number. Received "${value}".`);
  }
  return parsed;
}

const write = new Command('write')
  .description('Write a decision entry to the memo store')
  .requiredOption('-r, --rationale <text>', 'rationale text (required)')
  .requiredOption('-t, --tags <csv>', 'comma-separated tags (2–5, kebab-case, required)')
  .option('--repo <name>', 'repository name (overrides config)')
  .option('--org <name>', 'organization name (overrides config)')
  .option('--domain <name>', 'domain name (overrides config)')
  .option(
    '--entry-type <type>',
    'decision|integration_point|structure|policy|observation (default: decision, or observation for --kind episodic)',
  )
  .option('--source <source>', 'agent|manual|scan (default: agent)')
  .option('--story <story>', 'story identifier (optional)')
  .option('--commit <sha>', 'git commit SHA (optional)')
  .option('--files <csv>', 'comma-separated modified files (optional)')
  .option('--relates-to <csv>', 'comma-separated related repo names (optional)')
  .option(
    '--on-duplicate <action>',
    'consolidate|update|replace|create-new (skips interactive prompt)',
  )
  .option('--bank <id>', 'bank id (default: MEMO_BANK, config.bank.default, or "kb")')
  .option(
    '--kind <kind>',
    'self|episodic|semantic (default: episodic in private banks, semantic in kb)',
  )
  .option('--session <id>', 'session id (required for --kind episodic)')
  .option(
    '--seq <n>',
    'explicit episodic sequence number (default: auto-incremented)',
    parseSeqFlag,
  )
  .option('--context <ctx>', 'context tag (repeatable)', collect, [] as string[])
  .option('--provenance <csv>', 'comma-separated UUIDs of source episodic entries')
  .option('--manual', 'force source=manual')
  .option('--supersedes <id>', 'id of an existing entry this write supersedes')
  .option('--pin', 'pin the entry')
  .option('--expires-in <duration>', 'episodic expiry override, e.g. "2d", "12h", "30m"')
  .option('--json', 'output as JSON')
  .addHelpText(
    'after',
    '\nNote: --confidence is not a valid flag. Confidence is inferred from --source.',
  )
  .action(async (opts: Record<string, unknown>) => {
    if ('confidence' in opts) {
      throw new MemoError(
        'VALIDATION_FAILED',
        '--confidence is not a valid flag. Confidence is inferred from --source (agent→high, manual→medium).',
      );
    }
    await handleWrite({
      rationale: opts['rationale'] as string,
      tags: opts['tags'] as string,
      repo: opts['repo'] as string | undefined,
      org: opts['org'] as string | undefined,
      domain: opts['domain'] as string | undefined,
      entryType: opts['entryType'] as string | undefined,
      source: opts['source'] as string | undefined,
      story: opts['story'] as string | undefined,
      commit: opts['commit'] as string | undefined,
      files: opts['files'] as string | undefined,
      relatesTo: opts['relatesTo'] as string | undefined,
      onDuplicate: opts['onDuplicate'] as string | undefined,
      bank: opts['bank'] as string | undefined,
      kind: opts['kind'] as string | undefined,
      session: opts['session'] as string | undefined,
      seq: opts['seq'] as number | undefined,
      context: opts['context'] as string[] | undefined,
      provenance: opts['provenance'] as string | undefined,
      manual: opts['manual'] as boolean | undefined,
      supersedes: opts['supersedes'] as string | undefined,
      pin: opts['pin'] as boolean | undefined,
      expiresIn: opts['expiresIn'] as string | undefined,
      json: opts['json'] as boolean | undefined,
    });
  });

export default write;
