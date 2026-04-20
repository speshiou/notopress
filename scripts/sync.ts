import { select } from '@inquirer/prompts';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, unlinkSync, opendirSync } from 'fs';
import { execSync } from 'child_process';
import { join, basename, extname, relative } from 'path';
import { getRegistry } from '../src/lib/registry';


interface PostMetadata {
  title: string;
  slug: string;
  date: string;
  excerpt: string;
}

function scanMarkdownFiles(dir: string, baseDir: string = dir): PostMetadata[] {
  const posts: PostMetadata[] = [];

  function walk(currentDir: string) {
    const entries = readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== '.git' && entry.name !== 'node_modules') {
          walk(fullPath);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const content = readFileSync(fullPath, 'utf-8');
        const stats = statSync(fullPath);

        // Extract Title: First H1
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1].trim() : entry.name;

        // Extract Slug: relative path without extension
        const relPath = relative(baseDir, fullPath);
        const slug = join(
          relPath.slice(0, relPath.length - extname(relPath).length)
        );

        // Date: last modified time
        const date = stats.mtime.toISOString();

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

        posts.push({ title, slug, date, excerpt });
      }
    }
  }

  walk(dir);

  // Sort by date descending
  return posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function generateIndex(vaultPath: string, dryRun: boolean = false) {
  const postsBaseDir = join(vaultPath, 'posts');

  if (existsSync(postsBaseDir)) {
    // Legacy behavior: Get all locale directories (en, ja, zh-hant, etc.)
    const locales = readdirSync(postsBaseDir).filter(dir => {
      return statSync(join(postsBaseDir, dir)).isDirectory();
    });

    if (locales.length > 0) {
      for (const locale of locales) {
        const postsDir = join(postsBaseDir, locale);
        const posts = scanMarkdownFiles(postsDir);

        if (posts.length === 0) continue;

        const indexPath = join(postsDir, 'index.json');
        if (dryRun) {
          console.log(`[DRY RUN] Would generate [${locale}] index with ${posts.length} posts at: ${indexPath}`);
        } else {
          writeFileSync(indexPath, JSON.stringify(posts, null, 2));
          console.log(`✨ Generated [${locale}] index with ${posts.length} posts at: ${indexPath}`);
        }
      }
      return;
    }
  }

  // New behavior: scan vault root if no posts/locale structure
  console.log(`\n🔍 Scanning vault root for markdown files in ${vaultPath}...`);
  const posts = scanMarkdownFiles(vaultPath);

  if (posts.length > 0) {
    const indexPath = join(vaultPath, 'index.json');
    if (dryRun) {
      console.log(`[DRY RUN] Would generate vault index with ${posts.length} posts at: ${indexPath}`);
    } else {
      writeFileSync(indexPath, JSON.stringify(posts, null, 2));
      console.log(`✨ Generated vault index with ${posts.length} posts at: ${indexPath}`);
    }
  } else {
    console.warn(`⚠️  No markdown files found in vault: ${vaultPath}. Skipping index generation.`);
  }
}

async function main() {
  const registry = getRegistry();
  const isDryRun = process.argv.includes('--dry-run');

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

  if (!existsSync(site.vaultPath)) {
    console.error(`⨯ Error: The local vaultPath does not exist: ${site.vaultPath}`);
    process.exit(1);
  }

  // Generate index.json at the vault root before syncing
  generateIndex(site.vaultPath, isDryRun);

  const accountId = registry.accountId || process.env.R2_ACCOUNT_ID;
  const accessKeyId = registry.accessKeyId || process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = registry.secretAccessKey || process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    console.error('⨯ Error: Missing R2 credentials. Please provide them in registry.json or via environment variables (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY).');
    process.exit(1);
  }

  console.log(`\n☁️  Preparing AWS S3 Sync to Cloudflare R2...`);
  console.log(`- Local Path: ${site.vaultPath}`);
  console.log(`- R2 Bucket:  ${site.bucketName}`);
  console.log(`- Account ID: ${accountId}\n`);

  try {
    // We add a trailing slash to the vaultPath so that aws s3 sync syncs the *contents* of the directory
    // and not the directory itself.
    // Each site is synced to its own subdirectory in the bucket: /{site-id}/*
    const syncCommand = [
      'aws s3 sync',
      `"${site.vaultPath}/"`,
      `"s3://${site.bucketName}/${site.siteId}/"`,
      `--endpoint-url "https://${accountId}.r2.cloudflarestorage.com"`,
      `--exclude "*.DS_Store"`,
      `--exclude "*/.git/*"`,
      `--exclude ".git/*"`,
      `--delete`, // Automatically delete remote files that don't exist locally
      isDryRun ? '--dryrun' : ''
    ].filter(Boolean).join(' ');

    console.log(`Executing:\n> ${syncCommand}\n`);

    // stdio: 'inherit' passes the aws-cli output directly to our terminal
    execSync(syncCommand, {
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

      const registryTmpPath = join(process.cwd(), 'registry.sanitized.json');
      writeFileSync(registryTmpPath, JSON.stringify(sanitizedRegistry, null, 2));

      const uploadRegistryCommand = [
        'aws s3 cp',
        `"${registryTmpPath}"`,
        `"s3://${site.bucketName}/registry.json"`,
        `--endpoint-url "https://${accountId}.r2.cloudflarestorage.com"`,
      ].join(' ');

      execSync(uploadRegistryCommand, {
        stdio: 'inherit',
        env: {
          ...process.env,
          AWS_ACCESS_KEY_ID: accessKeyId,
          AWS_SECRET_ACCESS_KEY: secretAccessKey
        }
      });

      unlinkSync(registryTmpPath);

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
