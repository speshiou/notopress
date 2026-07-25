import { describe, expect, it, vi } from 'vitest';
import path from 'path';
import { createAgentRulesWriter, RuleModule } from './agent-rules';

const MOCK_BASE_TEMPLATE = `# This is a Notopress vault

This vault is synced by Notopress. Edit source Markdown files and source assets, but do not manually edit generated files such as \`root.json\`, directory-level \`index.json\`, or generated thumbnails. Regenerate them with the Notopress sync tooling when needed.

Keep article metadata consistent with the surrounding Markdown files. Preserve existing frontmatter fields unless the edit explicitly requires changing them.

For captions, use a single italic paragraph immediately after the media or table. For table captions, place the caption directly after the Markdown table, for example: \`*Feature comparison table.*\`. Plain paragraphs are treated as normal article text, not captions.`;

const MOCK_WORDPRESS_TEMPLATE = `# WordPress Integration & Commands
- **Sync & Push Commands**:
  - \`npm run sync -- --site {{siteId}} --wp\`: Syncs content vault and publishes Markdown posts to WordPress via REST API.
  - \`npm run sync -- --site {{siteId}} --wp --push <slug1,slug2>\`: Publishes specific post slugs to WordPress.
  - \`npm run sync -- --site {{siteId}} --wp --dry-run\`: Previews WordPress API mutations without altering remote posts.
- **Pull Commands**:
  - \`npm run sync -- --site {{siteId}} --pull <slug-or-id>\`: Fetches remote post from WordPress REST API, converts content, and saves to local vault Markdown.
- **WP-CLI Utility Commands** (for managing local/remote WordPress instances):
  - \`wp post list --post_type=post\`: Lists published WordPress posts.
  - \`wp cache flush\`: Clears WordPress object cache.
  - \`wp plugin list\`: Displays installed WordPress plugins.
- **WordPress Conventions & Safety**:
  - Keep WordPress HTML/Gutenberg block conversion logic centralized in \`src/lib/wordpress-blocks.ts\` and \`scripts/lib/wordpress.ts\`.
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
    expect(writes['vault/AGENTS.md']).toContain('Plain paragraphs are treated as normal article text, not captions.');
    expect(writes['vault/AGENTS.md']).not.toContain('WordPress Integration & Commands');
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
      isWordPressEnabled: true,
      dryRun: false,
    });

    expect(writes['vault/AGENTS.md']).toContain('WordPress Integration & Commands');
    expect(writes['vault/AGENTS.md']).toContain('npm run sync -- --site my-tech-blog --wp');
    expect(writes['vault/AGENTS.md']).not.toContain('{{siteId}}');
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
    const { writer } = makeMockWriter({
      exists: vi.fn(async () => true),
      readFile: vi.fn(async () => existingContent),
      writeFile,
    });

    await writer.ensureVaultAgentRules({ vaultPath: 'vault', dryRun: false });

    expect(writeFile).not.toHaveBeenCalled();
  });
});
