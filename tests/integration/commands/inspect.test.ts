import { handleInspect } from '../../../src/commands/inspect.js';
import type { InspectDeps } from '../../../src/commands/inspect.js';

const mockQdrant = {
  ensureCollection: jest.fn().mockResolvedValue(undefined),
  scroll: jest.fn(),
};

let stdoutData = '';

beforeEach(() => {
  stdoutData = '';
  jest.spyOn(process.stdout, 'write').mockImplementation((data: unknown) => {
    stdoutData += String(data);
    return true;
  });
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  jest.clearAllMocks();
  mockQdrant.scroll.mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const deps: InspectDeps = {
  createRepo: () => mockQdrant as unknown as ReturnType<NonNullable<InspectDeps['createRepo']>>,
};

describe('inspect integration', () => {
  it('aggregates org, repo, and domain in a single scroll pass', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([
      { id: '1', payload: { org: 'llipe', repo: 'memo-cli', domain: 'developer-tools' } },
      { id: '2', payload: { org: 'llipe', repo: 'memo-cli', domain: 'developer-tools' } },
      { id: '3', payload: { org: 'llipe', repo: 'platform-docs', domain: 'developer-tools' } },
      { id: '4', payload: { org: 'acme', repo: 'acme-api', domain: 'infra' } },
    ]);

    await handleInspect({}, deps);

    expect(mockQdrant.scroll).toHaveBeenCalledTimes(1);
    expect(stdoutData).toContain('Organizations (2):');
    expect(stdoutData).toContain('Repositories (3):');
    expect(stdoutData).toContain('Domains (2):');
  });

  it('returns JSON contract with counts from real scroll data', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([
      { id: '1', payload: { org: 'llipe', repo: 'memo-cli', domain: 'developer-tools' } },
      { id: '2', payload: { org: 'llipe', repo: 'memo-cli', domain: 'developer-tools' } },
      { id: '3', payload: { org: 'acme', repo: 'acme-api', domain: 'infra' } },
    ]);

    await handleInspect({ json: true }, deps);

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    const orgs = result['orgs'] as Array<{ name: string; count: number }>;
    const repos = result['repos'] as Array<{
      name: string;
      org?: string;
      domain?: string;
      count: number;
    }>;
    const domains = result['domains'] as Array<{ name: string; count: number }>;

    expect(orgs.find((o) => o.name === 'llipe')?.count).toBe(2);
    expect(orgs.find((o) => o.name === 'acme')?.count).toBe(1);

    const memoCli = repos.find((r) => r.name === 'memo-cli');
    expect(memoCli?.count).toBe(2);
    expect(memoCli?.org).toBe('llipe');
    expect(memoCli?.domain).toBe('developer-tools');

    expect(domains.find((d) => d.name === 'developer-tools')?.count).toBe(2);
    expect(domains.find((d) => d.name === 'infra')?.count).toBe(1);
  });

  it('filters to orgs only with --orgs flag', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([
      { id: '1', payload: { org: 'llipe', repo: 'memo-cli', domain: 'developer-tools' } },
    ]);

    await handleInspect({ orgs: true }, deps);

    expect(stdoutData).toContain('Organizations (1):');
    expect(stdoutData).toContain('llipe  (1 entry)');
    expect(stdoutData).not.toContain('Repositories');
    expect(stdoutData).not.toContain('Domains');
  });

  it('filters to repos only with --repos flag', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([
      { id: '1', payload: { org: 'llipe', repo: 'memo-cli', domain: 'developer-tools' } },
    ]);

    await handleInspect({ repos: true }, deps);

    expect(stdoutData).toContain('Repositories (1):');
    expect(stdoutData).toContain('memo-cli  [developer-tools]');
    expect(stdoutData).not.toContain('Organizations');
    expect(stdoutData).not.toContain('Domains');
  });

  it('filters to domains only with --domains flag', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([
      { id: '1', payload: { org: 'llipe', repo: 'memo-cli', domain: 'developer-tools' } },
    ]);

    await handleInspect({ domains: true }, deps);

    expect(stdoutData).toContain('Domains (1):');
    expect(stdoutData).toContain('developer-tools  (1 entry)');
    expect(stdoutData).not.toContain('Organizations');
    expect(stdoutData).not.toContain('Repositories');
  });

  it('outputs --orgs --json with only orgs key', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([
      { id: '1', payload: { org: 'llipe', repo: 'memo-cli', domain: 'developer-tools' } },
    ]);

    await handleInspect({ orgs: true, json: true }, deps);

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(result['orgs']).toBeDefined();
    expect(result['repos']).toBeUndefined();
    expect(result['domains']).toBeUndefined();
  });

  it('outputs "No entries found." for empty collection', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([]);

    await handleInspect({}, deps);

    expect(stdoutData).toContain('No entries found.');
  });

  it('handles entries missing some fields gracefully', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([
      { id: '1', payload: { repo: 'memo-cli' } },
      { id: '2', payload: { org: 'llipe', domain: 'developer-tools' } },
      { id: '3', payload: {} },
    ]);

    await handleInspect({}, deps);

    expect(stdoutData).toContain('Organizations (1):');
    expect(stdoutData).toContain('Repositories (1):');
    expect(stdoutData).toContain('Domains (1):');
  });

  it('scroll is called with no filter (global view)', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([]);

    await handleInspect({}, deps);

    expect(mockQdrant.scroll).toHaveBeenCalledWith(undefined, 10_000);
  });
});
