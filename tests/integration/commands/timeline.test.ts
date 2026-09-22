import { handleTimeline } from '../../../src/commands/timeline.js';
import type { TimelineDeps } from '../../../src/commands/timeline.js';

const mockQdrant = {
  ensureCollection: jest.fn().mockResolvedValue(undefined),
  scroll: jest.fn(),
  scrollOrdered: jest.fn(),
};

let stdoutData = '';

beforeEach(() => {
  stdoutData = '';
  jest.spyOn(process.stdout, 'write').mockImplementation((data: any) => {
    stdoutData += String(data);
    return true;
  });
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('timeline integration', () => {
  const deps: TimelineDeps = {
    createRepo: () => mockQdrant as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  it('replays three mocked episodic writes in seq order (AC1, AC-2.5)', async () => {
    // Simulates three `memo write --kind episodic --session ISSUE-42` calls
    // whose points come back from Qdrant in an arbitrary (non-seq) order.
    mockQdrant.scrollOrdered.mockResolvedValueOnce([
      {
        id: 'issue-42-3',
        payload: {
          kind: 'episodic',
          bank: 'agent-bank',
          session_id: 'ISSUE-42',
          seq: 3,
          rationale: 'Outcome: completed the story.',
          timestamp_utc: '2026-04-10T16:00:00.000Z',
        },
      },
      {
        id: 'issue-42-1',
        payload: {
          kind: 'episodic',
          bank: 'agent-bank',
          session_id: 'ISSUE-42',
          seq: 1,
          rationale: 'Intent: starting the story.',
          timestamp_utc: '2026-04-10T14:00:00.000Z',
        },
      },
      {
        id: 'issue-42-2',
        payload: {
          kind: 'episodic',
          bank: 'agent-bank',
          session_id: 'ISSUE-42',
          seq: 2,
          rationale: 'Mid-story checkpoint.',
          timestamp_utc: '2026-04-10T15:00:00.000Z',
        },
      },
    ]);

    await handleTimeline({ bank: 'agent-bank', session: 'ISSUE-42', json: true }, deps);

    const parsed = JSON.parse(stdoutData);
    expect(parsed.entries.map((e: any) => e.id)).toEqual([
      'issue-42-1',
      'issue-42-2',
      'issue-42-3',
    ]);
    expect(parsed.entries.map((e: any) => e.seq)).toEqual([1, 2, 3]);
    expect(parsed.count).toBe(3);
    expect(parsed.session_id).toBe('ISSUE-42');
    expect(mockQdrant.scroll).not.toHaveBeenCalled();
  });
});
