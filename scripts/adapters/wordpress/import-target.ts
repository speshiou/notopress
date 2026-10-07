import { isSafeAssetPath } from '../../../src/domain/asset-path';
import type { Site } from '../../../src/domain/registry';
import { listVaultFullSlugCandidates } from '../../../src/lib/rewrites';
import path from 'node:path';

export function getImportedImageMarkdownPath({ imagePath, root, canonicalSlug }: { imagePath: string; root: 'content' | 'public'; canonicalSlug: string }): string {
  return path.posix.relative(path.posix.dirname(`content/${canonicalSlug}.md`), `${root}/${imagePath}`);
}

export function createWordPressImportTargetResolver(deps: {
  list: () => Promise<readonly string[]>;
  exists: (file: string) => boolean;
  join: (...parts: string[]) => string;
}) {
  return async ({ site, slugOrId, wpSlug }: { site: Site; slugOrId: string; wpSlug: string }) => {
    const availableFullSlugs = (await deps.list())
      .filter((file) => file.endsWith('.md') && !file.split('/').some((part) => part.startsWith('.') || part.startsWith('_')) && !file.endsWith('AGENTS.md'))
      .map((file) => file.slice(0, -3));
    const candidates = listVaultFullSlugCandidates({ slugOrId, wpSlug, rules: site.rewrites, availableFullSlugs });
    for (const fullSlug of candidates) {
      if (!isSafeAssetPath(fullSlug)) throw new Error('Unsafe WordPress import article path.');
      const localPath = deps.join(site.vaultPath, 'content', `${fullSlug}.md`);
      if (deps.exists(localPath)) return { localPath, canonicalSlug: fullSlug, matchedExisting: true };
    }
    if (!isSafeAssetPath(wpSlug)) throw new Error('Unsafe WordPress import article path.');
    return { localPath: deps.join(site.vaultPath, 'content', `${wpSlug}.md`), canonicalSlug: wpSlug, matchedExisting: false };
  };
}
