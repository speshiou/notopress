import { describe, expect, it } from 'vitest';
import { collectLocalImageInputs, computeWordPressPublicationInputHash } from './publication-input';

const baseInput = {
  sourceHash: 'source-hash',
  markdown: 'Body with [[related-note]] and ![Image](hero.png)',
  title: 'Example',
  wordpressSlug: 'example',
  contentType: 'post' as const,
  taxonomies: {},
  noteReferences: [{
    fullSlug: 'related-note',
    title: 'Related note',
    href: '/related-note',
    content: 'Included content',
  }],
  siteId: 'example-site',
  imageHost: 'https://cdn.example.com',
  thumbnailSizes: [320, 640],
  assetFiles: ['hero.png'],
  responsiveImageWidths: { 'hero.png': [320] },
};

describe('computeWordPressPublicationInputHash', () => {
  it('discovers resolved image dependencies inside nested note and image wikilinks', () => {
    expect(collectLocalImageInputs({
      markdown: '![[note]]\n![Alias](https://legacy.example.com/old.png)\n![Local](logo.png)',
      sourceDirectory: 'guides', assetFiles: ['shared.png', 'logo.png', 'guides/logo.png', 'new.png'],
      resolveImageAlias: (src) => src === 'https://legacy.example.com/old.png' ? 'new.png' : undefined,
      noteReferences: [
        { fullSlug: 'note', title: 'Note', href: '/note', content: '![[nested]]' },
        { fullSlug: 'nested', title: 'Nested', href: '/nested', content: '![[shared.png]]' },
      ],
    }).map((image) => image.path)).toEqual(['guides/logo.png', 'new.png', 'shared.png']);
  });
  it('is stable for equivalent publication inputs', () => {
    expect(computeWordPressPublicationInputHash(baseInput)).toBe(
      computeWordPressPublicationInputHash(baseInput)
    );
  });

  it('changes for transclusions, resolved image variants, and target settings', () => {
    const original = computeWordPressPublicationInputHash(baseInput);
    expect(computeWordPressPublicationInputHash({
      ...baseInput,
      noteReferences: [{ ...baseInput.noteReferences[0], content: 'Changed include' }],
    })).not.toBe(original);
    expect(computeWordPressPublicationInputHash({
      ...baseInput,
      responsiveImageWidths: { 'hero.png': [320, 640] },
    })).not.toBe(original);
    expect(computeWordPressPublicationInputHash({
      ...baseInput,
      imageHost: 'https://media.example.com',
    })).not.toBe(original);
  });

  it('tracks the same document-relative image and widths as the renderer', () => {
    const input = { ...baseInput, markdown: '![Image](logo.png)', sourceDirectory: 'guides',
      assetFiles: ['logo.png', 'guides/logo.png'],
      responsiveImageWidths: { 'logo.png': [640], 'guides/logo.png': [128] },
    };
    const original = computeWordPressPublicationInputHash(input);
    expect(computeWordPressPublicationInputHash({ ...input, sourceDirectory: '' })).not.toBe(original);
    expect(computeWordPressPublicationInputHash({ ...input, responsiveImageWidths: { 'logo.png': [640], 'guides/logo.png': [256] } })).not.toBe(original);
    expect(computeWordPressPublicationInputHash({ ...input, responsiveImageWidths: { 'logo.png': [1280], 'guides/logo.png': [128] } })).toBe(original);
  });
});

it('invalidates cached publication inputs when a recorded image mapping changes', () => {
  const input = { ...baseInput, markdown: '![Example](/legacy/old.png)', assetFiles: ['assets/first.png', 'assets/second.png'],
    responsiveImageWidths: { 'assets/first.png': [320], 'assets/second.png': [640] },
  };
  const first = computeWordPressPublicationInputHash({ ...input, resolveImageAlias: () => 'assets/first.png' });
  expect(computeWordPressPublicationInputHash({ ...input, resolveImageAlias: () => 'assets/second.png' })).not.toBe(first);
});
