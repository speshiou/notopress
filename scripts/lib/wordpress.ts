import { readFile } from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { getAssetSubDir } from './files';
import { Site, Registry } from '../../src/domain/registry';
import { VaultDirectoryIndex } from '../../src/lib/vault';
import { renderMarkdownContent } from '../../src/lib/markdown';
import { getThumbnailPath, normalizeThumbnailSizes, getAssetUrl } from '../../src/lib/responsive-images';

interface PushToWordPressArgs {
  site: Site;
  registry: Registry;
  allIndices: Map<string, VaultDirectoryIndex>;
  targetPostSlug?: string;
  dryRun: boolean;
}

interface WpFetchArgs {
  endpoint: string;
  credentials: { username: string; applicationPassword: string };
  path: string;
  method?: string;
  body?: any;
}

/**
 * Performs authenticated requests to the WordPress REST API.
 */
async function wpFetch({
  endpoint,
  credentials,
  path: apiPath,
  method = 'GET',
  body,
}: WpFetchArgs) {
  const url = `${endpoint.replace(/\/+$/, '')}${apiPath}`;
  const auth = Buffer.from(`${credentials.username}:${credentials.applicationPassword}`).toString('base64');

  const headers: Record<string, string> = {
    'Authorization': `Basic ${auth}`,
  };

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`WordPress API error (${response.status}): ${errorText || response.statusText}`);
  }

  return response.json();
}

/**
 * Parses HTML and replaces all local image source references with their absolute 
 * URL on the designated image host, utilizing the largest generated thumbnail size.
 */
export async function replaceLocalImagesWithThumbnails({
  html,
  site,
  registry,
  sizes,
}: {
  html: string;
  site: Site;
  registry: Registry;
  sizes: readonly number[];
}): Promise<string> {
  const imageHost = site.imageHost || registry.imageHost;
  const largestWidth = sizes[sizes.length - 1];

  if (!largestWidth) {
    return html;
  }

  let processedHtml = html;

  // Process HTML <img> tags
  const imgRegex = /<img\s+([^>]*src=["']([^"']+)["'][^>]*?)>/gi;
  const matches: { fullMatch: string; src: string }[] = [];
  let match;
  while ((match = imgRegex.exec(processedHtml)) !== null) {
    matches.push({ fullMatch: match[0], src: match[2] });
  }

  for (const { fullMatch, src } of matches) {
    // Skip external or inline assets
    if (
      src.startsWith('http://') ||
      src.startsWith('https://') ||
      src.startsWith('data:') ||
      src.startsWith('#')
    ) {
      continue;
    }

    const cleanSrc = src.replace(/^\//, '');
    const decodedSrc = decodeURIComponent(cleanSrc);

    // Get the thumbnail filename and relative directory path
    const thumbPath = getThumbnailPath({ imagePath: decodedSrc, width: largestWidth });

    // Determine target location in S3 by checking local filesystem existence
    const s3SubDir = await getAssetSubDir({ vaultPath: site.vaultPath, filePath: thumbPath });

    // Build the absolute URL on the configured imageHost
    const absoluteUrl = getAssetUrl({
      imageHost,
      siteId: site.siteId,
      s3SubDir,
      filePath: thumbPath,
      domain: site.domain,
    });

    // Preserve the alt text attribute if present and use it as a caption
    const altMatch = fullMatch.match(/alt=["']([^"']*)["']/i);
    const altText = altMatch ? altMatch[1] : '';
    const altAttr = altText ? ` alt="${altText}"` : '';
    const figcaption = altText ? `<figcaption>${altText}</figcaption>` : '';
    const newImgTag = `<figure class="wp-block-image"><img src="${encodeURI(absoluteUrl)}"${altAttr} />${figcaption}</figure>`;

    processedHtml = processedHtml.replaceAll(fullMatch, newImgTag);
  }

  return processedHtml;
}

/**
 * Iterates through the Markdown posts in the vault and publishes them to WordPress.
 */
export async function pushToWordPress({
  site,
  registry,
  allIndices,
  targetPostSlug,
  dryRun,
}: PushToWordPressArgs) {
  const credentials = site.wordpress;
  if (!credentials) {
    throw new Error(`⨯ WordPress credentials are not configured for site [${site.siteId}].`);
  }

  const endpoint = credentials.endpoint || `https://${site.domain}/wp-json`;
  const sizes = normalizeThumbnailSizes(site.thumbnailSizes || registry.thumbnailSizes);

  console.log(`\n📝 Preparing WordPress Publishing...`);
  console.log(`- Target Endpoint: ${endpoint}`);
  console.log(`- Authenticated As: ${credentials.username}`);
  if (targetPostSlug) {
    console.log(`- Target Single Post: ${targetPostSlug}`);
  }
  console.log(dryRun ? `- Mode: DRY RUN (No changes will be written)\n` : `- Mode: Live Sync\n`);

  // Load public files from root.json if it exists
  let publicFiles: string[] = [];
  try {
    const rootIndexRaw = await readFile(path.join(site.vaultPath, 'root.json'), 'utf-8');
    const rootIndex = JSON.parse(rootIndexRaw);
    publicFiles = rootIndex.publicFiles || [];
  } catch (err) {
    // If root.json is not found or not yet generated, fallback to empty array
  }

  // Collect all posts from directory indices
  const postsToPublish: { localPath: string; slug: string; title: string; date: string }[] = [];

  for (const [dirKey, dirIndex] of allIndices.entries()) {
    for (const page of dirIndex.pages) {
      // Build the full hierarchical slug
      const fullSlug = dirKey ? `${dirKey}/${page.slug}` : page.slug;

      // Filter by target post slug if specified
      if (targetPostSlug && fullSlug !== targetPostSlug) {
        continue;
      }

      const localPath = path.join(site.vaultPath, 'content', dirKey, `${page.slug}.md`);
      postsToPublish.push({
        localPath,
        slug: fullSlug,
        title: page.title,
        date: page.date,
      });
    }
  }

  if (targetPostSlug && postsToPublish.length === 0) {
    throw new Error(`⨯ Could not find any post in the vault matching slug: "${targetPostSlug}"`);
  }

  console.log(`Found ${postsToPublish.length} post(s) to process.`);

  for (const post of postsToPublish) {
    try {
      console.log(`\nSyncing "${post.title}" (slug: ${post.slug})...`);

      // Read markdown and parse frontmatter
      const fileContent = await readFile(post.localPath, 'utf-8');
      const { content: markdownBody } = matter(fileContent);

      // Strip first H1 from markdown to avoid duplicated titles
      const bodyWithoutTitle = markdownBody.replace(/^#\s+.+$/m, '').trim();

      // Render Markdown content to HTML
      let htmlContent = await renderMarkdownContent({
        markdown: bodyWithoutTitle,
        thumbnailSizes: sizes,
        publicFiles,
      });

      // Replace local image paths with imageHost absolute thumbnail URLs
      htmlContent = await replaceLocalImagesWithThumbnails({
        html: htmlContent,
        site,
        registry,
        sizes,
      });

      // Search WordPress to see if the post already exists by slug
      const existingPosts = await wpFetch({
        endpoint,
        credentials,
        path: `/wp/v2/posts?slug=${encodeURIComponent(post.slug)}&status=any`,
      });

      const wpPostExists = existingPosts && existingPosts.length > 0;
      const wpPostId = wpPostExists ? existingPosts[0].id : null;

      const payload = {
        title: post.title,
        content: htmlContent,
        slug: post.slug,
        status: 'publish',
        date: post.date,
      };

      if (wpPostExists) {
        if (dryRun) {
          console.log(`  [DRY RUN] Would UPDATE WordPress post "${post.title}" (ID: ${wpPostId})`);
        } else {
          await wpFetch({
            endpoint,
            credentials,
            path: `/wp/v2/posts/${wpPostId}`,
            method: 'POST',
            body: payload,
          });
          console.log(`  ✅ Successfully UPDATED WordPress post (ID: ${wpPostId})`);
        }
      } else {
        if (dryRun) {
          console.log(`  [DRY RUN] Would CREATE new WordPress post "${post.title}"`);
        } else {
          const newPost = await wpFetch({
            endpoint,
            credentials,
            path: `/wp/v2/posts`,
            method: 'POST',
            body: payload,
          });
          console.log(`  ✅ Successfully CREATED new WordPress post (ID: ${newPost.id})`);
        }
      }
    } catch (err: any) {
      console.error(`  ❌ Failed to sync post "${post.title}":`, err.message);
      // We don't want to crash the whole sync if one post fails, but if single post targeted, we bubble up
      if (targetPostSlug) {
        throw err;
      }
    }
  }
}
