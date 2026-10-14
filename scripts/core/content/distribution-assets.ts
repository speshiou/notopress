import { collectHtmlAssetUrls } from '../../../src/lib/html-assets';
import { getAssetUrl } from '../../../src/lib/responsive-images';
import { resolveLocalImagePath, safelyDecodeUriComponent } from '../../../src/lib/local-images';
import { isPublishableVaultPath } from '../storage/paths';

export function createDistributionAssetResolver({ siteId, imageHost, assetFiles, publicFiles, generatedPaths, collectUrls = collectHtmlAssetUrls }: {
  siteId: string;
  imageHost?: string;
  assetFiles: readonly string[];
  publicFiles: readonly string[];
  generatedPaths: readonly string[];
  collectUrls?: typeof collectHtmlAssetUrls;
}) {
  const available = new Set([...assetFiles.map((file) => `content/${file}`), ...publicFiles.map((file) => `public/${file}`), ...generatedPaths]);
  const roots = ['content', 'public'] as const;
  const hostedPrefixes = roots.map((root) => ({ root, prefix: getAssetUrl({ imageHost, siteId, s3SubDir: root, filePath: '' }) }));
  return ({ html, sourceDirectory }: { html: string; sourceDirectory: string }): readonly string[] => {
    const assets = new Set<string>();
    for (const raw of collectUrls({ html })) {
      const url = raw.split(/[?#]/)[0];
      if (!url || /^(data:|mailto:|tel:|javascript:)/i.test(url)) continue;
      let resolved: string | undefined;
      const hosted = hostedPrefixes.find(({ prefix }) => url.startsWith(prefix));
      if (hosted) {
        const relative = safelyDecodeUriComponent({ value: url.slice(hosted.prefix.length) });
        resolved = `${hosted.root}/${relative}`;
        if (!imageHost && publicFiles.includes(relative)) resolved = `public/${relative}`;
        if (!imageHost && !available.has(resolved) && available.has(`public/${relative}`)) resolved = `public/${relative}`;
        // Existence is checked only after publication scope selection, so unrelated missing assets cannot block a targeted publish.
        if (!isPublishableVaultPath(resolved) || /\.md$/i.test(resolved)) throw new Error(`Invalid distribution asset: ${resolved}.`);
      } else if (!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) {
        const input = { src: url, availableFiles: assetFiles, sourceDirectory };
        const relative = resolveLocalImagePath(input);
        if (assetFiles.includes(relative)) resolved = publicFiles.includes(relative) ? `public/${relative}` : `content/${relative}`;
      }
      if (resolved && isPublishableVaultPath(resolved) && !/\.md$/i.test(resolved)) assets.add(resolved);
    }
    return [...assets].sort();
  };
}
