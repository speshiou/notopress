import { describe, expect, it, vi } from 'vitest';
import path from 'path';
import { createContentSnapshotBuilder, stripLeadingMarkdownTitle } from './content-snapshot';
import type { VaultDirectoryIndex } from '../../../src/lib/vault';

describe('content snapshot', () => {
  it('builds canonical documents with stable source and target-independent slug fields', async () => {
    const readFile = vi.fn(async () => [
      '---',
      'title: Example',
      'tags:',
      '  - publishing',
      '---',
      '# Example',
      '',
      'Body.',
    ].join('\n'));
    const buildContentSnapshot = createContentSnapshotBuilder({
      readFile,
      joinPath: path.posix.join,
      parseMatter: (source) => ({
        data: { title: 'Example', tags: ['publishing'] },
        content: source.split('---\n').slice(2).join('---\n'),
      }),
      computeHash: () => 'source-hash',
    });
    const allIndices = new Map<string, VaultDirectoryIndex>([
      ['guides', {
        version: 1,
        pages: [{
          title: 'Example',
          slug: 'example',
          publicSlug: 'example',
          date: '2026-01-01T00:00:00.000Z',
          excerpt: '',
          tags: ['publishing'],
        }],
      }],
    ]);

    const snapshot = await buildContentSnapshot({ vaultPath: 'vault', allIndices });

    expect(snapshot.documents).toEqual([
      expect.objectContaining({
        sourceSlug: 'guides/example',
        leafSlug: 'example',
        publicSlug: 'example',
        localPath: 'vault/content/guides/example.md',
        markdown: 'Body.',
        sourceHash: 'source-hash',
        taxonomies: { tags: ['publishing'] },
      }),
    ]);
  });

  it('only removes a leading title and preserves later headings', () => {
    expect(stripLeadingMarkdownTitle({ markdown: '# Title\n\nBody\n\n# Later' })).toBe('Body\n\n# Later');
    expect(stripLeadingMarkdownTitle({ markdown: 'Intro\n\n# Heading' })).toBe('Intro\n\n# Heading');
    expect(stripLeadingMarkdownTitle({ markdown: '```md\n# Code\n```\n\nBody' })).toContain('# Code');
  });
});
