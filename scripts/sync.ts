import { select } from '@inquirer/prompts';
import matter from 'gray-matter';
import { readFile, writeFile, readdir, stat, unlink, access, mkdir } from 'fs/promises';
import { constants } from 'fs';
import { spawn } from 'child_process';
import { join, relative } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { getRegistry } from '../src/lib/registry';
import { env } from '../src/lib/env';
import { INDEX_JSON, ROOT_JSON, INDEX_SLUG } from '../src/lib/constants';
import { PageMetadata, VaultDirectoryIndex, VaultRootIndex } from '../src/lib/vault';
import { hasFlag, getFlagValue } from '../src/lib/cli';

async function exists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function execAsync(command: string, options: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { ...options, shell: true });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
    child.on('error', (err) => reject(err));
  });
}

function parseSafeDate(dateInput: any, fallback: Date, label: string, filePath: string): string {
  if (!dateInput) return fallback.toISOString();

  const date = new Date(dateInput);
  if (isNaN(date.getTime())) {
    console.warn(`⚠️  Warning: Invalid ${label} "${dateInput}" in ${filePath}. Falling back to file modification time.`);
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

async function scanPublicFiles(dir: string, baseDir: string = dir): Promise<string[]> {
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

async function scanAndGenerate(
  dir: string,
  baseDir: string,
  dryRun: boolean,
  domain: string,
  vaultPath: string,
  subSitemaps: string[]
): Promise<{ index: VaultDirectoryIndex; allDirs: string[] }> {
  const entries = await readdir(dir, { withFileTypes: true });
  const pages: PageMetadata[] = [];
  let allDirs: string[] = [];

  const relDir = relative(baseDir, dir).replace(/\\/g, '/');

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== '.git' && entry.name !== 'node_modules') {
        const result = await scanAndGenerate(fullPath, baseDir, dryRun, domain, vaultPath, subSitemaps);

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
      const title = (typeof data.title === 'string' && data.title.trim() !== '' ? data.title : (titleMatch ? titleMatch[1].trim() : entry.name));

      const relPath = relative(dir, fullPath);
      const slug = relPath.replace(/\.md$/, '').replace(/\\/g, '/');

      const date = parseSafeDate(data.date, fileStats.mtime, 'date', relPath);
      const manualUpdate = data.updated || data.lastmod;
      const updatedAt = parseSafeDate(manualUpdate, fileStats.mtime, 'updated', relPath);

      const firstParagraph = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && !line.startsWith('>'))
      [0];

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

  // Generate sitemap for this directory if it has pages and is NOT the root
  if (pages.length > 0 && relDir !== '') {
      const sitemapUrls = pages.map((p) => {
        const path = p.slug === INDEX_SLUG ? relDir : `${relDir}/${p.slug}`;
        return {
          loc: `https://${domain}/${path}`,
          lastmod: p.updatedAt || p.date,
        };
      });

      const sitemapContent = generateSitemapXml(sitemapUrls);
      const sitemapPath = join(vaultPath, 'public', relDir, 'sitemap.xml');
      const sitemapDir = join(vaultPath, 'public', relDir);

      if (!dryRun) {
        await mkdir(sitemapDir, { recursive: true });
        await writeFile(sitemapPath, sitemapContent);
        console.log(`✨ Generated sitemap for "${relDir}" at public/${relDir}/sitemap.xml`);
      } else {
        console.log(`[DRY RUN] Would generate sitemap for "${relDir}" at public/${relDir}/sitemap.xml`);
      }
      subSitemaps.push(`${relDir}/sitemap.xml`);
    }

  return { index: indexData, allDirs };
}

async function generateIndices(vaultPath: string, domain: string, dryRun: boolean = false) {
  const contentDir = join(vaultPath, 'content');
  if (!(await exists(contentDir))) {
    console.error(`⨯ Error: The required "content" directory is missing in the vault: ${vaultPath}`);
    process.exit(1);
  }

  // 1. Recursive generation of index.json for each level in content/
  console.log(`\n🔍 Recursively scanning "content" directory in ${contentDir}...`);
  const subSitemaps: string[] = [];
  const { index: rootContentIndex, allDirs } = await scanAndGenerate(
    contentDir,
    contentDir,
    dryRun,
    domain,
    vaultPath,
    subSitemaps
  );

  const publicBaseDir = join(vaultPath, 'public');
  if (!dryRun) {
    await mkdir(publicBaseDir, { recursive: true });
  }

  // Generate sitemaps
  const rootPages = rootContentIndex.pages;
  if (subSitemaps.length === 0) {
    // Case 1: No sub-sitemaps, write root pages to sitemap.xml directly
    if (rootPages.length > 0) {
      const sitemapUrls = rootPages.map((p) => {
        const path = p.slug === INDEX_SLUG ? '' : p.slug;
        return {
          loc: `https://${domain}/${path}`,
          lastmod: p.updatedAt || p.date,
        };
      });
      const sitemapContent = generateSitemapXml(sitemapUrls);
      const sitemapPath = join(publicBaseDir, 'sitemap.xml');
      if (!dryRun) {
        await writeFile(sitemapPath, sitemapContent);
        console.log(`✨ Generated sitemap at public/sitemap.xml`);
      } else {
        console.log(`[DRY RUN] Would generate sitemap at public/sitemap.xml`);
      }
    }
  } else {
    // Case 2: Sub-sitemaps exist, sitemap.xml should be an index
    const sitemaps = [];

    if (rootPages.length > 0) {
      const sitemapUrls = rootPages.map((p) => {
        const path = p.slug === INDEX_SLUG ? '' : p.slug;
        return {
          loc: `https://${domain}/${path}`,
          lastmod: p.updatedAt || p.date,
        };
      });
      const sitemapContent = generateSitemapXml(sitemapUrls);
      const sitemapPath = join(publicBaseDir, 'sitemap_pages.xml');
      if (!dryRun) {
        await writeFile(sitemapPath, sitemapContent);
        console.log(`✨ Generated root pages sitemap at public/sitemap_pages.xml`);
      } else {
        console.log(`[DRY RUN] Would generate root pages sitemap at public/sitemap_pages.xml`);
      }
      sitemaps.push({ loc: `https://${domain}/sitemap_pages.xml` });
    }

    for (const subSitemap of subSitemaps) {
      sitemaps.push({ loc: `https://${domain}/${subSitemap}` });
    }

    if (sitemaps.length > 0) {
      const sitemapIndexContent = generateSitemapIndexXml(sitemaps);
      const sitemapIndexPath = join(publicBaseDir, 'sitemap.xml');
      if (!dryRun) {
        await writeFile(sitemapIndexPath, sitemapIndexContent);
        console.log(`✨ Generated master sitemap index at public/sitemap.xml`);
      } else {
        console.log(`[DRY RUN] Would generate master sitemap index at public/sitemap.xml`);
      }
    }
  }
  const publicFiles = (await exists(publicBaseDir)) ? await scanPublicFiles(publicBaseDir) : [];

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
}

async function main() {
  const isDryRun = hasFlag({ flag: '--dry-run' });

  // Parse registry path from command line arguments
  const registryPath = getFlagValue({ flag: '--registry', alias: '-r' });

  const registry = await getRegistry(registryPath);

  if (isDryRun) {
    console.log('\n🏜️  DRY RUN MODE ENABLED - No changes will be made.');
  }

  const siteId = await select({
    message: 'Select a site to sync using AWS CLI:',
    choices: registry.sites.map(site => ({
      name: `${site.siteId} (${site.domain})`,
      value: site.siteId,
      description: `Vault: ${site.vaultPath} -> Bucket: ${site.bucketName || 'Not configured'}`,
    })),
  });

  const site = registry.sites.find(s => s.siteId === siteId);
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

  // Generate index files at every level and root.json at the vault root before syncing
  await generateIndices(site.vaultPath, site.domain, isDryRun);

  const endpoint = registry.endpoint || env.S3_ENDPOINT;
  const accessKeyId = registry.accessKeyId || env.S3_ACCESS_KEY_ID;
  const secretAccessKey = registry.secretAccessKey || env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    console.error('⨯ Error: Missing S3 credentials. Please provide them in registry.json or via environment variables (S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY).');
    process.exit(1);
  }

  console.log(`\n☁️  Preparing AWS S3 Sync...`);
  console.log(`- Local Path: ${site.vaultPath}`);
  console.log(`- S3 Bucket:  ${site.bucketName}`);
  console.log(`- Endpoint:   ${endpoint}\n`);

  try {
    // We add a trailing slash to the vaultPath so that aws s3 sync syncs the *contents* of the directory
    // and not the directory itself.
    // Each site is synced to its own subdirectory in the bucket: /{site-id}/*
    const syncCommand = [
      'aws s3 sync',
      `"${site.vaultPath}/"`,
      `"s3://${site.bucketName}/${site.siteId}/"`,
      `--endpoint-url "${endpoint}"`,
      `--exclude "*.DS_Store"`,
      `--exclude "*/.git/*"`,
      `--exclude ".git/*"`,
      `--delete`, // Automatically delete remote files that don't exist locally
      isDryRun ? '--dryrun' : ''
    ].filter(Boolean).join(' ');

    console.log(`Executing:\n> ${syncCommand}\n`);

    // stdio: 'inherit' passes the aws-cli output directly to our terminal
    await execAsync(syncCommand, {
      stdio: 'inherit',
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: accessKeyId,
        AWS_SECRET_ACCESS_KEY: secretAccessKey
      }
    });

    if (isDryRun) {
      console.log('\n✅ Dry run completed successfully!');
    } else {
      console.log('\n✨ Uploading sanitized registry.json to bucket root...');

      // Sanitize registry: remove sensitive credentials and local vault paths
      const sanitizedSites = registry.sites
        .filter(s => s.bucketName === site.bucketName)
        .map(s => ({
          domain: s.domain,
          siteId: s.siteId,
          // vaultPath is omitted or can be a placeholder
        }));

      const sanitizedRegistry = {
        sites: sanitizedSites
      };

      const registryTmpPath = join(tmpdir(), `notopress-registry-${randomUUID()}.json`);
      try {
        await writeFile(registryTmpPath, JSON.stringify(sanitizedRegistry, null, 2));

        const uploadRegistryCommand = [
          'aws s3 cp',
          `"${registryTmpPath}"`,
          `"s3://${site.bucketName}/registry.json"`,
          `--endpoint-url "${endpoint}"`,
        ].join(' ');

        await execAsync(uploadRegistryCommand, {
          stdio: 'inherit',
          env: {
            ...process.env,
            AWS_ACCESS_KEY_ID: accessKeyId,
            AWS_SECRET_ACCESS_KEY: secretAccessKey
          }
        });
      } finally {
        if (await exists(registryTmpPath)) {
          await unlink(registryTmpPath);
        }
      }

      console.log('\n✅ Sync and registry upload successfully completed!');
    }

  } catch (err: any) {
    console.error(`\n⨯ ${isDryRun ? 'Dry run' : 'Sync process'} failed.`);
    console.error(err.message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("An unexpected error occurred:", err);
  process.exit(1);
});
