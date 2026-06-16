import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { INDEX_SLUG, SITEMAP_PAGES_XML, SITEMAP_XML } from '../../src/lib/constants';
import { PageMetadata, VaultDirectoryIndex } from '../../src/lib/vault';

type Logger = Pick<typeof console, 'log'>;

export type SitemapGeneratorDeps = {
  mkdir: (path: string, options: { recursive: true }) => Promise<string | undefined>;
  writeFile: (path: string, content: string) => Promise<void>;
  joinPath: (...paths: string[]) => string;
  indexSlug: string;
  sitemapXml: string;
  sitemapPagesXml: string;
  logger: Logger;
};

function escapeXml(unsafe: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  };
  return unsafe.replace(/[&<>"']/g, (m) => map[m]);
}

function generateSitemapXml(urls: { loc: string; lastmod?: string }[]): string {
  const urlTags = urls
    .map(
      (url) => `  <url>
    <loc>${escapeXml(url.loc)}</loc>${url.lastmod ? `\n    <lastmod>${url.lastmod}</lastmod>` : ''}
  </url>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlTags}
</urlset>`;
}

function generateSitemapIndexXml(sitemaps: { loc: string; lastmod?: string }[]): string {
  const sitemapTags = sitemaps
    .map(
      (sitemap) => `  <sitemap>
    <loc>${escapeXml(sitemap.loc)}</loc>${sitemap.lastmod ? `\n    <lastmod>${sitemap.lastmod}</lastmod>` : ''}
  </sitemap>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapTags}
</sitemapindex>`;
}

export function createSitemapGenerator(deps: SitemapGeneratorDeps) {
  function mapPagesToSitemapUrls({
    pages,
    domain,
    relDir = '',
  }: {
    pages: PageMetadata[];
    domain: string;
    relDir?: string;
  }) {
    return pages.map((page) => {
      const urlPath = page.slug === deps.indexSlug ? relDir : relDir ? `${relDir}/${page.slug}` : page.slug;
      return {
        loc: `https://${domain}/${urlPath}`,
        lastmod: page.updatedAt || page.date,
      };
    });
  }

  async function writeSitemapFile({
    fullPath,
    relPath,
    content,
    dryRun,
    label,
  }: {
    fullPath: string;
    relPath: string;
    content: string;
    dryRun: boolean;
    label: string;
  }) {
    if (!dryRun) {
      const dir = deps.joinPath(fullPath, '..');
      await deps.mkdir(dir, { recursive: true });
      await deps.writeFile(fullPath, content);
      deps.logger.log(`✨ Generated ${label} at ${relPath}`);
    } else {
      deps.logger.log(`[DRY RUN] Would generate ${label} at ${relPath}`);
    }
  }

  async function generateAllSitemaps({
    domain,
    allIndices,
    vaultPath,
    dryRun,
  }: {
    domain: string;
    allIndices: Map<string, VaultDirectoryIndex>;
    vaultPath: string;
    dryRun: boolean;
  }): Promise<string[]> {
    const subSitemaps: string[] = [];
    for (const [relDir, indexData] of allIndices.entries()) {
      if (relDir === '') continue;
      if (indexData.pages.length === 0) continue;

      const sitemapUrls = mapPagesToSitemapUrls({ pages: indexData.pages, domain, relDir });
      const sitemapContent = generateSitemapXml(sitemapUrls);
      const sitemapPath = deps.joinPath(vaultPath, 'public', relDir, deps.sitemapXml);
      const relSitemapPath = `public/${relDir}/${deps.sitemapXml}`;

      await writeSitemapFile({
        fullPath: sitemapPath,
        relPath: relSitemapPath,
        content: sitemapContent,
        dryRun,
        label: `sitemap for "${relDir}"`,
      });
      subSitemaps.push(`${relDir}/${deps.sitemapXml}`);
    }
    return subSitemaps;
  }

  return {
    mapPagesToSitemapUrls,
    writeSitemapFile,
    generateAllSitemaps,
    async generateSitemaps({
      vaultPath,
      domain,
      rootContentIndex,
      allIndices,
      dryRun,
    }: {
      vaultPath: string;
      domain: string | undefined;
      rootContentIndex: VaultDirectoryIndex;
      allIndices: Map<string, VaultDirectoryIndex>;
      dryRun: boolean;
    }) {
      if (!domain) {
        deps.logger.log('ℹ️  Skipping sitemap generation because "domain" is not configured in registry.json');
        return;
      }

      const publicBaseDir = deps.joinPath(vaultPath, 'public');
      const subSitemaps = await generateAllSitemaps({ domain, allIndices, vaultPath, dryRun });
      const rootPages = rootContentIndex.pages;
      const sitemapUrls = rootPages.length > 0 ? mapPagesToSitemapUrls({ pages: rootPages, domain }) : [];

      if (subSitemaps.length === 0) {
        if (sitemapUrls.length > 0) {
          const sitemapContent = generateSitemapXml(sitemapUrls);
          const sitemapPath = deps.joinPath(publicBaseDir, deps.sitemapXml);
          await writeSitemapFile({
            fullPath: sitemapPath,
            relPath: `public/${deps.sitemapXml}`,
            content: sitemapContent,
            dryRun,
            label: 'sitemap',
          });
        }
        return;
      }

      const sitemaps = [];

      if (sitemapUrls.length > 0) {
        const sitemapContent = generateSitemapXml(sitemapUrls);
        const sitemapPath = deps.joinPath(publicBaseDir, deps.sitemapPagesXml);
        await writeSitemapFile({
          fullPath: sitemapPath,
          relPath: `public/${deps.sitemapPagesXml}`,
          content: sitemapContent,
          dryRun,
          label: 'root pages sitemap',
        });
        sitemaps.push({ loc: `https://${domain}/${deps.sitemapPagesXml}` });
      }

      for (const subSitemap of subSitemaps) {
        sitemaps.push({ loc: `https://${domain}/${subSitemap}` });
      }

      if (sitemaps.length > 0) {
        const sitemapIndexContent = generateSitemapIndexXml(sitemaps);
        const sitemapIndexPath = deps.joinPath(publicBaseDir, deps.sitemapXml);
        await writeSitemapFile({
          fullPath: sitemapIndexPath,
          relPath: `public/${deps.sitemapXml}`,
          content: sitemapIndexContent,
          dryRun,
          label: 'master sitemap index',
        });
      }
    },
  };
}

const defaultSitemapGenerator = createSitemapGenerator({
  mkdir,
  writeFile,
  joinPath: path.join,
  indexSlug: INDEX_SLUG,
  sitemapXml: SITEMAP_XML,
  sitemapPagesXml: SITEMAP_PAGES_XML,
  logger: console,
});

export const mapPagesToSitemapUrls = defaultSitemapGenerator.mapPagesToSitemapUrls;
export const writeSitemapFile = defaultSitemapGenerator.writeSitemapFile;
export const generateAllSitemaps = defaultSitemapGenerator.generateAllSitemaps;
export const generateSitemaps = defaultSitemapGenerator.generateSitemaps;
