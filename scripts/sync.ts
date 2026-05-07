import { select } from '@inquirer/prompts';
import { readFile, writeFile, readdir, stat, unlink, access } from 'fs/promises';
import { constants } from 'fs';
import { spawn } from 'child_process';
import { join, relative } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { getRegistry } from '../src/lib/registry';
import { env } from '../src/lib/env';
import { INDEX_JSON, INDEX_SLUG } from '../src/lib/constants';
import { PageMetadata, VaultIndex } from '../src/lib/vault';
import { hasFlag, getFlagValue } from '../src/lib/cli';

async function exists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function execAsync(command: string, options: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { ...options, shell: true });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
    child.on('error', (err) => reject(err));
  });
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
        files.push(relPath);
      }
    }
  }

  await walk(dir);
  return files;
}

async function scanMarkdownFiles(dir: string, baseDir: string = dir): Promise<PageMetadata[]> {
  const pages: PageMetadata[] = [];

  async function walk(currentDir: string) {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== '.git' && entry.name !== 'node_modules') {
          await walk(fullPath);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const content = await readFile(fullPath, 'utf-8');
        const fileStats = await stat(fullPath);

        // Extract Title: First H1
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1].trim() : entry.name;

        // Extract Slug: relative path without extension
        const relPath = relative(baseDir, fullPath);
        const slug = relPath.replace(/\.md$/, '');

        // Date: last modified time
        const date = fileStats.mtime.toISOString();

        // Excerpt: First non-title, non-empty paragraph (truncated)
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

        pages.push({ title, slug, date, excerpt });
      }
    }
  }

  await walk(dir);

  // Sort by date descending
  return pages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

async function generateIndex(vaultPath: string, dryRun: boolean = false) {
  const publicBaseDir = join(vaultPath, 'public');
  const publicFiles = await exists(publicBaseDir) ? await scanPublicFiles(publicBaseDir) : [];

  const contentDir = join(vaultPath, 'content');
  if (!(await exists(contentDir))) {
    throw new Error(`⨯ Error: The required "content" directory is missing in the vault: ${vaultPath}`);
  }

  // Scan content directory for markdown files
  console.log(`\n🔍 Scanning vault "content" directory for markdown files in ${contentDir}...`);
  const pages = await scanMarkdownFiles(contentDir);

  const hasRootPage = pages.some(p => p.slug === INDEX_SLUG);
  if (!hasRootPage) {
    console.warn(`⚠️  Warning: No root content page found at content/${INDEX_SLUG}.md. The site home page will fallback to a collection view of all pages.`);
  }

  if (pages.length > 0 || publicFiles.length > 0) {
    const indexPath = join(vaultPath, INDEX_JSON);
    const vaultIndex: VaultIndex = {
      version: 1,
      pages,
      publicFiles,
    };

    if (dryRun) {
      console.log(`[DRY RUN] Would generate vault index with ${pages.length} pages and ${publicFiles.length} public files at: ${indexPath}`);
    } else {
      await writeFile(indexPath, JSON.stringify(vaultIndex, null, 2));
      console.log(`✨ Generated vault index with ${pages.length} pages and ${publicFiles.length} public files at: ${indexPath}`);
    }
  } else {
    console.warn(`⚠️  No markdown files or public files found in vault: ${vaultPath}. Skipping index generation.`);
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

  // Generate index.json at the vault root before syncing
  await generateIndex(site.vaultPath, isDryRun);

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
