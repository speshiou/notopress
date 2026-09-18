import { parse } from '@wordpress/block-serialization-default-parser';
import { describe, expect, it, vi } from 'vitest';
import { createRawBlockConverter } from './raw-blocks';

function parseBlocks({ content }: { content: string }): unknown {
  const parsedBlocks: unknown = parse(content);
  return parsedBlocks;
}

describe('createRawBlockConverter', () => {
  it('converts core block HTML without maintaining a core block-name denylist', () => {
    const convertHtml = vi.fn(({ html }: { html: string }) => html.replace(/<[^>]+>/g, '').trim());
    const convert = createRawBlockConverter({ parseBlocks, convertHtml });

    const result = convert({
      content: [
        '<!-- wp:paragraph --><p>Intro</p><!-- /wp:paragraph -->',
        '<!-- wp:gallery --><figure>Gallery content</figure><!-- /wp:gallery -->',
      ].join('\n'),
    });

    expect(result.markdown).toBe('Intro\n\nGallery content');
    expect(result.preservedBlockNames).toEqual([]);
  });

  it('preserves self-closing and paired custom blocks with their attributes', () => {
    const convert = createRawBlockConverter({
      parseBlocks,
      convertHtml: ({ html }) => html.replace(/<[^>]+>/g, '').trim(),
    });

    const result = convert({
      content: [
        '<!-- wp:namespace/dynamic-block {"setting":"value"} /-->',
        '<!-- wp:namespace/static-block {"count":2} --><div>Custom content</div><!-- /wp:namespace/static-block -->',
      ].join('\n'),
    });

    expect(result.markdown).toContain('<!-- wp:namespace/dynamic-block {"setting":"value"} /-->');
    expect(result.markdown).toContain('<!-- wp:namespace/static-block {"count":2} --><div>Custom content</div><!-- /wp:namespace/static-block -->');
    expect(result.preservedBlockNames).toEqual(['namespace/dynamic-block', 'namespace/static-block']);
  });

  it('preserves dynamic core blocks that have no saved HTML', () => {
    const convert = createRawBlockConverter({
      parseBlocks,
      convertHtml: ({ html }) => html,
    });

    const result = convert({ content: '<!-- wp:latest-posts {"postsToShow":3} /-->' });

    expect(result.markdown).toBe('<!-- wp:latest-posts {"postsToShow":3} /-->');
    expect(result.preservedBlockNames).toEqual(['core/latest-posts']);
  });

  it('preserves a containing core block when it includes a custom descendant', () => {
    const convert = createRawBlockConverter({
      parseBlocks,
      convertHtml: ({ html }) => html,
    });
    const content = [
      '<!-- wp:group -->',
      '<div class="wp-block-group">',
      '<!-- wp:namespace/example-block {"setting":"value"} /-->',
      '</div>',
      '<!-- /wp:group -->',
    ].join('\n');

    const result = convert({ content });

    expect(result.markdown).toContain('<!-- wp:group -->');
    expect(result.markdown).toContain('<!-- wp:namespace/example-block {"setting":"value"} /-->');
    expect(result.preservedBlockNames).toEqual(['core/group']);
  });
});
