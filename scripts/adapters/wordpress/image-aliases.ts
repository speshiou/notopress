import { safelyDecodeUriComponent, type ResolveImageAlias } from '../../../src/lib/local-images';
import { getAssetUrl } from '../../../src/lib/responsive-images';
import type { WordPressAssetEntry } from './import-assets';

/** Resolve relocated originals using recorded import provenance, never filename similarity. */
export function createWordPressImageAliasResolver({ scope, state, siteId, imageHost, availableFiles }: {
  scope: string;
  state: Readonly<Record<string, WordPressAssetEntry>>;
  siteId: string;
  imageHost: string;
  availableFiles: readonly string[];
}): ResolveImageAlias {
  const available = new Set(availableFiles);
  const aliases = new Map<string, Set<string>>();
  const prefix = `${scope}:`;
  const hostedPrefixes = ['content', 'public'].map((root) => getAssetUrl({ siteId, imageHost, s3SubDir: root === 'content' ? 'content' : 'public', filePath: '' }));
  function add(key: string, target: string) {
    const matches = aliases.get(key) || new Set<string>();
    matches.add(target);
    aliases.set(key, matches);
  }
  for (const [key, entry] of Object.entries(state)) {
    if (!key.startsWith(prefix) || entry.root !== 'content' || !available.has(entry.path)) continue;
    const source = key.slice(prefix.length);
    add(source, entry.path);
    const hosted = hostedPrefixes.find((candidate) => source.startsWith(candidate));
    if (!hosted) continue;
    const relative = source.slice(hosted.length).split(/[?#]/)[0];
    for (let maxPasses = 0; maxPasses <= 3; maxPasses += 1) {
      add(safelyDecodeUriComponent({ value: relative, maxPasses }), entry.path);
    }
  }
  return (src) => {
    const matches = aliases.get(src) || aliases.get(src.replace(/^\//, ''));
    if (!matches) return undefined;
    if (matches.size !== 1) throw new Error('Ambiguous recorded WordPress image mapping. Restore an unambiguous original reference before publishing.');
    return matches.values().next().value;
  };
}
