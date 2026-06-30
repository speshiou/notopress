import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
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

interface WpPost {
  id: number;
  date: string;
  modified: string;
  slug: string;
  title: {
    rendered: string;
  };
  content: {
    rendered: string;
  };
  status: string;
}

export function resolveAndCollectImagePath(
  src: string,
  site: Site,
  registry: Registry,
  collectedImages?: { remoteUrl: string; tryHighResUrl: string; localPath: string }[]
): string {
  // If it's a relative path already, just return it
  if (src.startsWith('/') && !src.startsWith('//') && !src.includes('/api/vault-public/') && !src.includes('_thumbnails/')) {
    return src;
  }

  let tempPath = src;
  let isExternal = false;
  const originalUrl = src;

  // Check if it is an external URL
  if (tempPath.startsWith('http://') || tempPath.startsWith('https://')) {
    try {
      const urlObj = new URL(tempPath);
      const isInternal = 
        tempPath.includes('_thumbnails/') || 
        tempPath.includes('/api/vault-public/') ||
        (site.domain && urlObj.hostname === site.domain) ||
        (site.imageHost && urlObj.hostname === new URL(site.imageHost).hostname) ||
        (registry.imageHost && urlObj.hostname === new URL(registry.imageHost).hostname);

      if (!isInternal) {
        isExternal = true;
      }
      tempPath = urlObj.pathname + urlObj.search + urlObj.hash;
    } catch {
      isExternal = true;
    }
  }

  // Remove leading slash
  tempPath = tempPath.replace(/^\//, '');

  // If it goes through api/vault-public
  if (tempPath.startsWith('api/vault-public/')) {
    tempPath = tempPath.substring('api/vault-public/'.length);
  }

  // If it has siteId prefix (e.g. test-blog/content/...)
  const siteIdPrefix = `${site.siteId}/`;
  if (tempPath.startsWith(siteIdPrefix)) {
    tempPath = tempPath.substring(siteIdPrefix.length);
    if (tempPath.startsWith('content/')) {
      tempPath = tempPath.substring('content/'.length);
    } else if (tempPath.startsWith('public/')) {
      tempPath = tempPath.substring('public/'.length);
    }
  }

  // Extract filename
  const filename = tempPath.split('/').pop() || '';
  if (!filename) return src;

  // Extract base name and extension to find original files
  const ext = path.extname(filename);
  const baseName = path.basename(filename, ext);
  const cleanBaseName = baseName.replace(/-(\d+x\d+|\d+)$/, '');
  const finalFilename = `${cleanBaseName}${ext}`;

  // Check if the file already exists locally
  const dir = path.dirname(tempPath);
  const candidateFolders = ['attachments', 'images', dir !== '.' ? dir : '', ''];
  const extensions = [ext, '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'];

  for (const folder of candidateFolders) {
    for (const curExt of extensions) {
      const checkFilename = `${cleanBaseName}${curExt}`;
      const relPath = folder ? `${folder}/${checkFilename}` : checkFilename;
      
      const publicPath = path.join(site.vaultPath, 'public', relPath);
      const contentPath = path.join(site.vaultPath, 'content', relPath);
      
      if (existsSync(publicPath)) {
        return `/${relPath}`;
      }
      if (existsSync(contentPath)) {
        return `/${relPath}`;
      }
    }
  }

  // If it contains _thumbnails, extract path
  const thumbIndex = tempPath.indexOf('_thumbnails/');
  if (thumbIndex !== -1) {
    tempPath = tempPath.substring(thumbIndex + '_thumbnails/'.length);
    const match = tempPath.match(/(.+)-\d+\.webp$/);
    const pathWithoutThumbExt = match ? match[1] : tempPath.replace(/\.[^/.]+$/, "");

    for (const curExt of extensions) {
      const publicPath = path.join(site.vaultPath, 'public', `${pathWithoutThumbExt}${curExt}`);
      const contentPath = path.join(site.vaultPath, 'content', `${pathWithoutThumbExt}${curExt}`);
      if (existsSync(publicPath)) {
        return `/${pathWithoutThumbExt}${curExt}`;
      }
      if (existsSync(contentPath)) {
        return `/${pathWithoutThumbExt}${curExt}`;
      }
    }
  }

  // If not found locally, we queue it for download
  const targetLocalPath = `attachments/${finalFilename}`;
  const targetFullPath = path.join(site.vaultPath, 'content', targetLocalPath);

  if (collectedImages) {
    let tryHighResUrl = originalUrl;
    if (originalUrl.includes(filename)) {
      tryHighResUrl = originalUrl.replace(filename, finalFilename);
    }
    collectedImages.push({
      remoteUrl: originalUrl,
      tryHighResUrl,
      localPath: targetFullPath,
    });
  }

  return `/${targetLocalPath}`;
}

export function restoreLocalImagePath(src: string, site: Site, registry: Registry): string {
  return resolveAndCollectImagePath(src, site, registry);
}

export function htmlToMarkdown(
  html: string,
  site: Site,
  registry: Registry,
  collectedImages?: { remoteUrl: string; tryHighResUrl: string; localPath: string }[]
): string {
  // Tokenize the HTML
  const tagRegex = /(<\/?[a-zA-Z0-9:-]+(?:\s+[a-zA-Z0-9:-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>)/g;
  const parts = html.split(tagRegex);
  
  interface Node {
    type: string;
    attributes: Record<string, string>;
    children: Node[];
    text?: string;
  }

  const root: Node = { type: 'root', attributes: {}, children: [] };
  const stack: Node[] = [root];

  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('<') && part.endsWith('>')) {
      const isClosing = part.startsWith('</');
      const tagContent = part.replace(/^<\/?/, '').replace(/\/?>$/, '').trim();
      const tagName = tagContent.split(/\s+/)[0].toLowerCase();
      
      const isSelfClosing = part.endsWith('/>') || /^(?:img|br|hr|input|meta|link)$/i.test(tagName);
      
      if (isClosing) {
        const openIdx = [...stack].reverse().findIndex(n => n.type === tagName);
        if (openIdx !== -1) {
          const actualIdx = stack.length - 1 - openIdx;
          stack.splice(actualIdx);
        }
      } else {
        const attributes: Record<string, string> = {};
        const attrRegex = /([a-zA-Z0-9:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        let match;
        const attrString = tagContent.substring(tagName.length);
        while ((match = attrRegex.exec(attrString)) !== null) {
          const key = match[1].toLowerCase();
          const value = match[2] ?? match[3] ?? match[4] ?? '';
          attributes[key] = value;
        }

        const node: Node = { type: tagName, attributes, children: [] };
        stack[stack.length - 1].children.push(node);

        if (!isSelfClosing) {
          stack.push(node);
        }
      }
    } else {
      const text = decodeHtmlEntities(part);
      if (text) {
        stack[stack.length - 1].children.push({ type: 'text', attributes: {}, children: [], text });
      }
    }
  }

  function decodeHtmlEntities(str: string): string {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&ldquo;/g, '“')
      .replace(/&rdquo;/g, '”')
      .replace(/&lsquo;/g, '‘')
      .replace(/&rsquo;/g, '’')
      .replace(/&ndash;/g, '–')
      .replace(/&mdash;/g, '—')
      .replace(/&hellip;/g, '…')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, dec) => {
        try {
          return String.fromCodePoint(parseInt(dec, 10));
        } catch {
          return _;
        }
      })
      .replace(/&#x([a-fA-F0-9]+);/g, (_, hex) => {
        try {
          return String.fromCodePoint(parseInt(hex, 16));
        } catch {
          return _;
        }
      });
  }

  function render(node: Node, listDepth = 0): string {
    if (node.type === 'text') {
      return node.text || '';
    }

    const childrenContent = node.children.map(c => render(c, listDepth)).join('');

    switch (node.type) {
      case 'root':
        return childrenContent.trim();
      case 'p':
        return `\n\n${childrenContent.trim()}\n\n`;
      case 'h1':
        return `\n\n# ${childrenContent.trim()}\n\n`;
      case 'h2':
        return `\n\n## ${childrenContent.trim()}\n\n`;
      case 'h3':
        return `\n\n### ${childrenContent.trim()}\n\n`;
      case 'h4':
        return `\n\n#### ${childrenContent.trim()}\n\n`;
      case 'h5':
        return `\n\n##### ${childrenContent.trim()}\n\n`;
      case 'h6':
        return `\n\n###### ${childrenContent.trim()}\n\n`;
      case 'strong':
      case 'b':
        return `**${childrenContent}**`;
      case 'em':
      case 'i':
        return `*${childrenContent}*`;
      case 'code':
        return `\`${childrenContent}\``;
      case 'pre': {
        const codeNode = node.children.find(c => c.type === 'code');
        const codeText = codeNode ? codeNode.children.map(c => render(c, listDepth)).join('') : childrenContent;
        const className = codeNode?.attributes['class'] || node.attributes['class'] || '';
        const langMatch = className.match(/language-([a-zA-Z0-9+-]+)/);
        const lang = langMatch ? langMatch[1] : '';
        return `\n\n\`\`\`${lang}\n${codeText.trim()}\n\`\`\`\n\n`;
      }
      case 'blockquote':
        return `\n\n> ${childrenContent.trim().replace(/\n/g, '\n> ')}\n\n`;
      case 'ul': {
        const content = node.children.map(c => render(c, listDepth + 1)).join('');
        if (listDepth > 0) {
          return `\n${content.trimEnd()}`;
        }
        return `\n\n${content.trim()}\n\n`;
      }
      case 'ol': {
        let index = 1;
        const content = node.children.map(c => {
          if (c.type === 'li') {
            return render(c, listDepth + 1).replace(/^(\s*)-\s+/, `$1${index++}. `);
          }
          return render(c, listDepth + 1);
        }).join('');
        if (listDepth > 0) {
          return `\n${content.trimEnd()}`;
        }
        return `\n\n${content.trim()}\n\n`;
      }
      case 'li': {
        const indent = '  '.repeat(Math.max(0, listDepth - 1));
        return `${indent}- ${childrenContent.trim()}\n`;
      }
      case 'a':
        const href = node.attributes['href'] || '';
        return `[${childrenContent}](${href})`;
      case 'img': {
        const src = node.attributes['src'] || '';
        const alt = node.attributes['alt'] || '';
        const localSrc = resolveAndCollectImagePath(src, site, registry, collectedImages);
        return `![${alt}](${localSrc})`;
      }
      case 'figure': {
        const img = findNodeByType(node, 'img');
        if (!img) return childrenContent;
        const src = img.attributes['src'] || '';
        const alt = img.attributes['alt'] || '';
        const figcaption = findNodeByType(node, 'figcaption');
        const captionText = figcaption ? getPlainText(figcaption).trim() : '';
        const finalAlt = alt || captionText;
        const localSrc = resolveAndCollectImagePath(src, site, registry, collectedImages);
        return `\n\n![${finalAlt}](${localSrc})\n\n`;
      }
      case 'figcaption':
        return '';
      case 'br':
        return '\n';
      case 'hr':
        return '\n\n---\n\n';
      default:
        return childrenContent;
    }
  }

  function findNodeByType(node: Node, type: string): Node | null {
    if (node.type === type) return node;
    for (const child of node.children) {
      const found = findNodeByType(child, type);
      if (found) return found;
    }
    return null;
  }

  function getPlainText(node: Node): string {
    if (node.type === 'text') return node.text || '';
    return node.children.map(getPlainText).join('');
  }

  const result = render(root);
  return result
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface PullFromWordPressArgs {
  site: Site;
  registry: Registry;
  allIndices: Map<string, VaultDirectoryIndex>;
  slugOrId: string;
  dryRun: boolean;
}

export async function pullFromWordPress({
  site,
  registry,
  allIndices,
  slugOrId,
  dryRun,
}: PullFromWordPressArgs) {
  const credentials = site.wordpress;
  if (!credentials) {
    throw new Error(`⨯ WordPress credentials are not configured for site [${site.siteId}].`);
  }

  const endpoint = credentials.endpoint || `https://${site.domain}/wp-json`;
  console.log(`\n📥 Preparing WordPress Pull...`);
  console.log(`- Target Endpoint: ${endpoint}`);
  console.log(`- Authenticated As: ${credentials.username}`);
  console.log(`- Target Post Slug/ID: ${slugOrId}`);
  console.log(dryRun ? `- Mode: DRY RUN (No changes will be written)\n` : `- Mode: Live Pull\n`);

  let wpPost: WpPost | null = null;

  // 1. Try to fetch by slug first (WordPress uses hyphens instead of slashes)
  const wpSlug = slugOrId.replace(/\//g, '-');
  try {
    const posts = (await wpFetch({
      endpoint,
      credentials,
      path: `/wp/v2/posts?slug=${encodeURIComponent(wpSlug)}&status=any`,
    })) as WpPost[];
    
    if (posts && posts.length > 0) {
      wpPost = posts[0];
    }
  } catch (err) {
    console.log(`  (Slug lookup for "${wpSlug}" returned no results or failed, checking ID...)`);
  }

  // 2. Try to fetch by ID if slug lookup didn't yield a post
  if (!wpPost && /^\d+$/.test(slugOrId)) {
    try {
      wpPost = (await wpFetch({
        endpoint,
        credentials,
        path: `/wp/v2/posts/${slugOrId}`,
      })) as WpPost;
    } catch (err) {
      // Failed to find by ID
    }
  }

  if (!wpPost) {
    throw new Error(`⨯ Could not find any post in WordPress matching slug or ID: "${slugOrId}"`);
  }

  console.log(`✅ Found post: "${wpPost.title.rendered}" (ID: wpPost ID: ${wpPost.id}, Slug: ${wpPost.slug})`);

  // Convert HTML to Markdown (and collect any remote image urls to download)
  const collectedImages: { remoteUrl: string; tryHighResUrl: string; localPath: string }[] = [];
  const markdownBody = htmlToMarkdown(wpPost.content.rendered, site, registry, collectedImages);

  // Prepend frontmatter and title heading
  const frontmatter = [
    `---`,
    `title: "${wpPost.title.rendered.replace(/"/g, '\\"')}"`,
    `date: "${new Date(wpPost.date).toISOString()}"`,
    `updated: "${new Date(wpPost.modified).toISOString()}"`,
    `---`,
    ``,
    `# ${wpPost.title.rendered}`,
    ``,
    markdownBody,
    ``,
  ].join('\n');

  // Find local path from indices
  let targetLocalPath = '';
  for (const [dirKey, dirIndex] of allIndices.entries()) {
    for (const page of dirIndex.pages) {
      const fullSlug = dirKey ? `${dirKey}/${page.slug}` : page.slug;
      if (fullSlug.replace(/\//g, '-') === wpPost.slug) {
        targetLocalPath = path.join(site.vaultPath, 'content', dirKey, `${page.slug}.md`);
        break;
      }
    }
    if (targetLocalPath) break;
  }

  if (!targetLocalPath) {
    targetLocalPath = path.join(site.vaultPath, 'content', `${wpPost.slug}.md`);
  }

  if (dryRun) {
    console.log(`  [DRY RUN] Would write Markdown post for "${wpPost.title.rendered}" to:`);
    console.log(`  📂 ${targetLocalPath}`);
    if (collectedImages.length > 0) {
      console.log(`\n  [DRY RUN] Would download ${collectedImages.length} image(s):`);
      for (const img of collectedImages) {
        console.log(`  - ${img.tryHighResUrl} -> ${img.localPath}`);
      }
    }
    console.log(`\n--- PREVIEW START ---`);
    console.log(frontmatter);
    console.log(`--- PREVIEW END ---`);
  } else {
    // Ensure parent directory exists
    await mkdir(path.dirname(targetLocalPath), { recursive: true });

    // Download collected images
    if (collectedImages.length > 0) {
      console.log(`\n📥 Downloading ${collectedImages.length} image(s) to local vault...`);
      for (const img of collectedImages) {
        try {
          await mkdir(path.dirname(img.localPath), { recursive: true });
          console.log(`- Fetching image: ${img.tryHighResUrl}`);
          let imgResponse = await fetch(img.tryHighResUrl);
          
          if (!imgResponse.ok) {
            console.log(`  (High-res URL failed, falling back to original: ${img.remoteUrl})`);
            imgResponse = await fetch(img.remoteUrl);
          }

          if (!imgResponse.ok) {
            console.error(`  ❌ Failed to download image from both URLs: ${imgResponse.statusText}`);
            continue;
          }

          const buffer = Buffer.from(await imgResponse.arrayBuffer());
          await writeFile(img.localPath, buffer);
          console.log(`  ✅ Saved to: ${img.localPath}`);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`  ❌ Failed to download image "${img.remoteUrl}":`, errMsg);
        }
      }
    }

    await writeFile(targetLocalPath, frontmatter, 'utf-8');
    console.log(`\n  💾 Successfully pulled and saved post to: ${targetLocalPath}`);
  }
}


