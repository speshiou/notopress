import { describe, expect, it, vi } from 'vitest';
import path from 'path';
import { createAgentRulesWriter } from './agent-rules';

describe('createAgentRulesWriter', () => {
  it('creates vault AGENTS.md rules when missing', async () => {
    const writes: Record<string, string> = {};
    const logger = { log: vi.fn() };
    const writer = createAgentRulesWriter({
      exists: vi.fn(async () => false),
      readFile: vi.fn(async () => ''),
      writeFile: vi.fn(async (filePath: string, content: string) => {
        writes[filePath] = content;
      }),
      joinPath: path.posix.join,
      logger,
    });

    await writer.ensureVaultAgentRules({ vaultPath: 'vault', dryRun: false });

    expect(writes['vault/AGENTS.md']).toContain('<!-- BEGIN:notopress-vault-agent-rules -->');
    expect(writes['vault/AGENTS.md']).toContain('This is a Notopress vault');
    expect(writes['vault/AGENTS.md']).toContain('directory-level `index.json`');
    expect(writes['vault/AGENTS.md']).toContain('Plain paragraphs are treated as normal article text, not captions.');
    expect(writes['vault/AGENTS.md'].endsWith('\n')).toBe(true);
  });

  it('replaces the managed block while preserving user notes', async () => {
    const writes: Record<string, string> = {};
    const writer = createAgentRulesWriter({
      exists: vi.fn(async () => true),
      readFile: vi.fn(async () =>
        [
          '# Personal notes',
          '',
          '<!-- BEGIN:notopress-vault-agent-rules -->',
          'old rules',
          '<!-- END:notopress-vault-agent-rules -->',
          '',
          'Keep this custom note.',
          '',
        ].join('\n')
      ),
      writeFile: vi.fn(async (filePath: string, content: string) => {
        writes[filePath] = content;
      }),
      joinPath: path.posix.join,
      logger: { log: vi.fn() },
    });

    await writer.ensureVaultAgentRules({ vaultPath: 'vault', dryRun: false });

    expect(writes['vault/AGENTS.md']).toContain('# Personal notes');
    expect(writes['vault/AGENTS.md']).toContain('Keep this custom note.');
    expect(writes['vault/AGENTS.md']).not.toContain('old rules');
  });

  it('appends the managed block to an existing user-authored AGENTS.md', async () => {
    const writes: Record<string, string> = {};
    const writer = createAgentRulesWriter({
      exists: vi.fn(async () => true),
      readFile: vi.fn(async () => '# User rules\n\nKeep article titles short.\n'),
      writeFile: vi.fn(async (filePath: string, content: string) => {
        writes[filePath] = content;
      }),
      joinPath: path.posix.join,
      logger: { log: vi.fn() },
    });

    await writer.ensureVaultAgentRules({ vaultPath: 'vault', dryRun: false });

    expect(writes['vault/AGENTS.md'].startsWith('# User rules\n\nKeep article titles short.')).toBe(true);
    expect(writes['vault/AGENTS.md']).toContain('<!-- BEGIN:notopress-vault-agent-rules -->');
    expect(writes['vault/AGENTS.md']).toContain('<!-- END:notopress-vault-agent-rules -->');
  });

  it('does not write during dry run', async () => {
    const writeFile = vi.fn(async () => undefined);
    const logger = { log: vi.fn() };
    const writer = createAgentRulesWriter({
      exists: vi.fn(async () => false),
      readFile: vi.fn(async () => ''),
      writeFile,
      joinPath: path.posix.join,
      logger,
    });

    await writer.ensureVaultAgentRules({ vaultPath: 'vault', dryRun: true });

    expect(writeFile).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith('[DRY RUN] Would update vault AGENTS.md at: vault/AGENTS.md');
  });

  it('does not rewrite an up-to-date rules file', async () => {
    const existingContent = [
      '<!-- BEGIN:notopress-vault-agent-rules -->',
      '# This is a Notopress vault',
      '',
      'This vault is synced by Notopress. Edit source Markdown files and source assets, but do not manually edit generated files such as `root.json`, directory-level `index.json`, or generated thumbnails. Regenerate them with the Notopress sync tooling when needed.',
      '',
      'Keep article metadata consistent with the surrounding Markdown files. Preserve existing frontmatter fields unless the edit explicitly requires changing them.',
      '',
      'For captions, use a single italic paragraph immediately after the media or table. For table captions, place the caption directly after the Markdown table, for example: `*Feature comparison table.*`. Plain paragraphs are treated as normal article text, not captions.',
      '<!-- END:notopress-vault-agent-rules -->',
      '',
    ].join('\n');
    const writeFile = vi.fn(async () => undefined);
    const writer = createAgentRulesWriter({
      exists: vi.fn(async () => true),
      readFile: vi.fn(async () => existingContent),
      writeFile,
      joinPath: path.posix.join,
      logger: { log: vi.fn() },
    });

    await writer.ensureVaultAgentRules({ vaultPath: 'vault', dryRun: false });

    expect(writeFile).not.toHaveBeenCalled();
  });
});
