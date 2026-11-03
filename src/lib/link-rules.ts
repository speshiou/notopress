import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import type { LinkRule } from '../domain/link-rules';

function matches({ url, rule }: { url: URL; rule: LinkRule }): boolean {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  return rule.hostnames.some((domain) => hostname === domain || (rule.includeSubdomains && hostname.endsWith(`.${domain}`)))
    && Object.entries(rule.query || {}).every(([key, value]) => url.searchParams.getAll(key).includes(value));
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Patch only configured anchor attributes, preserving raw blocks, comments, and other HTML bytes. */
export function applyLinkRules({ html, linkRules = [] }: { html: string; linkRules?: readonly LinkRule[] }): string {
  if (linkRules.length === 0) return html;
  const edits = new Map<number, { start: number; end: number; replacement: string }>();
  function visit(node: DefaultTreeAdapterMap['node']) {
    if ('tagName' in node && node.tagName === 'a' && node.namespaceURI === 'http://www.w3.org/1999/xhtml') {
      const href = node.attrs.find((attribute) => attribute.name === 'href')?.value;
      const startTag = node.sourceCodeLocation?.startTag;
      if (href && startTag) {
        const destination = href.trim();
        let url: URL | undefined;
        try { url = new URL(destination.startsWith('//') ? `https:${destination}` : destination); } catch { /* Relative and invalid URLs have no hostname to match. */ }
        if (url && ['http:', 'https:'].includes(url.protocol)) {
          const matched = linkRules.filter((rule) => matches({ url, rule }));
          const target = matched.reduce<LinkRule['target']>((value, rule) => rule.target ?? value, undefined);
          const additions = matched.flatMap((rule) => rule.rel || []);
          if (target === '_blank') additions.push('noopener');
          const attributes: Record<string, string> = {};
          if (additions.length > 0) {
            const existing = node.attrs.find((attribute) => attribute.name === 'rel')?.value;
            attributes.rel = [...new Set([...(existing || '').split(/\s+/).filter(Boolean).map((token) => token.toLowerCase()), ...additions])].join(' ');
          }
          if (target !== undefined) attributes.target = target;
          const insertions: string[] = [];
          for (const [name, value] of Object.entries(attributes)) {
            if (value !== node.attrs.find((attribute) => attribute.name === name)?.value) {
              const location = node.sourceCodeLocation?.attrs?.[name];
              const replacement = `${name}="${escapeAttribute(value)}"`;
              if (!location) {
                insertions.push(replacement);
                continue;
              }
              const start = location.startOffset;
              edits.set(start, {
                start, end: location.endOffset, replacement,
              });
            }
          }
          if (insertions.length > 0) {
            const start = startTag.startOffset + 2;
            edits.set(start, { start, end: start, replacement: ` ${insertions.join(' ')}` });
          }
        }
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child);
    if ('content' in node && node.tagName === 'template') visit(node.content);
  }
  visit(parseFragment(html, { sourceCodeLocationInfo: true }));
  let result = html;
  for (const edit of [...edits.values()].sort((left, right) => right.start - left.start)) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return result;
}
