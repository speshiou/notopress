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

  it('stops scheduling on failure and waits for in-flight work to settle', async () => {
    let finish: (() => void) | undefined;
    const inFlight = new Promise<void>((resolve) => { finish = resolve; });
    const started: number[] = [];
    let settled = false;
    const error = new Error('failed operation');
    const pending = mapWithConcurrency({
      items: [1, 2, 3, 4], concurrency: 2,
      worker: async (value) => {
        started.push(value);
        if (value === 1) throw error;
        await inFlight;
        return value;
      },
    });
    const observed = pending.catch((failure: unknown) => { settled = true; return failure; });
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([1, 2]);
    expect(settled).toBe(false);
    finish?.();
    expect(await observed).toBe(error);
    expect(started).toEqual([1, 2]);
  });
});
