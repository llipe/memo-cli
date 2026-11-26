import type { Command } from 'commander';

function fixture(): { bank: Command; scroll: jest.Mock } {
  const scroll = jest.fn().mockResolvedValue([]);
  let bank: Command | undefined;
  jest.isolateModules(() => {
    jest.doMock('../../../src/lib/qdrant.js', () => ({
      ...jest.requireActual<object>('../../../src/lib/qdrant.js'),
      QdrantRepository: jest.fn().mockImplementation(() => ({
        ensureCollection: jest.fn().mockResolvedValue(undefined),
        scroll,
      })),
    }));
    bank = jest.requireActual<{ default: Command }>('../../../src/commands/bank.js').default;
    bank.exitOverride().configureOutput({ writeOut: () => {}, writeErr: () => {} });
    bank.commands
      .find((child) => child.name() === 'show')
      ?.exitOverride()
      .configureOutput({ writeOut: () => {}, writeErr: () => {} });
  });
  if (!bank) throw new Error('bank command not loaded');
  return { bank, scroll };
}

afterEach(() => {
  jest.dontMock('../../../src/lib/qdrant.js');
  jest.restoreAllMocks();
});

describe('memo bank show flags', () => {
  it.each(['--id', '--bank'])('routes %s to the same bank filter', async (flag) => {
    const { bank, scroll } = fixture();
    jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    await bank.parseAsync(['show', flag, 'my-bank', '--json'], { from: 'user' });
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(scroll.mock.calls[0])).toContain('"my-bank"');
  });

  it('does not start a query without either flag', async () => {
    const { bank, scroll } = fixture();
    await expect(bank.parseAsync(['show'], { from: 'user' })).rejects.toMatchObject({
      code: 'commander.missingMandatoryOptionValue',
    });
    expect(scroll).not.toHaveBeenCalled();
  });

  it('does not start a query if both flags are provided', async () => {
    const { bank, scroll } = fixture();
    await expect(
      bank.parseAsync(['show', '--id', 'first-bank', '--bank', 'other-bank'], { from: 'user' }),
    ).rejects.toMatchObject({ code: 'commander.conflictingOption' });
    expect(scroll).not.toHaveBeenCalled();
  });
});
