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
});
