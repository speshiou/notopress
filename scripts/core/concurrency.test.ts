import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency';

describe('mapWithConcurrency', () => {
  it('preserves input order while bounding active work', async () => {
    let active = 0;
    let maximumActive = 0;
    const results = await mapWithConcurrency({
      items: [1, 2, 3, 4, 5],
      concurrency: 2,
      worker: async (value) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        return value * 2;
      },
    });

    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(maximumActive).toBe(2);
  });

  it('rejects invalid concurrency', async () => {
    await expect(mapWithConcurrency({
      items: [1],
      concurrency: 0,
      worker: async (value) => value,
    })).rejects.toThrow('positive integer');
  });
});
