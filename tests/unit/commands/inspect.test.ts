import { handleInspect } from '../../../src/commands/inspect.js';
import type { InspectDeps } from '../../../src/commands/inspect.js';
import type { MultiFacetResult } from '../../../src/lib/facets.js';

const mockQdrant = {
  ensureCollection: jest.fn().mockResolvedValue(undefined),
  scroll: jest.fn().mockResolvedValue([]),
};

const fullFacets: MultiFacetResult = {
  orgs: [
    { name: 'llipe', count: 5 },
    { name: 'acme', count: 2 },
  ],
  repos: [
    { name: 'memo-cli', org: 'llipe', domain: 'developer-tools', count: 4 },
    { name: 'platform-docs', org: 'llipe', domain: 'developer-tools', count: 1 },
    { name: 'acme-api', org: 'acme', count: 2 },
  ],
  domains: [
    { name: 'developer-tools', count: 5 },
    { name: 'infra', count: 2 },
  ],
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
});

afterEach(() => {
  jest.restoreAllMocks();
});

function makeDeps(facets: MultiFacetResult = fullFacets): InspectDeps {
  return {
    createRepo: () => mockQdrant as unknown as ReturnType<NonNullable<InspectDeps['createRepo']>>,
    aggregate: jest.fn().mockResolvedValue(facets),
  };
}

describe('handleInspect', () => {
  describe('human output (no flags)', () => {
    it('shows all three sections', async () => {
      await handleInspect({}, makeDeps());

      expect(stdoutData).toContain('Organizations (2):');
      expect(stdoutData).toContain('Repositories (3):');
      expect(stdoutData).toContain('Domains (2):');
    });

    it('shows orgs with entry counts', async () => {
      await handleInspect({}, makeDeps());

      expect(stdoutData).toContain('llipe  (5 entries)');
      expect(stdoutData).toContain('acme  (2 entries)');
    });

    it('shows repos sorted alpha with domain annotation', async () => {
      await handleInspect({}, makeDeps());

      expect(stdoutData).toContain('acme-api');
      expect(stdoutData).toContain('memo-cli  [developer-tools]');
      expect(stdoutData).toContain('platform-docs  [developer-tools]');
      expect(stdoutData.indexOf('acme-api')).toBeLessThan(stdoutData.indexOf('memo-cli'));
    });

    it('shows repos without domain annotation when domain is absent', async () => {
      await handleInspect({}, makeDeps());

      expect(stdoutData).toContain('acme-api  (2 entries)');
      expect(stdoutData).not.toContain('acme-api  [');
    });

    it('shows domains with entry counts', async () => {
      await handleInspect({}, makeDeps());

      expect(stdoutData).toContain('developer-tools  (5 entries)');
      expect(stdoutData).toContain('infra  (2 entries)');
    });

    it('shows singular "entry" for count of 1', async () => {
      const facets: MultiFacetResult = {
        orgs: [{ name: 'solo', count: 1 }],
        repos: [],
        domains: [],
      };
      await handleInspect({}, makeDeps(facets));

      expect(stdoutData).toContain('solo  (1 entry)');
      expect(stdoutData).not.toContain('1 entries');
    });
  });

  describe('facet flag filtering', () => {
    it('--orgs shows only organizations section', async () => {
      await handleInspect({ orgs: true }, makeDeps());

      expect(stdoutData).toContain('Organizations (2):');
      expect(stdoutData).not.toContain('Repositories');
      expect(stdoutData).not.toContain('Domains');
    });

    it('--repos shows only repositories section', async () => {
      await handleInspect({ repos: true }, makeDeps());

      expect(stdoutData).toContain('Repositories (3):');
      expect(stdoutData).not.toContain('Organizations');
      expect(stdoutData).not.toContain('Domains');
    });

    it('--domains shows only domains section', async () => {
      await handleInspect({ domains: true }, makeDeps());

      expect(stdoutData).toContain('Domains (2):');
      expect(stdoutData).not.toContain('Organizations');
      expect(stdoutData).not.toContain('Repositories');
    });
  });

  describe('--json output', () => {
    it('outputs full JSON contract', async () => {
      await handleInspect({ json: true }, makeDeps());

      const result = JSON.parse(stdoutData) as Record<string, unknown>;
      expect(result['orgs']).toEqual([
        { name: 'acme', count: 2 },
        { name: 'llipe', count: 5 },
      ]);
      expect(Array.isArray(result['repos'])).toBe(true);
      const repos = result['repos'] as Array<Record<string, unknown>>;
      const memoCli = repos.find((r) => r['name'] === 'memo-cli');
      expect(memoCli).toEqual({
        name: 'memo-cli',
        org: 'llipe',
        domain: 'developer-tools',
        count: 4,
      });
      expect(result['domains']).toEqual([
        { name: 'developer-tools', count: 5 },
        { name: 'infra', count: 2 },
      ]);
    });

    it('--orgs --json outputs only orgs', async () => {
      await handleInspect({ orgs: true, json: true }, makeDeps());

      const result = JSON.parse(stdoutData) as Record<string, unknown>;
      expect(result['orgs']).toBeDefined();
      expect(result['repos']).toBeUndefined();
      expect(result['domains']).toBeUndefined();
    });

    it('--repos --json includes org and domain for repos', async () => {
      await handleInspect({ repos: true, json: true }, makeDeps());

      const result = JSON.parse(stdoutData) as Record<string, unknown>;
      expect(result['repos']).toBeDefined();
      expect(result['orgs']).toBeUndefined();
      const repos = result['repos'] as Array<Record<string, unknown>>;
      const memoCli = repos.find((r) => r['name'] === 'memo-cli');
      expect(memoCli?.['org']).toBe('llipe');
      expect(memoCli?.['domain']).toBe('developer-tools');
    });

    it('repos without org/domain do not include those keys in JSON', async () => {
      const facets: MultiFacetResult = {
        orgs: [],
        repos: [{ name: 'bare-repo', count: 1 }],
        domains: [],
      };
      await handleInspect({ repos: true, json: true }, makeDeps(facets));

      const result = JSON.parse(stdoutData) as Record<string, unknown>;
      const repos = result['repos'] as Array<Record<string, unknown>>;
      expect(repos[0]).toEqual({ name: 'bare-repo', count: 1 });
      expect(repos[0]?.['org']).toBeUndefined();
      expect(repos[0]?.['domain']).toBeUndefined();
    });
  });

  describe('empty result', () => {
    const emptyFacets: MultiFacetResult = { orgs: [], repos: [], domains: [] };

    it('outputs "No entries found." message', async () => {
      await handleInspect({}, makeDeps(emptyFacets));

      expect(stdoutData).toContain('No entries found.');
    });

    it('outputs "No entries found." even with facet flag', async () => {
      await handleInspect({ orgs: true }, makeDeps(emptyFacets));

      expect(stdoutData).toContain('No entries found.');
    });

    it('does not output JSON when empty', async () => {
      await handleInspect({ json: true }, makeDeps(emptyFacets));

      expect(stdoutData).toContain('No entries found.');
      expect(() => JSON.parse(stdoutData)).toThrow();
    });
  });

  describe('aggregate call', () => {
    it('calls aggregate with scroll function and no filter', async () => {
      const mockAggregate = jest.fn().mockResolvedValue(fullFacets);
      const deps: InspectDeps = {
        createRepo: () =>
          mockQdrant as unknown as ReturnType<NonNullable<InspectDeps['createRepo']>>,
        aggregate: mockAggregate,
      };

      await handleInspect({}, deps);

      expect(mockAggregate).toHaveBeenCalledWith(expect.any(Function));
    });
  });
});
