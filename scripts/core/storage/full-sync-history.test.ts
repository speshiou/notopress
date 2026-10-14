import { describe, expect, it, vi } from 'vitest';
import { createFullSyncHistory } from './full-sync-history';

const target = { endpoint: 'https://storage.example.com', bucket: 'example-bucket', siteId: 'example-site' };
const completedAt = '2026-01-01T00:00:00.000Z';
const saved = JSON.stringify({ version: 1, target, completedAt });

function setup({ content = saved, currentTime = '2026-01-02T00:00:00.000Z' } = {}) {
  const write = vi.fn<(content: string) => Promise<void>>(async () => undefined);
  const history = createFullSyncHistory({ read: async () => content, write, now: () => new Date(currentTime) });
  return { history, write };
}

describe('full sync advisory history', () => {
  it('shows the successful completion time without writing or prompting for a recent sync', async () => {
    const h = setup();
    expect(await h.history.describe({ target, remind: true })).toBe(`Last successful full distribution sync: ${completedAt} (1 day(s) ago).`);
    expect(h.write).not.toHaveBeenCalled();
  });

  it('suggests a reviewed full sync after seven days, without blocking or applying one', async () => {
    const h = setup({ currentTime: '2026-01-08T00:00:00.000Z' });
    expect(await h.history.describe({ target, remind: true })).toContain('notopress sync --site "example-site" --dry-run');
    expect(await h.history.describe({ target, remind: false })).not.toContain('Consider');
    expect(h.write).not.toHaveBeenCalled();
  });

  it.each(['invalid JSON', '{}', JSON.stringify({ version: 1, target, completedAt: '2030-01-01T00:00:00.000Z' }),
    JSON.stringify({ version: 1, target: { ...target, bucket: 'other-bucket' }, completedAt }),
    JSON.stringify({ version: 1, target: { ...target, endpoint: 'https://other.example.com' }, completedAt }),
    JSON.stringify({ version: 1, target: { ...target, siteId: 'other-site' }, completedAt }),
  ])('treats invalid, future, or different-destination records as unknown: %s', async (content) => {
    const h = setup({ content });
    const status = await h.history.describe({ target, remind: true });
    expect(status).toContain('unknown');
    expect(status).toContain('Consider');
    expect(h.write).not.toHaveBeenCalled();
  });

  it('handles unavailable history and records only explicit successful completions', async () => {
    const write = vi.fn<(content: string) => Promise<void>>(async () => undefined);
    const history = createFullSyncHistory({ read: async () => { throw new Error('unavailable'); }, write, now: () => new Date(completedAt) });
    expect(await history.describe({ target, remind: true })).toContain('unknown');
    expect(write).not.toHaveBeenCalled();
    await history.record({ target });
    expect(JSON.parse(write.mock.calls[0][0])).toEqual({ version: 1, target, completedAt });
  });
});
