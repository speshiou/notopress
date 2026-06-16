import { readFile } from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { getAssetSubDir } from './files';
import { Site, Registry } from '../../src/domain/registry';
import { VaultDirectoryIndex } from '../../src/lib/vault';
import { renderMarkdownContent } from '../../src/lib/markdown';
import { getThumbnailPath, normalizeThumbnailSizes, getAssetUrl, RESPONSIVE_IMAGE_SIZES } from '../../src/lib/responsive-images';


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
  body?: unknown;
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

  // Deduplicate matches to avoid redundant checks/replacements
  const uniqueMatches = Array.from(
    new Map(matches.map((m) => [m.fullMatch, m])).values()
  );

  for (const { fullMatch, src } of uniqueMatches) {
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

    // Build the srcset attributes for all defined thumbnail sizes
    const srcSetUrls = sizes.map((size) => {
      const sizeThumbPath = getThumbnailPath({ imagePath: decodedSrc, width: size });
      const sizeUrl = getAssetUrl({
        imageHost,
        siteId: site.siteId,
        s3SubDir,
        filePath: sizeThumbPath,
        domain: site.domain,
      });
      return `${encodeURI(sizeUrl)} ${size}w`;
    }).join(', ');

    let newImgTag = fullMatch;
    
    // Replace src in-place
    newImgTag = newImgTag.replace(/src=["']([^"']*)["']/i, `src="${encodeURI(absoluteUrl)}"`);

    // Inject/replace srcset and sizes in-place
    if (srcSetUrls) {
      newImgTag = setAttribute(newImgTag, 'srcset', srcSetUrls);
      newImgTag = setAttribute(newImgTag, 'sizes', `(max-width: ${largestWidth}px) 100vw, ${largestWidth}px`);
    }

    // Append/merge style style="max-width: 100%;"
    if (/style=["']/i.test(newImgTag)) {
      newImgTag = newImgTag.replace(/style=["']([^"']*)["']/i, (m, p1) => {
        const trimmed = p1.trim();
        const separator = trimmed.endsWith(';') || trimmed === '' ? '' : ';';
        return `style="${p1}${separator}max-width:100%;"`;
      });
    } else {
      newImgTag = newImgTag.replace(/(<img\b)/i, '$1 style="max-width:100%;"');
    }

    // Append loading="lazy" if not present
    if (!/loading=["']/i.test(newImgTag)) {
      newImgTag = newImgTag.replace(/(<img\b)/i, '$1 loading="lazy"');
    }

    // Append decoding="async" if not present
    if (!/decoding=["']/i.test(newImgTag)) {
      newImgTag = newImgTag.replace(/(<img\b)/i, '$1 decoding="async"');
    }

    processedHtml = processedHtml.replaceAll(fullMatch, newImgTag);
  }

  return processedHtml;
}

/**
 * Helper to inject or update an attribute inside an HTML tag.
 * Inserts the attribute right after '<img' to ensure self-closing tags are not broken.
 */
function setAttribute(tag: string, name: string, value: string): string {
  const regex = new RegExp(`${name}=["']([^"']*)["']`, 'i');
  if (regex.test(tag)) {
    return tag.replace(regex, `${name}="${value}"`);
  }
  return tag.replace(/(<img\b)/i, `$1 ${name}="${value}"`);
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

      // Strip first H1 from markdown to avoid duplicated titles, only if it's the first non-empty line of the document and not inside a code block
      const lines = markdownBody.split('\n');
      let inCodeBlock = false;
      let firstH1Index = -1;
      
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('```')) {
          inCodeBlock = !inCodeBlock;
        }
        if (!inCodeBlock && trimmed.startsWith('# ')) {
          firstH1Index = i;
          break;
        }
      }

      if (firstH1Index !== -1) {
        const hasContentBefore = lines.slice(0, firstH1Index).some(line => line.trim() !== '');
        if (!hasContentBefore) {
          lines.splice(firstH1Index, 1);
        }
      }
      const bodyWithoutTitle = lines.join('\n').trim();

      // Render Markdown content to HTML
      let htmlContent = await renderMarkdownContent({
        markdown: bodyWithoutTitle,
        thumbnailSizes: sizes,
        publicFiles,
        getFigureProperties: (largestWidth) => {
          return {
            class: 'wp-block-image',
            style: 'height: auto !important;',
          };
        },
      });

      // Replace local image paths with imageHost absolute thumbnail URLs
      htmlContent = await replaceLocalImagesWithThumbnails({
        html: htmlContent,
        site,
        registry,
        sizes,
      });

      // Replace slashes with hyphens to match WordPress's sanitization behavior
      const wpSlug = post.slug.replace(/\//g, '-');

      // Search WordPress to see if the post already exists by slug
      const existingPosts = await wpFetch({
        endpoint,
        credentials,
        path: `/wp/v2/posts?slug=${encodeURIComponent(wpSlug)}&status=any`,
      });

      const wpPostExists = existingPosts && existingPosts.length > 0;
      const wpPostId = wpPostExists ? existingPosts[0].id : null;

      const payload = {
        title: post.title,
        content: htmlContent,
        slug: wpSlug,
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
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ Failed to sync post "${post.title}":`, errMsg);
      // We don't want to crash the whole sync if one post fails, but if single post targeted, we bubble up
      if (targetPostSlug) {
        throw err;
      }
    }
  }
}
