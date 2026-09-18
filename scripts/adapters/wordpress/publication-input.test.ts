import { describe, expect, it } from 'vitest';
import { computeWordPressPublicationInputHash } from './publication-input';

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
});
