import { describe, expect, it } from 'vitest';
import { LinkRulesSchema } from '../domain/link-rules';
import { applyLinkRules } from './link-rules';
import { renderMarkdownContent } from './markdown';

const grouped = LinkRulesSchema.parse([{ hostnames: ['affiliate.example.com', 'shop.example.com'], rel: ['sponsored'] }]);

describe('rendered link rules', () => {
  it.each(['https://affiliate.example.com/item', 'http://shop.example.com:8080/item', '//shop.example.com/item', '  //shop.example.com/item  ', 'https://SHOP.EXAMPLE.COM./item'])('matches grouped destinations: %s', (href) => {
    expect(applyLinkRules({ html: `<a href="${href}">Item</a>`, linkRules: grouped })).toBe(`<a rel="sponsored" href="${href}">Item</a>`);
  });

  it.each([
    'https://www.shop.example.com/item', 'https://fakeshop.example.com/item',
    'https://shop.example.com.evil.test/item', 'https://shop.example.com@evil.test/item',
    '/item', '#item', 'mailto:shop.example.com', 'javascript:alert(1)', 'ftp://shop.example.com/item', 'invalid URL',
  ])('leaves unmatched or non-web destinations unchanged: %s', (href) => {
    const html = `<a href="${href}">Item</a>`;
    expect(applyLinkRules({ html, linkRules: grouped })).toBe(html);
  });

  it('matches subdomains only at DNS label boundaries when enabled', () => {
    const linkRules = LinkRulesSchema.parse([{ hostnames: ['example.com'], includeSubdomains: true, rel: ['sponsored'] }]);
    expect(applyLinkRules({ html: '<a href="https://www.shop.example.com">Yes</a><a href="https://fakeexample.com">No</a>', linkRules }))
      .toBe('<a rel="sponsored" href="https://www.shop.example.com">Yes</a><a href="https://fakeexample.com">No</a>');
  });

  it('requires all query conditions, decodes entities and values, and checks repeated parameters', () => {
    const linkRules = LinkRulesSchema.parse([{ hostnames: ['shop.example.com'], query: { ref: 'my code', campaign: 'summer' }, rel: ['sponsored'] }]);
    const matched = '<a href="https://shop.example.com/?ref=other&amp;ref=my%20code&amp;campaign=summer">Yes</a>';
    expect(applyLinkRules({ html: matched, linkRules })).toContain('<a rel="sponsored"');
    for (const query of ['ref=my+code', 'ref=my+code&campaign=winter', 'ref=other&campaign=summer']) {
      const html = `<a href="https://shop.example.com/?${query}">No</a>`;
      expect(applyLinkRules({ html, linkRules })).toBe(html);
    }
  });

  it('combines matching rules with existing rel tokens, deduplicates, and is idempotent', () => {
    const linkRules = LinkRulesSchema.parse([...grouped, { hostnames: ['shop.example.com'], rel: ['nofollow', 'sponsored'] }]);
    const html = '<A class="button" HREF="https://shop.example.com" REL="NOOPENER nofollow nofollow">Item</A>';
    const result = applyLinkRules({ html, linkRules });
    expect(result).toBe('<A class="button" HREF="https://shop.example.com" rel="noopener nofollow sponsored">Item</A>');
    expect(applyLinkRules({ html: result, linkRules })).toBe(result);
  });

  it('preserves HTML outside the edited attributes, including raw blocks and escaped code', () => {
    const html = `<!-- wp:example/custom {"html":"<a href='https://shop.example.com'>"} -->
<div data-value='&amp;'><a href='https://shop.example.com' rel='x&quot;y'>Item</a></div>
<script>const html = '<a href="https://shop.example.com">';</script>
<code>&lt;a href="https://shop.example.com"&gt;</code>
<img src="https://shop.example.com/image.png"><a>No href</a>
<!-- /wp:example/custom -->`;
    expect(applyLinkRules({ html, linkRules: grouped })).toBe(html.replace("rel='x&quot;y'", 'rel="x&quot;y sponsored"'));
    expect(applyLinkRules({ html })).toBe(html);
    expect(applyLinkRules({ html, linkRules: [] })).toBe(html);
  });

  it('adds a configured target with automatic noopener without losing other attributes', () => {
    const linkRules = LinkRulesSchema.parse([{ hostnames: ['shop.example.com'], target: '_blank', rel: ['sponsored'] }]);
    const html = '<a class="button" href="https://shop.example.com">Item</a>';
    const result = applyLinkRules({ html, linkRules });
    expect(result).toBe('<a rel="sponsored noopener" target="_blank" class="button" href="https://shop.example.com">Item</a>');
    expect(applyLinkRules({ html: result, linkRules })).toBe(result);
  });

  it('supports target-only rules and patches existing target and rel attributes separately', () => {
    const linkRules = LinkRulesSchema.parse([{ hostnames: ['shop.example.com'], target: '_blank' }]);
    const html = '<A TARGET=\'_self\' HREF="https://shop.example.com" REL="sponsored noopener">Item</A>';
    expect(applyLinkRules({ html, linkRules })).toBe('<A target="_blank" HREF="https://shop.example.com" REL="sponsored noopener">Item</A>');
    expect(applyLinkRules({ html: '<a href="https://shop.example.com">Item</a>', linkRules }))
      .toBe('<a rel="noopener" target="_blank" href="https://shop.example.com">Item</a>');
  });

  it('uses the last specified target and combines rel values from every matching rule', () => {
    const linkRules = LinkRulesSchema.parse([
      { hostnames: ['shop.example.com'], target: '_blank', rel: ['sponsored'] },
      { hostnames: ['shop.example.com'], target: '_self' },
      { hostnames: ['shop.example.com'], rel: ['nofollow'] },
      { hostnames: ['other.example.com'], target: '_blank' },
    ]);
    const html = '<a target="_blank" href="https://shop.example.com">Item</a>';
    expect(applyLinkRules({ html, linkRules })).toBe('<a rel="sponsored nofollow" target="_self" href="https://shop.example.com">Item</a>');
    expect(applyLinkRules({ html, linkRules: [...linkRules].reverse() })).toContain('rel="nofollow sponsored noopener"');
  });

  it('preserves existing targets when rules do not specify one and leaves unmatched anchors alone', () => {
    const html = '<a target="named-window" href="https://shop.example.com">Item</a><a href="https://other.example.com" target="_self">Other</a>';
    expect(applyLinkRules({ html, linkRules: grouped })).toBe(html.replace('<a target=', '<a rel="sponsored" target='));
  });

  it('applies to Markdown links, reference links, autolinks, raw anchors, and included notes', async () => {
    const markdown = '[Inline](https://shop.example.com)\n\n[Reference][shop]\n\n[shop]: https://shop.example.com\n\n<https://affiliate.example.com>\n\n<a href="https://shop.example.com" rel="noopener">Raw</a>\n\n![[note]]';
    const html = await renderMarkdownContent({ markdown, thumbnailSizes: [], linkRules: grouped,
      noteReferences: [{ fullSlug: 'note', title: 'Note', href: '/note', content: '[Included](https://shop.example.com)' }],
    });
    expect(html.match(/rel="(?:sponsored|noopener sponsored)"/g)).toHaveLength(5);
    expect(html).toContain('rel="noopener sponsored"');
  });
});
