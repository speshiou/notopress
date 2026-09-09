import { describe, expect, it } from 'vitest';
import { findUnescapedWikilinksInTables, formatUnescapedTableWikilinkWarning } from './table-wikilinks';

describe('findUnescapedWikilinksInTables', () => {
  it('finds unescaped aliased wikilinks in GFM table rows', () => {
    const markdown = [
      '| Feature | Link |',
      '| --- | --- |',
      '| Docs | [[note-slug|Display label]] |',
    ].join('\n');

    expect(findUnescapedWikilinksInTables({ markdown })).toEqual([
      {
        line: 3,
        excerpt: '| Docs | [[note-slug|Display label]] |',
      },
    ]);
  });

  it('ignores escaped table wikilinks and aliased wikilinks outside tables', () => {
    const markdown = [
      'See [[note-slug|Display label]] in prose.',
      '',
      '| Feature | Link |',
      '| --- | --- |',
      '| Docs | [[note-slug\\|Display label]] |',
    ].join('\n');

    expect(findUnescapedWikilinksInTables({ markdown })).toEqual([]);
  });

  it('finds unescaped wikilinks in tables without leading pipes', () => {
    const markdown = [
      'Feature | Link',
      '--- | ---',
      'Docs | [[note-slug|Display label]]',
    ].join('\n');

    expect(findUnescapedWikilinksInTables({ markdown })).toEqual([
      {
        line: 3,
        excerpt: 'Docs | [[note-slug|Display label]]',
      },
    ]);
  });

  it('ignores examples inside fenced and inline code', () => {
    const markdown = [
      '```md',
      '| Docs | [[note-slug|Display label]] |',
      '| --- | --- |',
      '```',
      '',
      '| Example | Code |',
      '| --- | --- |',
      '| Safe | `[[note-slug|Display label]]` |',
    ].join('\n');

    expect(findUnescapedWikilinksInTables({ markdown })).toEqual([]);
  });

  it('finds unescaped image wikilinks in blockquote tables', () => {
    const markdown = [
      '> | Asset | Image |',
      '> | --- | --- |',
      '> | Map | ![[map.png|Map alt]] |',
    ].join('\n');

    expect(findUnescapedWikilinksInTables({ markdown })).toEqual([
      {
        line: 3,
        excerpt: '> | Map | ![[map.png|Map alt]] |',
      },
    ]);
  });
});

describe('formatUnescapedTableWikilinkWarning', () => {
  it('includes the file path, line, and escaped-wikilink fix', () => {
    const warning = formatUnescapedTableWikilinkWarning({
      filePath: 'article.md',
      issue: {
        line: 12,
        excerpt: '| Docs | [[note-slug|Display label]] |',
      },
    });

    expect(warning).toContain('article.md:12');
    expect(warning).toContain('| Docs | [[note-slug|Display label]] |');
    expect(warning).toContain('[[target\\|label]]');
  });
});
