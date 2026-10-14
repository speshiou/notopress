# NotoPress

NotoPress turns a local Markdown vault into a content-driven Next.js site. Markdown remains the source of truth. NotoPress builds the site artifacts, stores them in S3-compatible storage, and can publish the same canonical content through optional adapters such as WordPress.

> [!CAUTION]
> NotoPress is under active development. Command and configuration compatibility may change before a stable release.

## How it works

```text
Markdown vault
    ↓
canonical content snapshot
    ↓
indices · routes · rendered HTML · sitemaps · responsive images
    ↓
reviewable publication plan
    ├── native site → S3-compatible storage → Next.js runtime
    └── publishers  → configured publication targets
```

The native site and platform adapters share content discovery and publication planning, but they do not share target behavior. URL rewrites belong to the NotoPress site. A WordPress adapter renders Gutenberg-compatible HTML, chooses WordPress slugs, and owns its remote state independently.

## Getting started

You need Node.js and an S3-compatible bucket with conditional object writes. Vercel is optional unless you use the included deployment workflow.

```bash
npm install
cp registry.json.example registry.json
```

Edit `registry.json`, then point `vaultPath` at a local vault:

```json
{
  "endpoint": "https://storage.example.com",
  "accessKeyId": "access-key",
  "secretAccessKey": "secret-key",
  "sites": [
    {
      "siteId": "example-blog",
      "domain": "example.com",
      "vaultPath": "/absolute/path/to/vault",
      "bucketName": "content-bucket"
    }
  ]
}
```

Configure the local Next.js runtime for that site and start development:

```bash
npm run configure -- example-blog
npm run dev
```

## Vault model

A minimal vault looks like this:

```text
vault/
├── content/
│   ├── page.md
│   ├── about.md
│   └── guides/
│       ├── page.md
│       └── first-guide.md
├── public/
│   └── assets/
│       └── logo.svg
└── _includes/
    └── shared-note.md
```

`content/page.md` is the home page. A nested `page.md` represents its directory, while other Markdown files use their file path as the default route. Directories without a `page.md` become collection pages. Files under `public/` are copied as public assets. Paths listed in `noteIncludePaths` contain private, embed-only Markdown snippets.

Article metadata uses YAML frontmatter:

```markdown
---
title: "First guide"
date: "2026-01-15T08:30:00.000Z"
published: true
categories:
  - guides
tags:
  - publishing
---

# First guide

Article body.
```

Set `published: false` to exclude a document from public indices and publishing.

### Links, embeds, and images

NotoPress understands standard Markdown plus Obsidian-style note references:

```markdown
[[first-guide]]
[[guides/first-guide|Read the guide]]
![[shared-note]]
![[attachments/product.png|Product image]]
```

Public note links follow the final NotoPress route. Transclusions insert the referenced body without its frontmatter or first heading. Local images use the same responsive-image pipeline whether they are written as wikilinks or normal Markdown images.

### Rewrites

Rewrites let the vault stay organized without exposing those folders in the public URL:

```json
{
  "rewrites": [
    { "source": "guides/:path*", "destination": "/:path*" }
  ]
}
```

With this rule, `content/guides/first-guide.md` is served at `/first-guide`. Rewrites apply only to the native NotoPress site. Platform adapters receive the canonical source document and choose their own target slug behavior.

A named segment can also hide a grouping folder: `guides/:edition/:path*` to
`/:path*` serves `content/guides/edition-a/first-guide.md` at `/first-guide` with
one rule for every edition. WordPress imports resolve existing source files
through their forward rewrite, so omitted grouping segments do not require
guessing a folder or creating another root article. Ambiguous targets stop the
import; use the full vault slug to select the intended article.

For sibling folders, a segment wildcard works too: `series-*/:path*` to
`/:path*` flattens both `content/series-edition-a/` and
`content/series-edition-b/` with one rule. The wildcard stays within one folder
segment; it does not match unrelated folder prefixes.

## Sync and deployment

Always preview a meaningful change first:

```bash
npm run sync -- example-blog --dry-run
```

Run the live sync after reviewing the generated files, warnings, storage operations, and publication fingerprint:

```bash
npm run sync -- example-blog --expect <reviewed-fingerprint>
```

`sync` uploads native NotoPress files only, including for sites with WordPress configured. It does not create or update WordPress posts. For a WordPress site-wide push, use `publish <publisher> --site <site-id>` without slugs, first with `--dry-run` and then with the reviewed `--expect` fingerprint.

For `publish <publisher> [slug...]`, slugs limit adapter posts only. S3/R2
backup/sync covers the full eligible vault and generated native-site outputs;
storage uploads do not create WordPress posts. Folder names imply no publication
or exclusion rules. Review both plans with the composite `--expect` fingerprint.

Sync prepares expected indices, rendered HTML, sitemaps, image variants, and source files under the site's `siteId` prefix. Dry runs and live preparation do not write generated files. After plan validation, a live run materializes changed artifacts and executes explicit storage operations through the S3 SDK; it does not invoke whole-vault AWS CLI sync. Remote objects are preserved unless `--delete` is explicitly supplied. Normal output reports counts and changed keys; `--verbose` also lists unchanged objects.

To sync content and deploy the Next.js runtime to Vercel in one workflow:

```bash
npm run deploy -- example-blog
```

Use `--registry <path>` to select another registry. The `REGISTRY_PATH` environment variable provides the same override.

### Publication performance

Publication commands emit `[TIMING]` lines for content scanning, thumbnail checks,
asset and include scanning, snapshot construction, rendering, sitemap generation,
publisher preparation, and native storage. Stage durations include nested work;
do not add `build.indices` or `build.total` to their child durations. A failed
stage reports its elapsed time with `failed`, rather than a successful benchmark.
Timing records contain only fixed stage names, elapsed seconds, and outcomes.

`storage.inventory` measures local enumeration and hashing. `storage.compare`
measures remote manifest comparison or reconciliation, and `storage.sync` measures
live application. Targeting one adapter article still prepares the full native
site; source parsing and rendering are not yet incremental.

### Remote storage manifests

NotoPress stores authoritative storage state at
`<site-id>/.notopress/storage-manifest.json`. Entries contain relative object keys,
SHA-256 byte hashes, sizes, and remote ETags. The manifest includes the destination
identity and a versioned generation, but no credentials, local paths, or machine
timestamps. Local caches and generated files are disposable.

A normal run reads the manifest and performs a targeted check of the shared
bucket-level `registry.json`. It compares expected byte hashes locally and prepares
uploads, skips, and opt-in deletions. The storage fingerprint contributes to the
composite publication fingerprint, including remote preconditions and destination
identity. Same-size edits are detected. Old generated outputs that are no longer
expected are omitted from the inventory and may be pruned with `--delete`; source
files remain part of full native-site coverage.

When no manifest exists, bootstrap lists only the selected site's prefix and
reads/hashes existing objects that correspond to expected outputs. It does not
trust object size or ETag as a content hash. This initial comparison can be
expensive, especially with a large existing site. A bootstrap preview writes
nothing, so the first reviewed live run repeats these reads before creating state.
After successful live bootstrap, subsequent runs do not list the full remote site.

To skip initial object downloads, explicitly trust a local baseline instead:

```bash
npm run storage:init -- --site example-blog --trust-local --pending pending-uploads.json --dry-run
npm run storage:init -- --site example-blog --trust-local --pending pending-uploads.json --expect <baseline-fingerprint>
```

`pending-uploads.json` is a JSON array of exact storage keys from a reviewed plan,
for example `["example-blog/content/article.md", "example-blog/_rendered/content/article.html"]`.
Initialization writes only an absent manifest, leaving those keys, missing files,
and size mismatches pending for the next sync. Other matching-size files are
assumed synced without verifying their bytes, so preserve all known pending
uploads, including generated outputs. Omit `--pending` only when accepting that
assumption for every matching-size file. No vault files, remote content objects,
or WordPress posts are changed. Stop other storage writers first. Remote metadata
is listed again before conditional manifest creation; existing state is never
overwritten. After initialization, review a new sync/publish plan: old publication
fingerprints are obsolete. `--reconcile-storage` remains available to verify bytes.

The manifest tracks NotoPress-owned state. To detect external object changes or
missing remote files, explicitly reconcile actual remote bytes:

```bash
npm run sync -- example-blog --dry-run --reconcile-storage
npm run sync -- example-blog --reconcile-storage --expect <reviewed-fingerprint>
```

Use the same selection and flags for preview and application. `--expect` is
supported by `sync`, `deploy`, and `publish`. Changing the destination, expected
bytes, remote manifest, remote preconditions, reconciliation mode, or deletion
policy changes the reviewed fingerprint.

### Migration and interrupted publication

On a new machine, restore the source vault and equivalent registry configuration,
use `npm ci` with the same lockfile, configure credentials, and run a dry run.
The local `vaultPath` can change. Missing generated files are prepared again and
compared with the remote manifest; identical output does not require reuploading
or remote listing. For reproducible date metadata, use explicit `date` and
`updated` frontmatter or preserve source modification times. Managed agent rules
use a generic NotoPress path placeholder rather than the current machine's path.
Preserve `.notopress-sync.json` if available for adapter caches; adapters can
rediscover remote resource IDs if that state is absent.

A live run first reserves the manifest using a conditional create/update, then
applies artifact writes and object operations, and commits the next ready manifest
only after success. Competing NotoPress publishers cannot reserve the same
generation. There is no time-based expiry or automatic lock takeover. SDK write
retries are disabled because a lost response can leave a mutation's outcome
uncertain. Failed or interrupted application normally leaves a pending manifest;
a lost final response may instead leave an already committed ready manifest.

Inspect uncertain outcomes with a dry run. If state is pending, stop all previous
publishers and external writers before using explicit recovery:

```bash
npm run sync -- example-blog --dry-run --reconcile-storage --recover-storage
npm run sync -- example-blog --reconcile-storage --recover-storage --expect <reviewed-fingerprint>
```

Live recovery requires the reviewed fingerprint. Recovery checks actual remote
bytes and conditionally replaces the interrupted reservation; it does not blindly
replay uploads. Invalid or unsupported manifest state also requires explicit
recovery. `--delete` remains a separate opt-in and never prunes the shared registry
or reserved manifest. Deletion checks ETags under the site reservation; external
writers must be stopped during cleanup because R2 does not document atomic
conditional deletes. Backends must support conditional `PutObject` operations;
there is no unguarded-write fallback. The current transport supports single-object
uploads up to 5 GiB and rejects larger uploads during planning; multipart uploads
are not implemented. Symbolic links are rejected during inventory discovery, so
restore source assets as files inside the vault. Conditional write support is
documented in the [R2 S3 compatibility guide](https://developers.cloudflare.com/r2/api/s3/api/).

Further scaling work remains: share a single parsed source inventory, track build
dependencies, and cache unchanged parsing, rendering, and image work. The manifest
workflow removes repeated remote discovery, but does not yet move generated
variants out of the source tree or reclaim obsolete local derivatives.

### Disposable R2 integration checks

The live suite is skipped by default. It creates synthetic source files in a
temporary directory and accesses only a unique `notopress-integration-<uuid>`
bucket. It exercises dry runs, composite fingerprints, migration with an empty
local cache, conditional-write concurrency, recovery after an injected lost
upload response, reconciliation, and opt-in deletion. It verifies uploaded bytes
independently, then removes the objects and bucket. It makes no WordPress requests.

Configure test credentials locally with `NOTOPRESS_R2_TEST_ENDPOINT`,
`NOTOPRESS_R2_TEST_ACCESS_KEY_ID`, and `NOTOPRESS_R2_TEST_SECRET_ACCESS_KEY`.
Otherwise the suite uses the registry/environment storage credentials, while
ignoring every configured vault and bucket. Automated bucket creation/deletion
requires R2 bucket administration permission.

```bash
NOTOPRESS_R2_INTEGRATION=1 node --env-file=.env node_modules/vitest/vitest.mjs run scripts/infrastructure/native/r2.integration.test.ts --reporter=verbose
```

For object-only credentials, first create a new empty bucket named
`notopress-integration-<uuid>` and set `NOTOPRESS_R2_TEST_MANAGED_BUCKET` to that
exact name. The suite rejects configured bucket names and nonempty buckets. It
removes all test objects and verifies the bucket is empty; the creator must then
delete the bucket through the dashboard. Never select an existing data bucket.

## Platform adapters

Publication targets are named in the site configuration. WordPress is currently the built-in platform adapter:

```json
{
  "publishers": [
    {
      "id": "wordpress-main",
      "type": "wordpress",
      "config": {
        "endpoint": "https://wordpress.example.com/wp-json",
        "username": "editor",
        "applicationPassword": "application-password",
        "assetFolder": "assets"
      }
    }
  ]
}
```

The deprecated top-level `wordpress` configuration remains readable as publisher ID `wordpress`, but new configurations should use `publishers`.

The publication target and source documents are command operands. Use full vault slugs, even when a NotoPress rewrite changes the public URL:

```bash
npm run publish -- \
  wordpress-main \
  guides/first-guide \
  --site example-blog \
  --dry-run
```

The dry-run prints one composite fingerprint for the native build, storage operations, and all selected platform plans. Pass that fingerprint to the corresponding live run:

```bash
npm run publish -- \
  wordpress-main \
  guides/first-guide \
  --site example-blog \
  --expect <reviewed-fingerprint>
```

If content, rendered output, routes, assets, deletion policy, remote target identity, or publication intent changes, the fingerprint changes and the live run stops before remote mutation. Adapter planning may perform narrowly targeted remote reads. A requested site-wide push requires a site-wide dry run. Avoid unbounded WordPress planning merely for verification. Target slugs limit adapter publication only: the native site upload remains site-wide.

Adapters may also provide import and state-initialization capabilities:

```bash
npm run import -- \
  wordpress-main \
  first-guide \
  --site example-blog

npm run publisher:init -- \
  wordpress-main \
  --site example-blog
```

`publisher:init` trusts the adapter's current locally rendered payloads as the remote baseline. It does not publish or verify remote content. Use it deliberately when adopting a publisher or resetting state, then explicitly publish any known remote differences.

WordPress imports keep existing local image paths intact. New image downloads go to
`content/assets/` by default; set the publisher's `config.assetFolder` to another
relative folder under `content/` (for example, `media/images`) to match your vault's
attachment convention. The legacy `wordpress.assetFolder` field works too. This
setting does not change Obsidian settings or move existing files.

Imports record endpoint-scoped image mappings and content hashes in the
`wordpressAssets` section of `.notopress-sync.json`. Exact NotoPress-hosted originals
are reused in place. New WordPress-hosted images are compared by content against
source images throughout `content/` and `public/`, including existing attachment
folders. Generated files are excluded. Repeated unchanged imports create no new
asset files; WordPress-hosted sources are fetched again to detect changes at the
same URL. Changed remote images get a new file, preserving the old image for other
articles. Conflicting local edits stop the import.

Missing originals are fetched from recorded URLs, NotoPress's hosted source paths,
or WordPress media metadata (including unscaled originals). If only a thumbnail
remains, or the original extension is ambiguous, the import stops instead of
silently saving a lower resolution replacement. Keep the remote originals available
if you intend to restore deleted local files.

`import --dry-run` prepares the same asset and Markdown plan as a live import,
including read-only image downloads and hashing, but writes no files. Live imports
hold a vault lock, validate local content before applying, install new assets without
overwriting existing files, and stage Markdown and sync state. A sync-state commit
failure rolls back the article. A failed import can leave successfully installed,
unreferenced new assets; retrying reuses them. After a process crash, inspect the
vault before removing a stale `.notopress-wordpress-import.lock` file. Imports do
not mutate WordPress posts or media. Existing asset consolidation is a separate
migration and is not performed automatically.

## Generated artifacts

NotoPress writes cache and index artifacts into the vault, including `root.json`, directory-level `index.json` files, `_rendered/`, `_thumbnails/`, and sitemap files. Do not edit them manually. They are regenerated from Markdown, configuration, and source assets.

When image dimensions are known, generated responsive variants preserve aspect ratio and do not upscale beyond the source. The renderer uses the widths that were actually generated rather than assuming every configured size exists.

## Architecture

The publishing code is organized by responsibility:

```text
scripts/
├── core/            content, state, plans, and adapter contracts
├── adapters/        isolated platform implementations
├── application/     build and command use cases
├── infrastructure/  storage, configuration, processes, and deployment
└── cli/             typed command parsing and dispatch
```

Core code cannot import adapters, application orchestration, infrastructure, or CLI modules. The application layer discovers integrations through the adapter catalog and depends on the generic `ContentPlatformAdapter` contract. Architecture tests enforce these boundaries.

A platform adapter prepares a read-only typed plan and returns an apply operation. NotoPress prepares every selected plan, builds the composite fingerprint, validates any reviewed fingerprint, and only then starts native storage or platform mutations. Adapter-owned state, rendering, remote lookups, imports, and platform payloads stay inside the adapter package.

## Configuration and credentials

Site settings override registry-level storage, image-host, and thumbnail defaults. See [`registry.json.example`](registry.json.example) for the complete shape.

Credentials can live in the uncommitted `registry.json` or environment variables:

```text
S3_ENDPOINT
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
REGISTRY_PATH
```

`npm run configure` writes the selected runtime values to `.env.local`. Never commit real storage or publisher credentials.

## Development

```bash
npm test -- --run
npm run type-check -- --incremental false
npm run lint
npm run build
```

Tests live beside their modules. `scripts/architecture.test.ts` protects the dependency boundaries, while adapter tests cover platform-specific rendering, planning, state, and import behavior.

## License

MIT. See [`LICENSE.md`](LICENSE.md).
