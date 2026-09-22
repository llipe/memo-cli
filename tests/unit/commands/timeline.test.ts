import { handleTimeline } from '../../../src/commands/timeline.js';
import type { TimelineDeps } from '../../../src/commands/timeline.js';
import { MemoError } from '../../../src/lib/errors.js';

const mockQdrant = {
  ensureCollection: jest.fn().mockResolvedValue(undefined),
  scroll: jest.fn().mockResolvedValue([]),
  scrollOrdered: jest.fn().mockResolvedValue([]),
};

let stdoutData = '';
let stderrData = '';

beforeEach(() => {
  stdoutData = '';
  stderrData = '';
  jest.spyOn(process.stdout, 'write').mockImplementation((data: any) => {
    stdoutData += String(data);
    return true;
  });
  jest.spyOn(process.stderr, 'write').mockImplementation((data: any) => {
    stderrData += String(data);
    return true;
  });
  jest.clearAllMocks();
  mockQdrant.scroll.mockResolvedValue([]);
  mockQdrant.scrollOrdered.mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function episodic(overrides: Record<string, unknown>): {
  id: string;
  payload: Record<string, unknown>;
} {
  return {
    id: overrides['id'] as string,
    payload: {
      kind: 'episodic',
      bank: 'x',
      session_id: 's-42',
      rationale: 'Some episodic rationale text.',
      timestamp_utc: '2026-04-10T14:25:02.431Z',
      ...overrides,
    },
  };
}

describe('handleTimeline', () => {
  const deps: TimelineDeps = {
    createRepo: () => mockQdrant as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  it('AC1: session shape sorts scrambled scrollOrdered output by seq asc, ignoring similarity', async () => {
    mockQdrant.scrollOrdered.mockResolvedValueOnce([
      episodic({ id: 'c', seq: 3, timestamp_utc: '2026-04-10T14:25:03.000Z' }),
      episodic({ id: 'a', seq: 1, timestamp_utc: '2026-04-10T14:25:01.000Z' }),
      episodic({ id: 'b', seq: 2, timestamp_utc: '2026-04-10T14:25:02.000Z' }),
    ]);

    await handleTimeline({ bank: 'x', session: 's-42', json: true }, deps);

    const parsed = JSON.parse(stdoutData);
    expect(parsed.entries.map((e: any) => e.id)).toEqual(['a', 'b', 'c']);
    expect(parsed.entries.every((e: any) => e.similarity === undefined)).toBe(true);
    expect(parsed.entries.every((e: any) => e.final_score === undefined)).toBe(true);
    expect(parsed.entries.every((e: any) => e.confidence_tier === undefined)).toBe(true);
  });

  it('AC1: calls scrollOrdered with seq asc order_by and the bank+session filter', async () => {
    await handleTimeline({ bank: 'x', session: 's-42', json: true }, deps);

    expect(mockQdrant.scrollOrdered).toHaveBeenCalledWith(
      {
        must: [
          { key: 'bank', match: { value: 'x' } },
          { key: 'kind', match: { value: 'episodic' } },
          { key: 'session_id', match: { value: 's-42' } },
        ],
        must_not: [
          { key: 'archived', match: { value: true } },
          { key: 'superseded', match: { value: true } },
        ],
      },
      { orderBy: { key: 'seq', direction: 'asc' }, limit: 50 },
    );
    expect(mockQdrant.scroll).not.toHaveBeenCalled();
  });

  it('AC2: no-session shape groups entries by session_id, preserving first-appearance order', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([
      episodic({ id: 'e1', session_id: 's-1', seq: 2, timestamp_utc: '2026-04-10T14:25:04.000Z' }),
      episodic({ id: 'e2', session_id: 's-2', seq: 1, timestamp_utc: '2026-04-10T14:25:03.000Z' }),
      episodic({ id: 'e3', session_id: 's-1', seq: 1, timestamp_utc: '2026-04-10T14:25:02.000Z' }),
    ]);

    await handleTimeline({ bank: 'x', json: true }, deps);

    const parsed = JSON.parse(stdoutData);
    expect(parsed.sessions).toEqual([
      {
        session_id: 's-1',
        entries: expect.arrayContaining([
          expect.objectContaining({ id: 'e1' }),
          expect.objectContaining({ id: 'e3' }),
        ]),
      },
      { session_id: 's-2', entries: [expect.objectContaining({ id: 'e2' })] },
    ]);
    expect(parsed.sessions[0].entries.map((e: any) => e.id)).toEqual(['e1', 'e3']);
    expect(parsed.count).toBe(3);
  });

  it('AC2: calls scroll (not scrollOrdered) with the bank filter and --last limit', async () => {
    await handleTimeline({ bank: 'x', last: '10', json: true }, deps);

    expect(mockQdrant.scroll).toHaveBeenCalledWith(
      {
        must: [
          { key: 'bank', match: { value: 'x' } },
          { key: 'kind', match: { value: 'episodic' } },
        ],
        must_not: [
          { key: 'archived', match: { value: true } },
          { key: 'superseded', match: { value: true } },
        ],
      },
      10,
    );
    expect(mockQdrant.scrollOrdered).not.toHaveBeenCalled();
  });

  it('AC3: --since adds a timestamp_utc lower bound to the filter (both shapes)', async () => {
    await handleTimeline({ bank: 'x', since: '2026-04-01', json: true }, deps);

    expect(mockQdrant.scroll).toHaveBeenCalledWith(
      expect.objectContaining({
        must: expect.arrayContaining([
          { key: 'timestamp_utc', range: { gte: '2026-04-01T00:00:00.000Z' } },
        ]),
      }),
      50,
    );

    await handleTimeline(
      { bank: 'x', session: 's-42', since: '2026-04-01T12:00:00.000Z', json: true },
      deps,
    );
    expect(mockQdrant.scrollOrdered).toHaveBeenCalledWith(
      expect.objectContaining({
        must: expect.arrayContaining([
          { key: 'timestamp_utc', range: { gte: '2026-04-01T12:00:00.000Z' } },
        ]),
      }),
      { orderBy: { key: 'seq', direction: 'asc' }, limit: 50 },
    );
  });

  it('AC3: invalid --since fails VALIDATION_FAILED without calling the repo', async () => {
    await expect(handleTimeline({ bank: 'x', since: 'not-a-date' }, deps)).rejects.toThrow(
      MemoError,
    );
    await expect(handleTimeline({ bank: 'x', since: 'not-a-date' }, deps)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(mockQdrant.scroll).not.toHaveBeenCalled();
    expect(mockQdrant.scrollOrdered).not.toHaveBeenCalled();
  });

  it('issue #98: a calendar-invalid --since date-only value (month 13, day 40) fails VALIDATION_FAILED', async () => {
    await expect(handleTimeline({ bank: 'x', since: '2026-13-40' }, deps)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(mockQdrant.scroll).not.toHaveBeenCalled();
    expect(mockQdrant.scrollOrdered).not.toHaveBeenCalled();
  });

  it('issue #98: a calendar-invalid --since date-only value (2025-02-30) fails VALIDATION_FAILED', async () => {
    await expect(handleTimeline({ bank: 'x', since: '2025-02-30' }, deps)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(mockQdrant.scroll).not.toHaveBeenCalled();
    expect(mockQdrant.scrollOrdered).not.toHaveBeenCalled();
  });

  it('issue #98: a valid --since date-only value is unaffected (unchanged behavior)', async () => {
    await handleTimeline({ bank: 'x', since: '2026-04-01', json: true }, deps);
    expect(mockQdrant.scroll).toHaveBeenCalledWith(
      expect.objectContaining({
        must: expect.arrayContaining([
          { key: 'timestamp_utc', range: { gte: '2026-04-01T00:00:00.000Z' } },
        ]),
      }),
      50,
    );
  });

  it('AC4: no createEmbeddings/rankResults call surface exists on the mocked repo (asserted by absence)', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([episodic({ id: 'e1' })]);
    await handleTimeline({ bank: 'x', json: true }, deps);
    // The mocked repo intentionally has no `search`/embeddings method - if
    // handleTimeline ever called one, this mock would throw "not a function".
    expect((mockQdrant as any).search).toBeUndefined();
  });

  it('AC5: empty bank returns exit-0 envelope with count 0 (grouped shape)', async () => {
    await handleTimeline({ bank: 'empty-bank', json: true }, deps);
    const parsed = JSON.parse(stdoutData);
    expect(parsed).toEqual({ bank: 'empty-bank', sessions: [], count: 0 });
  });

  it('AC5: empty session returns exit-0 envelope with count 0 (session shape)', async () => {
    await handleTimeline({ bank: 'x', session: 'ghost-session', json: true }, deps);
    const parsed = JSON.parse(stdoutData);
    expect(parsed).toEqual({ bank: 'x', session_id: 'ghost-session', entries: [], count: 0 });
  });

  it('AC6: human output renders one seq/timestamp/lead/id line per entry', async () => {
    mockQdrant.scrollOrdered.mockResolvedValueOnce([
      episodic({
        id: 'entry-a',
        seq: 1,
        timestamp_utc: '2026-04-10T14:25:01.000Z',
        rationale: 'First step taken.',
      }),
    ]);

    await handleTimeline({ bank: 'x', session: 's-42' }, deps);

    expect(stdoutData).toContain('1');
    expect(stdoutData).toContain('2026-04-10T14:25:01.000Z');
    expect(stdoutData).toContain('First step taken.');
    expect(stdoutData).toContain('entry-a');
  });

  it('AC2/AC6: no-session human output renders a session header per group, then one line per entry (output.timelineGrouped)', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([
      episodic({ id: 'e1', session_id: 's-1', seq: 1, timestamp_utc: '2026-04-10T14:25:01.000Z' }),
      episodic({ id: 'e2', session_id: 's-2', seq: 1, timestamp_utc: '2026-04-10T14:25:02.000Z' }),
    ]);

    await handleTimeline({ bank: 'x' }, deps);

    expect(stdoutData).toContain('session: s-1');
    expect(stdoutData).toContain('session: s-2');
    expect(stdoutData).toContain('e1');
    expect(stdoutData).toContain('e2');
  });

  it('AC5: no-session empty-result human output renders the zero-count message (output.timelineEmpty)', async () => {
    await handleTimeline({ bank: 'empty-bank' }, deps);

    expect(stdoutData).toContain('No entries found.');
    expect(stdoutData).toContain('count: 0');
  });

  it('EC-1: --last 0 fails VALIDATION_FAILED', async () => {
    await expect(handleTimeline({ bank: 'x', last: '0' }, deps)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(mockQdrant.scroll).not.toHaveBeenCalled();
  });

  it('EC-2: --last 501 clamps to 500 and warns on stderr only', async () => {
    await handleTimeline({ bank: 'x', last: '501', json: true }, deps);

    expect(mockQdrant.scroll).toHaveBeenCalledWith(expect.any(Object), 500);
    expect(stderrData.length).toBeGreaterThan(0);
    const parsed = JSON.parse(stdoutData);
    expect(parsed.warnings).toBeUndefined();
  });

  it('EC-3: --last 500 does not clamp or warn', async () => {
    await handleTimeline({ bank: 'x', last: '500', json: true }, deps);
    expect(mockQdrant.scroll).toHaveBeenCalledWith(expect.any(Object), 500);
    expect(stderrData).toBe('');
  });

  it('EC-4: equal seq values tie-break on timestamp_utc asc', async () => {
    mockQdrant.scrollOrdered.mockResolvedValueOnce([
      episodic({ id: 'later', seq: 4, timestamp_utc: '2026-04-10T14:25:05.000Z' }),
      episodic({ id: 'earlier', seq: 4, timestamp_utc: '2026-04-10T14:25:01.000Z' }),
    ]);

    await handleTimeline({ bank: 'x', session: 's-42', json: true }, deps);
    const parsed = JSON.parse(stdoutData);
    expect(parsed.entries.map((e: any) => e.id)).toEqual(['earlier', 'later']);
  });

  it('AC5 negative-space: no self/semantic entries ever pass the filter (kind pinned to episodic)', async () => {
    await handleTimeline({ bank: 'x', json: true }, deps);
    const call = mockQdrant.scroll.mock.calls[0][0];
    expect(call.must).toContainEqual({ key: 'kind', match: { value: 'episodic' } });
  });
});
