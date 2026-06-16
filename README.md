# Notopress

> [!CAUTION]
> Notopress is currently under active development. Expect breaking changes and potential backward incompatibility as we evolve.

Notopress is a tool for creating highly customizable, markdown-based, content-driven websites from local files you control. Whether you're building technical documentation, a personal blog, or unique marketing pages, Notopress bridges the gap between your own Markdown source of truth and the web with a focus on flexibility, simplicity, and SEO.

## Why Notopress?

Notopress is designed to fit seamlessly into your existing workflow, rather than forcing you into a new one:

- **Local Markdown as the Source of Truth**: Keep your content in ordinary local Markdown files. You own your own data, and the files on disk are the canonical source for what appears on the web.
- **Developer-Friendly**: Write and organize files manually in your favorite editor with zero friction.
- **Editable Anywhere**: Because your site is just local files, you can edit it manually in tools like Obsidian or work with local agents such as Claude Code and Codex.

## Requirements

- **Node.js**: A modern Node.js runtime to build and run your site.
- **S3-Compatible Storage**: Any S3-compatible service (AWS S3, Cloudflare R2, MinIO, etc.) to store and serve your content.

## Supported Features

- **Local Markdown publishing**: Use a local folder as the canonical source for site content.
- **Clean file-based routing**: `content/page.md` becomes the home page, `content/blog/page.md` becomes `/blog`, and nested Markdown files map to clean URLs.
- **Directory collection pages**: Folders without a `page.md` render an archive-style listing of their Markdown pages.
- **Frontmatter metadata**: `title`, `date`, `updated`, `lastmod`, and `published: false` are supported for page metadata and publishing control.
- **Automatic excerpts**: Page summaries are generated from the first non-heading paragraph, with fenced code blocks ignored.
- **SEO metadata**: Rendered Markdown pages include title, description, canonical URL, Open Graph article metadata, and Twitter card metadata.
- **Sitemap generation**: `sitemap.xml` is generated when a site `domain` is configured, with nested sitemap indexes for larger directory trees.
- **Static asset serving**: Files in `public/` and supported asset files in `content/` are served from S3-compatible storage through the app.
- **Responsive images**: Supported local images are converted to WebP thumbnails and rendered with `srcset`, lazy loading, and async decoding.
- **Obsidian image embeds**: Local image wikilinks such as `![[image.png]]` are resolved against known public/content assets.
- **Multi-site registry**: Manage multiple sites from one `registry.json`, each with its own `siteId`, domain, bucket, endpoint, and local content path.
- **Content sync**: Generate indices, sitemaps, thumbnails, and upload content to S3-compatible storage with delete synchronization.
- **Dry runs**: Preview generated files and storage changes before writing with `--dry-run`.
- **Local environment switching**: Use `npm run configure` to update `.env.local` for a selected site.
- **Vercel deployment automation**: Sync production environment variables and trigger a production Vercel deploy with `npm run deploy`.
- **Optional image host**: Configure an `imageHost` for absolute image URLs, especially for CDN or WordPress publishing workflows.
- **Optional WordPress publishing**: Push your local Markdown posts to WordPress, update existing posts by slug, or target one post with `--post`.

## Organizing Your Content

Notopress looks for a specific but intuitive structure in your local content folder:

### `content/` (The Core)
This is where your writing lives.
- **Clean URLs**: Directory indices are named `page.md` (e.g., `blog/page.md` becomes `yoursite.com/blog`).
- **Home Page**: Your site's landing page is simply `content/page.md`.

### `public/` (Static Assets)
Keep your images, PDFs, and other assets organized here.
- **Mirroring**: The folder structure in `public/` perfectly mirrors your URL structure.
- **Zero Configuration**: Just drop a file in `public/assets/logo.png` and it's available at `/assets/logo.png`.

### Automated SEO & Sitemaps
Every time you sync, Notopress automatically generates a valid, search-engine-friendly `sitemap.xml` (if a `domain` is configured).
- **Discovery**: Helps search engines find and index all your content instantly.
- **Scalability**: For large sites, Notopress automatically creates a sitemap index and nested sub-sitemaps to keep things organized and within search engine limits.

## Configuration

Notopress uses a centralized `registry.json` to manage multiple sites and their storage settings.

### Setting Up Your Registry

Start by copying the provided example:

```bash
cp registry.json.example registry.json
```

By default, Notopress looks for `registry.json` in the project root. You can customize this path:
- **CLI Flag**: `--registry` or `-r` (e.g., `npm run sync -- -r ./custom-registry.json`).
- **Environment**: Set the `REGISTRY_PATH` environment variable.

#### Registry Properties

The registry manages global defaults and site-specific overrides.

**Global Settings**
| Property | Type | Description |
| :--- | :--- | :--- |
| `endpoint` | `string` | Your S3-compatible API endpoint (e.g., Cloudflare R2). |
| `accessKeyId` | `string` | Your S3 access key ID. |
| `secretAccessKey` | `string` | Your S3 secret access key. |
| `thumbnailSizes` | `number[]` | (Optional) Default responsive image thumbnail widths. Defaults to `[320, 640, 960, 1280]`. |
| `sites` | `array` | List of site configurations. |

**Site-Specific Settings**
| Property | Type | Description |
| :--- | :--- | :--- |
| `domain` | `string` | (Optional) Your site's domain. Used to generate absolute URLs for the sitemap. If omitted, sitemap generation will be skipped. |
| `siteId` | `string` | A unique ID for the site, used as its root folder in S3. |
| `vaultPath` | `string` | Path to the local Markdown folder that acts as the source of truth for this site. |
| `bucketName` | `string` | (Optional) The S3 bucket name. |
| `endpoint` | `string` | (Optional) Override the global endpoint for this site. |
| `vercelProjectId` | `string` | (Optional) Vercel project ID to deploy. Falls back to `siteId` when omitted. |
| `imageHost` | `string` | (Optional) Absolute image host used for generated image URLs in publishing workflows. |
| `thumbnailSizes` | `number[]` | (Optional) Override the global responsive image thumbnail widths for this site. |
| `wordpress` | `object` | (Optional) WordPress REST API credentials for `--wp` publishing. |

### Responsive Images

When you run `npm run sync`, Notopress creates WebP thumbnails for supported images in `content/` and `public/`, then includes them in generated responsive `srcset` attributes at render time.

Generated thumbnails live under `_thumbnails/` beside the source tree that owns the image. For example, an image referenced as `/attachments/photo.png` gets thumbnail candidates like `/_thumbnails/attachments/photo-640.webp`.

### Serving Thumbnails from Cloudflare

If your bucket is Cloudflare R2, the default deployment already stores thumbnails in R2 and serves them through the app's asset route with long-lived cache headers. To serve them directly from Cloudflare instead:

1. Add a public or custom domain to the R2 bucket in Cloudflare.
2. Keep the same uploaded key layout, including `{siteId}/content/_thumbnails/...` and `{siteId}/public/_thumbnails/...`.
3. Point image URLs at that R2 domain with a future CDN URL setting, or add a rewrite in your edge/CDN layer from `/_thumbnails/...` to the matching R2 key.

### Environment Overrides

You can also use a `.env` file for quick overrides or local development:

| Variable | Description |
| :--- | :--- |
| `S3_ENDPOINT` | Fallback S3 endpoint URL. |
| `S3_ACCESS_KEY_ID` | Fallback S3 access key. |
| `S3_SECRET_ACCESS_KEY` | Fallback S3 secret key. |
| `VAULT_ROOT` | The ID of the site currently being served/synced. |

## Deployment

Notopress separates content sync from app deployment. Your local Markdown folder is the source content: write it by hand, edit it in tools like Obsidian, or let local agents work with the same files. Sync then generates the supporting metadata/assets and uploads everything to S3-compatible storage. The Next.js app is deployed separately as the web runtime that reads from that storage.

### Configure Local Development

To switch the local app to a site from `registry.json`, run:

```bash
npm run configure
```

This updates `.env.local` with the selected site's runtime values:

| Variable | Purpose |
| :--- | :--- |
| `S3_ENDPOINT` | S3-compatible API endpoint. |
| `S3_ACCESS_KEY_ID` | S3 access key ID. |
| `S3_SECRET_ACCESS_KEY` | S3 secret access key. |
| `S3_BUCKET` | Bucket that stores the synced site content. |
| `VAULT_ROOT` | Site ID / bucket prefix for the site currently being served. |

Restart `npm run dev` after switching sites.

### Sync Content

To generate content metadata, generate sitemaps, upload the local content folder to S3-compatible storage, and upload a sanitized `registry.json` to the bucket root, run:

```bash
npm run sync
```

The sync command writes generated files such as `root.json`, nested content indices, responsive thumbnails, and `sitemap.xml` files before uploading. Each site is uploaded under its `siteId` prefix in the configured bucket.

### Safety First: Dry Run
Before making any changes, you can preview what will happen:

```bash
npm run sync -- --dry-run
```

This previews generated metadata and uses the AWS CLI's `--dryrun` mode to show exactly which files would be modified on your storage.

### Deploy the App

To sync content and deploy the Next.js app to Vercel production in one command, run:

```bash
npm run deploy
```

Deployment uses `vercel.json`, which declares this as a Next.js project with `npm run build` as the build command and `npm install` as the install command. The deploy script also syncs the selected site's production environment variables to Vercel before triggering:

```bash
vercel deploy --prod --local-config vercel.json
```

If a site defines `vercelProjectId`, that project is targeted. Otherwise, Notopress falls back to using `siteId` as the Vercel project ID.

### Targeting Sites and Registries

All deploy commands support choosing a site and registry file:

```bash
npm run sync -- --site example-blog
npm run deploy -- --site example-blog --registry ./custom-registry.json
```

Use `--wp` with `sync` or `deploy` to publish local Markdown posts to the configured WordPress site, and `--post <slug>` to limit that WordPress publish step to one post.

## Roadmap

- [ ] **Localization**: Native support for multi-language sites.
- [ ] **Custom Themes**: A flexible system for bespoke site designs.

## License

MIT License. See [LICENSE.md](LICENSE.md) for details.
