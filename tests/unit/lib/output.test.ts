import { output } from '../../../src/lib/output';

describe('output', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    delete process.env['NO_COLOR'];
  });

  describe('result()', () => {
    it('writes JSON to stdout with no ANSI when json=true', () => {
      output.result({ foo: 'bar' }, { json: true });
      const written = String(stdoutSpy.mock.calls[0]?.[0]);
      expect(written).toContain('"foo": "bar"');
      expect(written).not.toMatch(/\x1b\[/);
    });

    it('writes string directly when json=false', () => {
      output.result('hello world');
      const written = String(stdoutSpy.mock.calls[0]?.[0]);
      expect(written).toContain('hello world');
    });

    it('pretty prints object when json=false', () => {
      output.result({ key: 'value' });
      const written = String(stdoutSpy.mock.calls[0]?.[0]);
      expect(written).toContain('key');
      expect(written).toContain('value');
    });
  });

  describe('error()', () => {
    it('writes JSON error object to stderr with no ANSI when json=true', () => {
      output.error('MY_CODE', 'some error', { json: true });
      const written = String(stderrSpy.mock.calls[0]?.[0]);
      const parsed = JSON.parse(written) as { error: string; code: string };
      expect(parsed.error).toBe('some error');
      expect(parsed.code).toBe('MY_CODE');
      expect(written).not.toMatch(/\x1b\[/);
    });

    it('writes plain text to stderr when json=false', () => {
      output.error('MY_CODE', 'some error');
      const written = String(stderrSpy.mock.calls[0]?.[0]);
      expect(written).toContain('MY_CODE');
      expect(written).toContain('some error');
    });
  });

  describe('info()', () => {
    it('writes to stdout with info prefix', () => {
      output.info('test message');
      const written = String(stdoutSpy.mock.calls[0]?.[0]);
      expect(written).toContain('info');
      expect(written).toContain('test message');
    });
  });

  describe('warn()', () => {
    it('writes to stdout with warn prefix', () => {
      output.warn('test warning');
      const written = String(stdoutSpy.mock.calls[0]?.[0]);
      expect(written).toContain('warn');
      expect(written).toContain('test warning');
    });
  });

  describe('NO_COLOR env var', () => {
    it('output does not contain ANSI codes when NO_COLOR is set', () => {
      process.env['NO_COLOR'] = '1';
      output.info('hello');
      const written = String(stdoutSpy.mock.calls[0]?.[0]);
      expect(written).not.toMatch(/\x1b\[/);
    });
  });

  // Issue #34 (D6, AC6): the human-output percentage now renders the caller's
  // composite score. `searchResults` itself is score-source agnostic - the
  // caller (`search.ts`) is responsible for passing `final_score` into the
  // `similarity` field - so these tests assert the rendering contract, not
  // ranking math (that belongs to `ranking.test.ts`).
  describe('searchResults()', () => {
    it('renders the passed-in score as a rounded percentage, not a separate raw value', () => {
      output.searchResults([
        { id: '1', similarity: 0.72, repo: 'memo-cli', rationale: 'An old but relevant decision' },
      ]);
      const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(written).toContain('72%');
      expect(written).not.toContain('91%');
    });

    it('keeps the repo label, then the score, then the rationale lead in order', () => {
      output.searchResults([
        { id: '1', similarity: 0.5, repo: 'my-service', rationale: 'lead text' },
      ]);
      const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      const repoIdx = written.indexOf('my-service');
      const scoreIdx = written.indexOf('50%');
      const leadIdx = written.indexOf('lead text');
      expect(repoIdx).toBeGreaterThanOrEqual(0);
      expect(repoIdx).toBeLessThan(scoreIdx);
      expect(scoreIdx).toBeLessThan(leadIdx);
    });

    // #35 AC5: the `[tier]` prefix, always present as an explicit text
    // label even with color disabled (guidelines §4).
    it('prefixes each result with [tier] when confidenceTier is present (AC5)', () => {
      output.searchResults([
        {
          id: '1',
          similarity: 0.9,
          repo: 'memo-cli',
          rationale: 'lead text',
          confidenceTier: 'exact',
        },
      ]);
      const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(written).toContain('[exact]');
    });

    it('renders every documented tier label', () => {
      output.searchResults([
        { id: '1', similarity: 0.9, rationale: 'a', confidenceTier: 'exact' },
        { id: '2', similarity: 0.8, rationale: 'b', confidenceTier: 'high' },
        { id: '3', similarity: 0.65, rationale: 'c', confidenceTier: 'medium' },
        { id: '4', similarity: 0.2, rationale: 'd', confidenceTier: 'low' },
      ]);
      const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(written).toContain('[exact]');
      expect(written).toContain('[high]');
      expect(written).toContain('[medium]');
      expect(written).toContain('[low]');
    });

    it('omits the [tier] prefix entirely when confidenceTier is absent (backward compatible)', () => {
      output.searchResults([{ id: '1', similarity: 0.9, repo: 'memo-cli', rationale: 'lead' }]);
      const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(written).not.toMatch(/\[(exact|high|medium|low)\]/);
    });

    it('keeps the text label readable with NO_COLOR set (no ANSI escape codes)', () => {
      process.env['NO_COLOR'] = '1';
      output.searchResults([
        { id: '1', similarity: 0.9, repo: 'memo-cli', rationale: 'lead', confidenceTier: 'exact' },
      ]);
      const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(written).toContain('[exact]');
      expect(written).not.toMatch(/\x1b\[/);
    });

    // #38 AC7: the staleness warning renders inline under the flagged result.
    it('renders the STALE warning with the superseder id when stale is true (AC7)', () => {
      output.searchResults([
        {
          id: '1',
          similarity: 0.7,
          repo: 'memo-cli',
          rationale: 'An old decision',
          stale: true,
          staleBy: 'newer-entry-id',
        },
      ]);
      const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(written).toContain('⚠ STALE');
      expect(written).toContain('superseded by newer-entry-id');
    });

    it('places the STALE warning under the flagged result, after its main line', () => {
      output.searchResults([
        {
          id: '1',
          similarity: 0.7,
          repo: 'memo-cli',
          rationale: 'An old decision',
          stale: true,
          staleBy: 'newer-entry-id',
        },
      ]);
      const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      const mainLineIdx = written.indexOf('An old decision');
      const staleIdx = written.indexOf('⚠ STALE');
      expect(mainLineIdx).toBeGreaterThanOrEqual(0);
      expect(staleIdx).toBeGreaterThan(mainLineIdx);
    });

    it('omits the STALE warning entirely when stale is absent (backward compatible)', () => {
      output.searchResults([
        { id: '1', similarity: 0.7, repo: 'memo-cli', rationale: 'A fresh decision' },
      ]);
      const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(written).not.toContain('STALE');
    });

    it('omits the STALE warning when stale is false', () => {
      output.searchResults([
        {
          id: '1',
          similarity: 0.7,
          repo: 'memo-cli',
          rationale: 'A fresh decision',
          stale: false,
        },
      ]);
      const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(written).not.toContain('STALE');
    });
  });
});
