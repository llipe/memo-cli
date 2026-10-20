/**
 * Advisory-ignore expiry guard.
 *
 * `pnpm audit` is silenced for a handful of advisories via `auditConfig.ignoreGhsas`
 * in `pnpm-workspace.yaml`. Silencing is only acceptable while two things hold:
 * the ignore has been reviewed recently, and the installed version is still the
 * vulnerable one (i.e. no patched release exists to upgrade to). This test fails
 * loudly as soon as either stops being true so an ignore cannot be forgotten.
 *
 * This test intentionally reads the wall clock. Override it with
 * `ADVISORY_REVIEW_TODAY=YYYY-MM-DD` for deterministic runs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const REGISTRY_PATH = join(__dirname, 'advisory-ignores.json');
const WORKSPACE_PATH = join(ROOT, 'pnpm-workspace.yaml');
const LOCKFILE_PATH = join(ROOT, 'pnpm-lock.yaml');

/** Longest an ignore may go without someone re-checking for a patched release. */
export const MAX_REVIEW_WINDOW_DAYS = 30;

export interface AdvisoryIgnore {
  ghsa: string;
  package: string;
  /** Highest version still affected by the advisory (inclusive). */
  vulnerableUpTo: string;
  patchedVersions: string | null;
  exposure: string;
  reviewedOn: string;
  reviewBy: string;
  issue: string;
}

interface Registry {
  ignores: AdvisoryIgnore[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const GHSA_ID = /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

export function compareVersions(a: string, b: string): number {
  const pa = a.split('-')[0]!.split('.').map(Number);
  const pb = b.split('-')[0]!.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Every resolved version of `pkg` recorded in a pnpm v9 lockfile. */
export function installedVersions(lockfile: string, pkg: string): string[] {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const re = new RegExp(
    `^  '?${escaped}@(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)'?(?:\\(|:)`,
    'gm',
  );
  const versions = new Set<string>();
  for (const match of lockfile.matchAll(re)) versions.add(match[1]!);
  return [...versions].sort(compareVersions);
}

/** GHSA ids listed under `auditConfig.ignoreGhsas` in pnpm-workspace.yaml. */
export function ignoredGhsas(workspaceYaml: string): string[] {
  const ids = new Set<string>();
  for (const match of workspaceYaml.matchAll(
    /^\s*-\s*(GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4})\b/gm,
  )) {
    ids.add(match[1]!);
  }
  return [...ids].sort();
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

/**
 * Pure check. Returns a list of actionable problems (empty = ignore is still justified).
 */
export function evaluate(entry: AdvisoryIgnore, todayIso: string, installed: string[]): string[] {
  const problems: string[] = [];
  const where = `${entry.ghsa} (${entry.package})`;

  if (todayIso > entry.reviewBy) {
    problems.push(
      `${where}: review deadline ${entry.reviewBy} has passed (today ${todayIso}). ` +
        `Check for a patched release: \`npm view ${entry.package} versions\` and ` +
        `https://github.com/advisories/${entry.ghsa}. If one exists, upgrade (pnpm override if transitive) ` +
        `and remove the ignore from pnpm-workspace.yaml and tests/security/advisory-ignores.json. ` +
        `If still unpatched, re-review and move reviewedOn/reviewBy forward (max ${MAX_REVIEW_WINDOW_DAYS} days).`,
    );
  }

  if (installed.length === 0) {
    problems.push(
      `${where}: package is no longer in pnpm-lock.yaml. Remove the ignore from ` +
        `pnpm-workspace.yaml and tests/security/advisory-ignores.json.`,
    );
  } else if (installed.every((v) => compareVersions(v, entry.vulnerableUpTo) > 0)) {
    problems.push(
      `${where}: every installed version (${installed.join(', ')}) is above the vulnerable ` +
        `ceiling ${entry.vulnerableUpTo}, so the advisory no longer applies. Remove the ignore from ` +
        `pnpm-workspace.yaml and tests/security/advisory-ignores.json.`,
    );
  }

  return problems;
}

function todayIso(): string {
  const override = process.env['ADVISORY_REVIEW_TODAY'];
  if (override) {
    if (!ISO_DATE.test(override))
      throw new Error(`ADVISORY_REVIEW_TODAY must be YYYY-MM-DD, got "${override}"`);
    return override;
  }
  return new Date().toISOString().slice(0, 10);
}

const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as Registry;
const workspaceYaml = readFileSync(WORKSPACE_PATH, 'utf8');
const lockfile = readFileSync(LOCKFILE_PATH, 'utf8');

describe('advisory-ignores.json registry', () => {
  it('has at least the shape the guard relies on', () => {
    expect(Array.isArray(registry.ignores)).toBe(true);
  });

  it.each(registry.ignores)('$ghsa entry is well-formed', (entry) => {
    expect(entry.ghsa).toMatch(GHSA_ID);
    expect(entry.package.length).toBeGreaterThan(0);
    expect(entry.vulnerableUpTo).toMatch(SEMVER);
    expect(entry.exposure.length).toBeGreaterThan(20);
    expect(entry.issue).toMatch(/^https:\/\/github\.com\//);
    expect(entry.reviewedOn).toMatch(ISO_DATE);
    expect(entry.reviewBy).toMatch(ISO_DATE);
    expect(entry.reviewBy > entry.reviewedOn).toBe(true);
    expect(daysBetween(entry.reviewedOn, entry.reviewBy)).toBeLessThanOrEqual(
      MAX_REVIEW_WINDOW_DAYS,
    );
  });

  it('lists exactly the GHSAs ignored in pnpm-workspace.yaml', () => {
    const inRegistry = registry.ignores.map((e) => e.ghsa).sort();
    expect(inRegistry).toEqual(ignoredGhsas(workspaceYaml));
  });

  it('has no duplicate GHSA ids', () => {
    const ids = registry.ignores.map((e) => e.ghsa);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('evaluate()', () => {
  const base: AdvisoryIgnore = {
    ghsa: 'GHSA-aaaa-bbbb-cccc',
    package: 'example',
    vulnerableUpTo: '1.2.3',
    patchedVersions: null,
    exposure: 'test fixture, dev-only, no untrusted input reaches it',
    reviewedOn: '2026-01-01',
    reviewBy: '2026-01-15',
    issue: 'https://github.com/example/repo/issues/1',
  };

  it('is silent before the deadline while a vulnerable version is installed', () => {
    expect(evaluate(base, '2026-01-15', ['1.2.3'])).toEqual([]);
  });

  it('fails the day after the review deadline', () => {
    const problems = evaluate(base, '2026-01-16', ['1.2.3']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('review deadline 2026-01-15 has passed');
    expect(problems[0]).toContain('npm view example versions');
  });

  it('fails when every installed version is above the vulnerable ceiling', () => {
    const problems = evaluate(base, '2026-01-10', ['1.2.4']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('no longer applies');
  });

  it('keeps the ignore while any installed version is still vulnerable', () => {
    expect(evaluate(base, '2026-01-10', ['1.0.0', '1.2.4'])).toEqual([]);
  });

  it('fails when the package has left the lockfile', () => {
    const problems = evaluate(base, '2026-01-10', []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('no longer in pnpm-lock.yaml');
  });

  it('reports both problems when deadline passed and a patch is installed', () => {
    expect(evaluate(base, '2026-02-01', ['2.0.0'])).toHaveLength(2);
  });

  it('compares versions numerically, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('3.0.3', '3.0.3')).toBe(0);
    expect(compareVersions('1.1.3-beta.1', '1.1.3')).toBe(0);
  });
});

describe('lockfile and workspace parsing', () => {
  it('extracts resolved versions from pnpm v9 lockfile package and snapshot keys', () => {
    const sample = [
      'packages:',
      '  braces@3.0.3:',
      "  '@scope/pkg@2.0.0':",
      'snapshots:',
      '  braces@3.0.3: {}',
      "  '@scope/pkg@2.0.0(typescript@5.9.3)':",
      '  bracesx@9.9.9:',
    ].join('\n');
    expect(installedVersions(sample, 'braces')).toEqual(['3.0.3']);
    expect(installedVersions(sample, '@scope/pkg')).toEqual(['2.0.0']);
    expect(installedVersions(sample, 'missing')).toEqual([]);
  });

  it('reads ignoreGhsas list items and ignores trailing comments', () => {
    const sample =
      'auditConfig:\n  ignoreGhsas:\n    - GHSA-vfj7-8cjw-p6xm # braces\n    - GHSA-hp3w-g68c-fv3c\n';
    expect(ignoredGhsas(sample)).toEqual(['GHSA-hp3w-g68c-fv3c', 'GHSA-vfj7-8cjw-p6xm']);
  });
});

describe.each(registry.ignores)('ignored advisory $ghsa ($package)', (entry) => {
  const installed = installedVersions(lockfile, entry.package);

  it('still has the vulnerable package installed (otherwise the ignore is stale)', () => {
    expect(installed.length).toBeGreaterThan(0);
    expect(installed.some((v) => compareVersions(v, entry.vulnerableUpTo) <= 0)).toBe(true);
  });

  it(`has been re-reviewed on or before ${entry.reviewBy}`, () => {
    const problems = evaluate(entry, todayIso(), installed);
    expect(problems).toEqual([]);
  });
});
