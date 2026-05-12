import { select } from '@inquirer/prompts';
import matter from 'gray-matter';
import { z } from 'zod';
import { readFile, writeFile, readdir, stat, unlink, access, mkdir } from 'fs/promises';
import { constants } from 'fs';
import { spawn, SpawnOptions } from 'child_process';
import { join, relative } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { getRegistry } from '../src/lib/registry';
import { env } from '../src/lib/env';
import { INDEX_JSON, ROOT_JSON, INDEX_SLUG, SITEMAP_XML, SITEMAP_PAGES_XML } from '../src/lib/constants';
import { PageMetadata, VaultDirectoryIndex, VaultRootIndex } from '../src/lib/vault';
import { hasFlag, getFlagValue } from '../src/lib/cli';
import { Registry, Site } from '../src/domain/registry';

async function exists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function execAsync({
  command,
  args,
  options,
}: {
  command: string;
  args: string[];
  options: SpawnOptions;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    // shell: false is more secure and robust against special characters
    const child = spawn(command, args, { ...options, shell: false });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command "${command} ${args.join(' ')}" failed with code ${code}`));
    });
    child.on('error', (err) => reject(err));
  });
}

const DateInputSchema = z.union([z.string(), z.number(), z.date()]);

function parseSafeDate({
  dateInput,
  fallback,
  label,
  filePath,
}: {
  dateInput: unknown;
  fallback: Date;
  label: string;
  filePath: string;
}): string {
  if (!dateInput) return fallback.toISOString();

  const result = DateInputSchema.safeParse(dateInput);
  if (!result.success) {
    console.warn(
      `⚠️  Warning: Invalid ${label} type for "${dateInput}" in ${filePath}. Falling back to file modification time.`
    );
    return fallback.toISOString();
  }

  const date = new Date(result.data);
  if (isNaN(date.getTime())) {
    console.warn(
      `⚠️  Warning: Invalid ${label} value "${dateInput}" in ${filePath}. Falling back to file modification time.`
    );
    return fallback.toISOString();
  }

  return date.toISOString();
}

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

function mapPagesToSitemapUrls({
  pages,
  domain,
  relDir = '',
}: {
  pages: PageMetadata[];
  domain: string;
  relDir?: string;
}) {
  return pages.map((p) => {
    const urlPath = p.slug === INDEX_SLUG ? relDir : relDir ? `${relDir}/${p.slug}` : p.slug;
    return {
      loc: `https://${domain}/${urlPath}`,
      lastmod: p.updatedAt || p.date,
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
    const dir = join(fullPath, '..');
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, content);
    console.log(`✨ Generated ${label} at ${relPath}`);
  } else {
    console.log(`[DRY RUN] Would generate ${label} at ${relPath}`);
  }
}

async function scanPublicFiles({ dir, baseDir = dir }: { dir: string; baseDir?: string }): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string) {
    if (!(await exists(currentDir))) return;
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== '.git' && entry.name !== 'node_modules') {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const relPath = relative(baseDir, fullPath);
        files.push(relPath.replace(/\\/g, '/'));
      }
    }
  }

  await walk(dir);
  return files;
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
    if (relDir === '') continue; // Skip root, handled separately
    if (indexData.pages.length === 0) continue;

    const sitemapUrls = mapPagesToSitemapUrls({ pages: indexData.pages, domain, relDir });
    const sitemapContent = generateSitemapXml(sitemapUrls);
    const sitemapPath = join(vaultPath, 'public', relDir, SITEMAP_XML);
    const relSitemapPath = `public/${relDir}/${SITEMAP_XML}`;

    await writeSitemapFile({
      fullPath: sitemapPath,
      relPath: relSitemapPath,
      content: sitemapContent,
      dryRun,
      label: `sitemap for "${relDir}"`,
    });
    subSitemaps.push(`${relDir}/${SITEMAP_XML}`);
  }
  return subSitemaps;
}

async function scanAndGenerate({
  dir,
  baseDir,
  dryRun,
  allIndices,
}: {
  dir: string;
  baseDir: string;
  dryRun: boolean;
  allIndices: Map<string, VaultDirectoryIndex>;
}): Promise<{ index: VaultDirectoryIndex; allDirs: string[] }> {
  const entries = await readdir(dir, { withFileTypes: true });
  const pages: PageMetadata[] = [];
  let allDirs: string[] = [];

  const relDir = relative(baseDir, dir).replace(/\\/g, '/');

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== '.git' && entry.name !== 'node_modules') {
        const result = await scanAndGenerate({ dir: fullPath, baseDir, dryRun, allIndices });

        const childRelDir = relative(baseDir, fullPath).replace(/\\/g, '/');
        allDirs.push(childRelDir, ...result.allDirs);
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const fileContent = await readFile(fullPath, 'utf-8');
      const fileStats = await stat(fullPath);

      const { data, content } = matter(fileContent);

      if (data.published === false) {
        continue;
      }

      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title =
        typeof data.title === 'string' && data.title.trim() !== ''
          ? data.title
          : titleMatch
          ? titleMatch[1].trim()
          : entry.name;

      const relPath = relative(dir, fullPath);
      const slug = relPath.replace(/\.md$/, '').replace(/\\/g, '/');

      const date = parseSafeDate({ dateInput: data.date, fallback: fileStats.mtime, label: 'date', filePath: relPath });
      const manualUpdate = data.updated || data.lastmod;
      const updatedAt = parseSafeDate({
        dateInput: manualUpdate,
        fallback: fileStats.mtime,
        label: 'updated',
        filePath: relPath,
      });

      const firstParagraph = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && !line.startsWith('>'))[0];

      let excerpt = '';
      if (firstParagraph) {
        excerpt = firstParagraph.slice(0, 160);
        if (firstParagraph.length > 160) {
          excerpt += '...';
        }
      }

      pages.push({ title, slug, date, updatedAt, excerpt });
    }
  }

  pages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const indexData: VaultDirectoryIndex = {
    version: 1,
    pages,
  };

  const indexPath = join(dir, INDEX_JSON);
  const relDirName = relDir || 'root';

  if (!dryRun) {
    await writeFile(indexPath, JSON.stringify(indexData, null, 2));
    console.log(`✨ Generated index for "${relDirName}"`);
  }

  allIndices.set(relDir, indexData);

  return { index: indexData, allDirs };
}

async function selectSite(registry: Registry): Promise<Site> {
  const siteId = await select({
    message: 'Select a site to sync using AWS CLI:',
    choices: registry.sites.map((site) => ({
      name: `${site.siteId} (${site.domain || 'no domain'})`,
      value: site.siteId,
      description: `Vault: ${site.vaultPath} -> Bucket: ${site.bucketName || 'Not configured'}`,
    })),
  });

  const site = registry.sites.find((s) => s.siteId === siteId);
  if (!site) {
    console.error('⨯ Site not found in registry.json');
    process.exit(1);
  }

  if (!site.bucketName) {
    console.error(`⨯ Error: "bucketName" is not configured for site [${site.siteId}] in registry.json`);
    process.exit(1);
  }

  if (!(await exists(site.vaultPath))) {
    console.error(`⨯ Error: The local vaultPath does not exist: ${site.vaultPath}`);
    process.exit(1);
  }

  return site;
}

async function syncSite({ site, registry, isDryRun }: { site: Site; registry: Registry; isDryRun: boolean }) {
  const endpoint = site.endpoint || registry.endpoint || env.S3_ENDPOINT;
  const accessKeyId = registry.accessKeyId || env.S3_ACCESS_KEY_ID;
  const secretAccessKey = registry.secretAccessKey || env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    console.error(
      '⨯ Error: Missing S3 credentials. Please provide them in registry.json or via environment variables (S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY).'
    );
    process.exit(1);
  }

  console.log(`\n☁️  Preparing AWS S3 Sync...`);
  console.log(`- Local Path: ${site.vaultPath}`);
  console.log(`- S3 Bucket:  ${site.bucketName}`);
  console.log(`- Endpoint:   ${endpoint}\n`);

  // We add a trailing slash to the vaultPath so that aws s3 sync syncs the *contents* of the directory
  // and not the directory itself.
  // Each site is synced to its own subdirectory in the bucket: /{site-id}/*
  const args = [
    's3',
    'sync',
    `${site.vaultPath}/`,
    `s3://${site.bucketName}/${site.siteId}/`,
    '--endpoint-url',
    endpoint,
    '--exclude',
    '*.DS_Store',
    '--exclude',
    '*/.git/*',
    '--exclude',
    '.git/*',
    '--delete',
  ];

  if (isDryRun) {
    args.push('--dryrun');
  }

  console.log(`Executing:\n> aws ${args.join(' ')}\n`);

  // stdio: 'inherit' passes the aws-cli output directly to our terminal
  await execAsync({
    command: 'aws',
    args,
    options: {
      stdio: 'inherit',
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: accessKeyId,
        AWS_SECRET_ACCESS_KEY: secretAccessKey,
      },
    },
  });
}

async function uploadRegistry({ site, registry }: { site: Site; registry: Registry }) {
  const endpoint = site.endpoint || registry.endpoint || env.S3_ENDPOINT;
  const accessKeyId = registry.accessKeyId || env.S3_ACCESS_KEY_ID;
  const secretAccessKey = registry.secretAccessKey || env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) return;

  console.log('\n✨ Uploading sanitized registry.json to bucket root...');

  // Sanitize registry: remove sensitive credentials and local vault paths
  const sanitizedSites = registry.sites
    .filter((s) => s.bucketName === site.bucketName)
    .map((s) => ({
      domain: s.domain,
      siteId: s.siteId,
      // vaultPath is omitted or can be a placeholder
    }));

  const sanitizedRegistry = {
    sites: sanitizedSites,
  };

  const registryTmpPath = join(tmpdir(), `notopress-registry-${randomUUID()}.json`);
  try {
    await writeFile(registryTmpPath, JSON.stringify(sanitizedRegistry, null, 2));

    const args = ['s3', 'cp', registryTmpPath, `s3://${site.bucketName}/registry.json`, '--endpoint-url', endpoint];

    await execAsync({
      command: 'aws',
      args,
      options: {
        stdio: 'inherit',
        env: {
          ...process.env,
          AWS_ACCESS_KEY_ID: accessKeyId,
          AWS_SECRET_ACCESS_KEY: secretAccessKey,
        },
      },
    });
  } finally {
    if (await exists(registryTmpPath)) {
      await unlink(registryTmpPath);
    }
  }
}

async function generateIndices({
  vaultPath,
  dryRun = false,
}: {
  vaultPath: string;
  dryRun?: boolean;
}): Promise<{ rootContentIndex: VaultDirectoryIndex; allIndices: Map<string, VaultDirectoryIndex> }> {
  const contentDir = join(vaultPath, 'content');
  if (!(await exists(contentDir))) {
    console.error(`⨯ Error: The required "content" directory is missing in the vault: ${vaultPath}`);
    process.exit(1);
  }

  // 1. Recursive generation of index.json for each level in content/
  console.log(`\n🔍 Recursively scanning "content" directory in ${contentDir}...`);
  const allIndices = new Map<string, VaultDirectoryIndex>();
  const { index: rootContentIndex, allDirs } = await scanAndGenerate({
    dir: contentDir,
    baseDir: contentDir,
    dryRun,
    allIndices,
  });

  const publicBaseDir = join(vaultPath, 'public');
  if (!dryRun) {
    await mkdir(publicBaseDir, { recursive: true });
  }

  const publicFiles = (await exists(publicBaseDir)) ? await scanPublicFiles({ dir: publicBaseDir }) : [];

  // 2. Generate root.json at vault root pointing to top-level content
  const rootPath = join(vaultPath, ROOT_JSON);
  const vaultRootIndex: VaultRootIndex = {
    ...rootContentIndex,
    directories: allDirs, // root.json contains the full directory map
    publicFiles,
  };

  if (dryRun) {
    console.log(`[DRY RUN] Would generate master root index at: ${rootPath}`);
  } else {
    await writeFile(rootPath, JSON.stringify(vaultRootIndex, null, 2));
    console.log(`✨ Generated master root index with ${allDirs.length} directories at: ${rootPath}`);
  }

  return { rootContentIndex, allIndices };
}

async function generateSitemaps({
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
    console.log('ℹ️  Skipping sitemap generation because "domain" is not configured in registry.json');
    return;
  }

  const publicBaseDir = join(vaultPath, 'public');
  const subSitemaps = await generateAllSitemaps({ domain, allIndices, vaultPath, dryRun });
  const rootPages = rootContentIndex.pages;
  const sitemapUrls = rootPages.length > 0 ? mapPagesToSitemapUrls({ pages: rootPages, domain }) : [];

  if (subSitemaps.length === 0) {
    // Case 1: No sub-sitemaps, write root pages to sitemap.xml directly
    if (sitemapUrls.length > 0) {
      const sitemapContent = generateSitemapXml(sitemapUrls);
      const sitemapPath = join(publicBaseDir, SITEMAP_XML);
      await writeSitemapFile({
        fullPath: sitemapPath,
        relPath: `public/${SITEMAP_XML}`,
        content: sitemapContent,
        dryRun,
        label: 'sitemap',
      });
    }
  } else {
    // Case 2: Sub-sitemaps exist, sitemap.xml should be an index
    const sitemaps = [];

    if (sitemapUrls.length > 0) {
      const sitemapContent = generateSitemapXml(sitemapUrls);
      const sitemapPath = join(publicBaseDir, SITEMAP_PAGES_XML);
      await writeSitemapFile({
        fullPath: sitemapPath,
        relPath: `public/${SITEMAP_PAGES_XML}`,
        content: sitemapContent,
        dryRun,
        label: 'root pages sitemap',
      });
      sitemaps.push({ loc: `https://${domain}/${SITEMAP_PAGES_XML}` });
    }

    for (const subSitemap of subSitemaps) {
      sitemaps.push({ loc: `https://${domain}/${subSitemap}` });
    }

    if (sitemaps.length > 0) {
      const sitemapIndexContent = generateSitemapIndexXml(sitemaps);
      const sitemapIndexPath = join(publicBaseDir, SITEMAP_XML);
      await writeSitemapFile({
        fullPath: sitemapIndexPath,
        relPath: `public/${SITEMAP_XML}`,
        content: sitemapIndexContent,
        dryRun,
        label: 'master sitemap index',
      });
    }
  }
}

async function main() {
  const isDryRun = hasFlag({ flag: '--dry-run' });
  const registryPath = getFlagValue({ flag: '--registry', alias: '-r' });

  try {
    const registry = await getRegistry(registryPath);

    if (isDryRun) {
      console.log('\n🏜️  DRY RUN MODE ENABLED - No changes will be made.');
    }

    const site = await selectSite(registry);

    // Generate index files at every level and root.json at the vault root
    const { rootContentIndex, allIndices } = await generateIndices({ vaultPath: site.vaultPath, dryRun: isDryRun });

    // Generate sitemaps based on the collected indices
    await generateSitemaps({
      vaultPath: site.vaultPath,
      domain: site.domain,
      rootContentIndex,
      allIndices,
      dryRun: isDryRun,
    });

    await syncSite({ site, registry, isDryRun });

    if (isDryRun) {
      console.log('\n✅ Dry run completed successfully!');
    } else {
      await uploadRegistry({ site, registry });
      console.log('\n✅ Sync and registry upload successfully completed!');
    }
  } catch (err: unknown) {
    console.error(`\n⨯ ${isDryRun ? 'Dry run' : 'Sync process'} failed.`);
    if (err instanceof Error) {
      console.error(err.message);
    } else {
      console.error('An unknown error occurred:');
      console.error(err);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error("An unexpected error occurred:", err);
  process.exit(1);
});
