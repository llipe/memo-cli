import { aggregateField } from '../../../src/lib/facets.js';
import type { FacetScrollFn } from '../../../src/lib/facets.js';

describe('aggregateField', () => {
  it('aggregates string payload values with counts', async () => {
    const scroll: FacetScrollFn = jest.fn().mockResolvedValue([
      { id: '1', payload: { entry_type: 'decision' } },
      { id: '2', payload: { entry_type: 'note' } },
      { id: '3', payload: { entry_type: 'decision' } },
    ]);

    const result = await aggregateField('entry_type', scroll);

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        { name: 'decision', count: 2 },
        { name: 'note', count: 1 },
      ]),
    );
  });

  it('counts each array element individually (tags field)', async () => {
    const scroll: FacetScrollFn = jest.fn().mockResolvedValue([
      { id: '1', payload: { tags: ['auth', 'security'] } },
      { id: '2', payload: { tags: ['auth'] } },
      { id: '3', payload: { tags: ['api'] } },
    ]);

    const result = await aggregateField('tags', scroll);

    expect(result).toHaveLength(3);
    expect(result).toEqual(
      expect.arrayContaining([
        { name: 'auth', count: 2 },
        { name: 'security', count: 1 },
        { name: 'api', count: 1 },
      ]),
    );
  });

  it('skips null and undefined payload fields', async () => {
    const scroll: FacetScrollFn = jest.fn().mockResolvedValue([
      { id: '1', payload: { tags: null } },
      { id: '2', payload: {} },
      { id: '3', payload: { tags: undefined } },
      { id: '4', payload: { tags: ['api'] } },
    ]);

    const result = await aggregateField('tags', scroll);

    expect(result).toEqual([{ name: 'api', count: 1 }]);
  });

  it('skips empty strings in array values', async () => {
    const scroll: FacetScrollFn = jest
      .fn()
      .mockResolvedValue([{ id: '1', payload: { tags: ['', 'valid', ''] } }]);

    const result = await aggregateField('tags', scroll);

    expect(result).toEqual([{ name: 'valid', count: 1 }]);
  });

  it('skips empty string scalar values', async () => {
    const scroll: FacetScrollFn = jest.fn().mockResolvedValue([
      { id: '1', payload: { field: '' } },
      { id: '2', payload: { field: 'value' } },
    ]);

    const result = await aggregateField('field', scroll);

    expect(result).toEqual([{ name: 'value', count: 1 }]);
  });

  it('returns empty array when scroll returns no results', async () => {
    const scroll: FacetScrollFn = jest.fn().mockResolvedValue([]);

    const result = await aggregateField('tags', scroll);

    expect(result).toEqual([]);
  });

  it('passes filter and FACET_SCROLL_LIMIT to scroll', async () => {
    const scroll: FacetScrollFn = jest.fn().mockResolvedValue([]);
    const filter = { must: [{ key: 'repo', match: { value: 'my-repo' } }] };

    await aggregateField('tags', scroll, filter);

    expect(scroll).toHaveBeenCalledWith(filter, 10_000);
  });

  it('passes no filter when filter is undefined', async () => {
    const scroll: FacetScrollFn = jest.fn().mockResolvedValue([]);

    await aggregateField('tags', scroll);

    expect(scroll).toHaveBeenCalledWith(undefined, 10_000);
  });

  it('handles entries with no payload', async () => {
    const scroll: FacetScrollFn = jest
      .fn()
      .mockResolvedValue([{ id: '1' }, { id: '2', payload: { tags: ['api'] } }]);

    const result = await aggregateField('tags', scroll);

    expect(result).toEqual([{ name: 'api', count: 1 }]);
  });
});
