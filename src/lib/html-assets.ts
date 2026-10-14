import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';

/** Read actual rendered attributes, including decoded HTML entities and srcset variants. */
export function collectHtmlAssetUrls({ html, parse = parseFragment }: {
  html: string;
  parse?: typeof parseFragment;
}): readonly string[] {
  const urls = new Set<string>();
  function visit(node: DefaultTreeAdapterMap['node']) {
    if ('attrs' in node) {
      for (const attribute of node.attrs) {
        if (['src', 'href', 'poster', 'data'].includes(attribute.name)) urls.add(attribute.value);
        if (attribute.name === 'srcset') {
          for (const candidate of attribute.value.split(',')) {
            const url = candidate.trim().split(/\s+/)[0];
            if (url) urls.add(url);
          }
        }
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child);
    if ('content' in node && node.tagName === 'template') visit(node.content);
  }
  visit(parse(html));
  return [...urls].sort();
}
