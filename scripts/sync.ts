import { select } from '@inquirer/prompts';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, basename, extname } from 'path';
import { registry } from '../registry';

interface PostMetadata {
  title: string;
  slug: string;
  date: string;
  excerpt: string;
}

function generateIndex(vaultPath: string) {
  const postsBaseDir = join(vaultPath, 'posts');
  if (!existsSync(postsBaseDir)) {
    console.warn(`⚠️  Warning: "posts" directory not found in vault: ${postsBaseDir}. Skipping index generation.`);
    return;
  }

  // Get all locale directories (en, ja, zh-hant, etc.)
  const locales = readdirSync(postsBaseDir).filter(dir => {
    return statSync(join(postsBaseDir, dir)).isDirectory();
  });

  if (locales.length === 0) {
    console.warn(`⚠️  No locale directories found in ${postsBaseDir}`);
    return;
  }

  for (const locale of locales) {
    const postsDir = join(postsBaseDir, locale);
    const files = readdirSync(postsDir).filter(f => f.endsWith('.md'));
    
    if (files.length === 0) continue;

    console.log(`\n🔍 Scanning [${locale}] posts in ${postsDir}...`);
    const posts: PostMetadata[] = [];

    for (const file of files) {
      const filePath = join(postsDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const stats = statSync(filePath);

      // Extract Title: First H1
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : file;

      // Extract Slug: Filename without extension
      const slug = basename(file, extname(file));

      // Date: last modified time
      const date = stats.mtime.toISOString();

      // Excerpt: First non-title, non-empty paragraph (truncated)
      const excerpt = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && !line.startsWith('>'))
        [0]?.slice(0, 160) + '...' || '';

      posts.push({ title, slug, date, excerpt });
    }

    // Sort by date descending
    posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const indexPath = join(postsDir, 'index.json');
    writeFileSync(indexPath, JSON.stringify(posts, null, 2));
    console.log(`✨ Generated [${locale}] index with ${posts.length} posts at: ${indexPath}`);
  }
}

async function main() {
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
    console.error('⨯ Site not found in registry.ts');
    process.exit(1);
  }

  if (!site.bucketName) {
    console.error(`⨯ Error: "bucketName" is not configured for site [${site.siteId}] in registry.ts`);
    process.exit(1);
  }

  if (!existsSync(site.vaultPath)) {
    console.error(`⨯ Error: The local vaultPath does not exist: ${site.vaultPath}`);
    process.exit(1);
  }

  // Generate index.json at the vault root before syncing
  generateIndex(site.vaultPath);

  console.log(`\n☁️  Preparing AWS S3 Sync to Cloudflare R2...`);
  console.log(`- Local Path: ${site.vaultPath}`);
  console.log(`- R2 Bucket:  ${site.bucketName}`);
  console.log(`- Account ID: ${registry.accountId}\n`);

  try {
    // We add a trailing slash to the vaultPath so that aws s3 sync syncs the *contents* of the directory
    // and not the directory itself.
    const syncCommand = [
      'aws s3 sync',
      `"${site.vaultPath}/"`,
      `"s3://${site.bucketName}/"`,
      `--endpoint-url "https://${registry.accountId}.r2.cloudflarestorage.com"`,
      `--exclude "*.DS_Store"`,
      `--exclude "*/.git/*"`,
      `--exclude ".git/*"`,
      `--delete` // Automatically delete remote files that don't exist locally
    ].join(' ');

    console.log(`Executing:\n> ${syncCommand}\n`);
    
    // stdio: 'inherit' passes the aws-cli output directly to our terminal
    execSync(syncCommand, { 
      stdio: 'inherit',
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: registry.accessKeyId,
        AWS_SECRET_ACCESS_KEY: registry.secretAccessKey
      }
    });
    
    console.log('\n✅ Sync successfully completed!');

  } catch (err: unknown) {
    console.error('\n⨯ Sync process failed.');
    if (err instanceof Error) {
      console.error(err.message);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error("An unexpected error occurred:", err);
  process.exit(1);
});
