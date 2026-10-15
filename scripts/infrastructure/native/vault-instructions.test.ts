import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, symlink, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createVaultInstructionPreparation } from './vault-instructions';

function setup() {
  let content: string | null = '# Owner instructions\n';
  let template = 'Current shared guidance';
  const write = vi.fn(async (input: { file: string; content: string }) => { content = input.content; });
  const log = vi.fn();
  const prepare = createVaultInstructionPreparation({ dependencies: {
    read: async () => content, readTemplate: async () => template, write,
  }, logger: { log } });
  return { prepare, write, log, getContent: () => content,
    setContent: (value: string | null) => { content = value; }, setTemplate: (value: string) => { template = value; } };
}

describe('vault instruction maintenance', () => {
  it('previews without writes, notifies after a change, and leaves current instructions silent', async () => {
    const h = setup();
    const prepared = await h.prepare({ vaultPath: 'vault' });
    await prepared.apply({ dryRun: true });
    expect(h.write).not.toHaveBeenCalled();
    expect(h.getContent()).toBe('# Owner instructions\n');
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('Would update during a live run; no files changed'));
    h.log.mockClear();
    await prepared.apply({ dryRun: false });
    expect(h.write).toHaveBeenCalledOnce();
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('Read the updated block before continuing'));
    h.log.mockClear();
    const current = await h.prepare({ vaultPath: 'vault' });
    await current.apply({ dryRun: true });
    await current.apply({ dryRun: false });
    expect(h.write).toHaveBeenCalledOnce();
    expect(h.log).not.toHaveBeenCalled();
  });
  it('rejects edits or tool-template changes made after preparation without overwriting', async () => {
    const h = setup();
    const prepared = await h.prepare({ vaultPath: 'vault' });
    h.setContent('# New owner content\n');
    await expect(prepared.apply({ dryRun: false })).rejects.toThrow('plan changed');
    h.setContent('# Owner instructions\n');
    h.setTemplate('New template');
    await expect(prepared.apply({ dryRun: false })).rejects.toThrow('plan changed');
    expect(h.write).not.toHaveBeenCalled();
  });
  it('uses the bundled template independently of the working directory and refuses symlink instructions', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'notopress-instructions-'));
    try {
      const prepare = createVaultInstructionPreparation({ logger: { log: vi.fn() } });
      const prepared = await prepare({ vaultPath: directory });
      await prepared.apply({ dryRun: false });
      expect(await readFile(path.join(directory, 'AGENTS.md'), 'utf8')).toContain('## NotoPress workflow');
      await rm(path.join(directory, 'AGENTS.md'));
      const outside = path.join(directory, 'owner.md');
      await writeFile(outside, 'Owner text');
      await symlink(outside, path.join(directory, 'AGENTS.md'));
      await expect(prepare({ vaultPath: directory })).rejects.toThrow('symbolic link');
      expect(await readFile(outside, 'utf8')).toBe('Owner text');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
