import { describe, expect, it, vi } from 'vitest';
import path from 'path';
import { createAgentRulesWriter, RuleModule } from './agent-rules';

const MOCK_BASE_TEMPLATE = `# This is a Notopress vault

This vault is synced by Notopress. Edit source Markdown files and source assets, but do not manually edit generated files such as \`root.json\`, directory-level \`index.json\`, or generated thumbnails. Regenerate them with the Notopress sync tooling when needed.

Keep article metadata consistent with the surrounding Markdown files. Preserve existing frontmatter fields unless the edit explicitly requires changing them. Put YAML frontmatter at the very start of each article, enclosed by \`---\` delimiters, using this format:

\`\`\`yaml
---
title: "Article title"
date: "2026-01-15T08:30:00.000Z"
published: true
categories:
  - engineering
tags:
  - publishing
---
\`\`\`

Use an ISO 8601 timestamp for \`date\`. Set \`published: false\` to exclude a draft from generated indexes. \`categories\` and \`tags\` are optional arrays of taxonomy slugs. When present, keep each slug as a separate list item; omit either field when the article does not manage that taxonomy.

For captions, use a single italic paragraph immediately after the media or table. For table captions, place the caption directly after the Markdown table, for example: \`*Feature comparison table.*\`. Plain paragraphs are treated as normal article text, not captions.

In Markdown tables, escape the alias separator in Obsidian wikilinks: \`[[note-slug\\|Display label]]\`. An unescaped \`|\` is treated as a new table column and breaks the table. Outside tables, normal aliased wikilinks (\`[[note-slug|Display label]]\`) are fine. Keep wikilinks in vault source instead of rewriting them to standard Markdown links. Notopress sync warns when it finds unescaped table wikilinks.`;

const MOCK_WORDPRESS_TEMPLATE = `# Publisher Adapter & WordPress Commands
- **Publish Commands**:
  - \`npm --prefix {{notopressPath}} run publish -- <publisher-id> --site {{siteId}}\`: Syncs the native site and publishes through the selected adapter.
- **Import Commands**:
  - \`npm --prefix {{notopressPath}} run import -- <publisher-id> <slug-or-id> --site {{siteId}}\`: Imports one remote resource through the adapter.
- **WP-CLI Utility Commands** (for managing local/remote WordPress instances):
  - \`wp post list --post_type=post\`: Lists published WordPress posts.
  - \`wp cache flush\`: Clears WordPress object cache.
  - \`wp plugin list\`: Displays installed WordPress plugins.
- **WordPress Conventions & Safety**:
  - Top-level \`categories\` and \`tags\` frontmatter fields contain optional WordPress term slugs. NotoPress resolves existing terms to IDs and creates missing terms during live sync; dry runs remain read-only and report missing terms.
  - Keep WordPress-specific publishing, importing, Gutenberg conversion, remote state, and tests isolated under \`scripts/adapters/wordpress/\`.
  - Pass WordPress credentials (\`endpoint\`, \`username\`, \`applicationPassword\`) via \`registry.json\` or environment variables; never hardcode API keys or credentials in code or tests.
  - Always verify WordPress post updates using \`--dry-run\` before applying batch sync operations to production endpoints.`;

describe('createAgentRulesWriter', () => {
  function makeMockWriter({
    exists = vi.fn(async () => false),
    readFile = vi.fn(async () => ''),
    writeFile = vi.fn(async () => undefined),
    logger = { log: vi.fn() },
  }: {
    exists?: (path: string) => Promise<boolean>;
    readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
    writeFile?: (path: string, content: string) => Promise<void>;
    logger?: Pick<typeof console, 'log'>;
  } = {}) {
    const readTemplate = vi.fn(async (moduleName: RuleModule) => {
      if (moduleName === 'base') return MOCK_BASE_TEMPLATE;
      if (moduleName === 'wordpress') return MOCK_WORDPRESS_TEMPLATE;
      return '';
    });

    const writer = createAgentRulesWriter({
      exists,
      readFile,
      writeFile,
      readTemplate,
      joinPath: path.posix.join,
      logger,
    });

    return { writer, readTemplate, writeFile, logger };
  }

  it('creates base vault AGENTS.md rules when missing and WordPress is disabled', async () => {
    const writes: Record<string, string> = {};
    const { writer } = makeMockWriter({
      writeFile: vi.fn(async (filePath: string, content: string) => {
        writes[filePath] = content;
      }),
    });

    await writer.ensureVaultAgentRules({ vaultPath: 'vault', dryRun: false });

    expect(writes['vault/AGENTS.md']).toContain('<!-- BEGIN:notopress-vault-agent-rules -->');
    expect(writes['vault/AGENTS.md']).toContain('This is a Notopress vault');
    expect(writes['vault/AGENTS.md']).toContain('title: "Article title"');
    expect(writes['vault/AGENTS.md']).toContain('published: false');
    expect(writes['vault/AGENTS.md']).toContain('`categories` and `tags` are optional arrays of taxonomy slugs');
    expect(writes['vault/AGENTS.md']).toContain('Plain paragraphs are treated as normal article text, not captions.');
    expect(writes['vault/AGENTS.md']).toContain('[[note-slug\\|Display label]]');
    expect(writes['vault/AGENTS.md']).toContain('Keep wikilinks in vault source');
    expect(writes['vault/AGENTS.md']).toContain('Notopress sync warns');
    expect(writes['vault/AGENTS.md']).not.toContain('Publisher Adapter & WordPress Commands');
    expect(writes['vault/AGENTS.md'].endsWith('\n')).toBe(true);
  });

  it('includes WordPress section with dynamic siteId substitution when isWordPressEnabled is true', async () => {
    const writes: Record<string, string> = {};
    const { writer } = makeMockWriter({
      writeFile: vi.fn(async (filePath: string, content: string) => {
        writes[filePath] = content;
      }),
    });

    await writer.ensureVaultAgentRules({
      vaultPath: 'vault',
      siteId: 'my-tech-blog',
      notopressPath: '/path/to/notopress',
      isWordPressEnabled: true,
      dryRun: false,
    });

    expect(writes['vault/AGENTS.md']).toContain('Publisher Adapter & WordPress Commands');
    expect(writes['vault/AGENTS.md']).toContain('NotoPress resolves existing terms to IDs and creates missing terms during live sync');
    expect(writes['vault/AGENTS.md']).toContain('npm --prefix /path/to/notopress run publish -- <publisher-id> --site my-tech-blog');
    expect(writes['vault/AGENTS.md']).not.toContain('{{siteId}}');
    expect(writes['vault/AGENTS.md']).not.toContain('{{notopressPath}}');
  });

  it('replaces the managed block while preserving user notes', async () => {
    const writes: Record<string, string> = {};
    const { writer } = makeMockWriter({
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
    });

    await writer.ensureVaultAgentRules({ vaultPath: 'vault', dryRun: false });

    expect(writes['vault/AGENTS.md']).toContain('# Personal notes');
    expect(writes['vault/AGENTS.md']).toContain('Keep this custom note.');
    expect(writes['vault/AGENTS.md']).not.toContain('old rules');
  });

  it('appends the managed block to an existing user-authored AGENTS.md', async () => {
    const writes: Record<string, string> = {};
    const { writer } = makeMockWriter({
      exists: vi.fn(async () => true),
      readFile: vi.fn(async () => '# User rules\n\nKeep article titles short.\n'),
      writeFile: vi.fn(async (filePath: string, content: string) => {
        writes[filePath] = content;
      }),
    });

    await writer.ensureVaultAgentRules({ vaultPath: 'vault', dryRun: false });

    expect(writes['vault/AGENTS.md'].startsWith('# User rules\n\nKeep article titles short.')).toBe(true);
    expect(writes['vault/AGENTS.md']).toContain('<!-- BEGIN:notopress-vault-agent-rules -->');
    expect(writes['vault/AGENTS.md']).toContain('<!-- END:notopress-vault-agent-rules -->');
  });

  it('does not write during dry run', async () => {
    const writeFile = vi.fn(async () => undefined);
    const logger = { log: vi.fn() };
    const { writer } = makeMockWriter({
      writeFile,
      logger,
    });

    await writer.ensureVaultAgentRules({ vaultPath: 'vault', dryRun: true });

    expect(writeFile).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith('[DRY RUN] Would update vault AGENTS.md at: vault/AGENTS.md');
  });

  it('does not rewrite an up-to-date rules file', async () => {
    const existingContent = [
      '<!-- BEGIN:notopress-vault-agent-rules -->',
      MOCK_BASE_TEMPLATE,
      '<!-- END:notopress-vault-agent-rules -->',
      '',
    ].join('\n');
    const writeFile = vi.fn(async () => undefined);
    const { writer } = makeMockWriter({
      exists: vi.fn(async () => true),
      readFile: vi.fn(async () => existingContent),
      writeFile,
    });

    await writer.ensureVaultAgentRules({ vaultPath: 'vault', dryRun: false });

    expect(writeFile).not.toHaveBeenCalled();
  });
});
