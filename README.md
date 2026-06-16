# Notopress

> [!CAUTION]
> Notopress is currently under active development. Expect breaking changes and potential backward incompatibility as we evolve.

Notopress is a tool for creating highly customizable, markdown-based, content-driven websites. Whether you're building technical documentation, a personal blog, or unique marketing pages, Notopress bridges the gap between your favorite writing environment and the web with a focus on flexibility, simplicity, and SEO.

## Why Notopress?

Notopress is designed to fit seamlessly into your existing workflow, rather than forcing you into a new one:

- **Obsidian-First**: Manage your entire site directly from your Obsidian vault. What you see in your notes is what you get on the web.
- **Developer-Friendly**: Write and organize files manually in your favorite editor with zero friction.
- **AI-Powered**: Perfect for AI agents! Grant them access to your vaults to generate, refine, or translate content automatically.

## Requirements

- **Node.js**: A modern Node.js runtime to build and run your site.
- **S3-Compatible Storage**: Any S3-compatible service (AWS S3, Cloudflare R2, MinIO, etc.) to store and serve your content.

## Organizing Your Vault

Notopress looks for a specific but intuitive structure in your vault:

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
| `vaultPath` | `string` | Absolute path to your local markdown vault. |
| `bucketName` | `string` | (Optional) The S3 bucket name. |
| `endpoint` | `string` | (Optional) Override the global endpoint for this site. |
| `thumbnailSizes` | `number[]` | (Optional) Override the global responsive image thumbnail widths for this site. |

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

## Deploying Your Content

Ready to go live? The sync script handles everything from index generation to S3 uploading.

```bash
npm run sync
```

### Safety First: Dry Run
Before making any changes, you can preview what will happen:

```bash
npm run sync -- --dry-run
```

This will preview the `index.json` metadata and use the AWS CLI's `--dryrun` mode to show exactly which files would be modified on your storage.

## Roadmap

- [ ] **Localization**: Native support for multi-language sites.
- [ ] **Multi-site Hosting**: Serve multiple distinct domains from one instance.
- [ ] **Asset Optimization**: Automatic responsive images and WebP conversion.
- [ ] **Custom Themes**: A flexible system for bespoke site designs.

## License

MIT License. See [LICENSE.md](LICENSE.md) for details.
