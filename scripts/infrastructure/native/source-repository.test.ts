import { describe, expect, it, vi } from 'vitest';
import { createSourceRepositoryPreparation } from './source-repository';

describe('explicit source Git initialization', () => {
  it('makes no dry-run writes, preserves articles, and rejects changed ignore rules before initializing', async () => {
    const files = new Map<string, string>([['vault/content/article.md', 'source'], ['vault/.gitignore', '*.tmp\n']]);
    const initialize = vi.fn(async (directory: string) => { files.set(`${directory}/.git`, 'repository'); });
    const write = vi.fn(async ({ file, content }: { file: string; content: string }) => { files.set(file, content); });
    const prepare = createSourceRepositoryPreparation({ dependencies: { exists: async (file) => files.has(file), read: async (file) => files.get(file) || '', write, initialize } });
    const dry = await prepare({ vaultPath: 'vault' });
    await dry.apply({ dryRun: true });
    expect(write).not.toHaveBeenCalled(); expect(initialize).not.toHaveBeenCalled();
    files.set('vault/.gitignore', '# Changed\n');
    await expect(dry.apply({ dryRun: false })).rejects.toThrow('plan changed');
    expect(initialize).not.toHaveBeenCalled();
    const live = await prepare({ vaultPath: 'vault' });
    await live.apply({ dryRun: false });
    expect(initialize).toHaveBeenCalledOnce();
    expect(files.get('vault/content/article.md')).toBe('source');
    expect(files.get('vault/.gitignore')).toContain('# Changed');
    await (await prepare({ vaultPath: 'vault' })).apply({ dryRun: false });
    expect(initialize).toHaveBeenCalledOnce(); expect(write).toHaveBeenCalledOnce();
  });
});
