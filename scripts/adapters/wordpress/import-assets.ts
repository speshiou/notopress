import path from 'node:path';
import { z } from 'zod';
import { safelyDecodeUriComponent } from '../../../src/lib/local-images';
import { getAssetUrl, isGeneratedThumbnailPath } from '../../../src/lib/responsive-images';
import { isSafeAssetPath, SourceAssetFolderSchema } from '../../../src/domain/asset-path';
import { THUMBNAILS_DIR } from '../../../src/lib/constants';

export const WORDPRESS_ASSET_STATE_SECTION = 'wordpressAssets';
export const DEFAULT_WORDPRESS_ASSET_FOLDER = 'assets';
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif', '.tif', '.tiff'];
export function isWordPressImportImage(file: string): boolean {
  return IMAGE_EXTENSIONS.includes(path.posix.extname(file).toLowerCase());
}

const RelativeAssetPathSchema = z.string().min(1).refine(isSafeAssetPath);
export const WordPressAssetEntrySchema = z.object({
  root: z.enum(['content', 'public']),
  path: RelativeAssetPathSchema,
  originalUrl: z.string().url(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const WordPressAssetStateSchema = z.record(z.string(), WordPressAssetEntrySchema);
export type WordPressAssetEntry = z.infer<typeof WordPressAssetEntrySchema>;
export type LocalAsset = { root: 'content' | 'public'; path: string };
export type ImportedAsset = LocalAsset & { source: string; originalUrl: string; contentHash: string; bytes?: Buffer };
export type AssetReference = LocalAsset & { source: string; originalUrls: readonly string[]; hosted: boolean };

export function getWordPressAssetDestination({ filename, folder = DEFAULT_WORDPRESS_ASSET_FOLDER, contentHash }: {
  filename: string;
  folder?: string;
  contentHash: string;
}): LocalAsset {
  SourceAssetFolderSchema.parse(folder);
  const ext = path.posix.extname(filename).toLowerCase();
  if (!IMAGE_EXTENSIONS.includes(ext)) throw new Error('Unsupported original image extension.');
  const basename = path.posix.basename(filename, ext).replace(/[^\p{L}\p{N}._-]/gu, '-').slice(0, 80) || 'image';
  return { root: 'content', path: `${folder}/${basename}-${contentHash.slice(0, 16)}${ext}` };
}

export function getWordPressAssetScope({ endpoint, hash }: { endpoint: string; hash: (value: string | Buffer) => string }): string {
  return hash(new URL(endpoint).href.replace(/\/$/, ''));
}

export function getWordPressAssetKey({ scope, source }: { scope: string; source: string }): string {
  return `${scope}:${source}`;
}

function cleanUrl(source: string): string {
  const url = new URL(source);
  url.hash = '';
  return url.href;
}

export function createWordPressAssetImporter({
  vaultPath, siteId, imageHost, folder = DEFAULT_WORDPRESS_ASSET_FOLDER, scope, state,
  exists, read, list, hash, fetchOriginal,
}: {
  vaultPath: string;
  siteId: string;
  imageHost?: string;
  folder?: string;
  scope: string;
  state: Record<string, WordPressAssetEntry>;
  exists: (file: string) => boolean;
  read: (file: string) => Promise<Buffer>;
  list: () => Promise<LocalAsset[]>;
  hash: (value: string | Buffer) => string;
  fetchOriginal: (input: { source: string; candidates: readonly string[]; hosted: boolean }) => Promise<{ url: string; bytes: Buffer }>;
}) {
  SourceAssetFolderSchema.parse(folder);
  const references = new Map<string, AssetReference>();
  const prepared = new Map<string, ImportedAsset>();
  const fullPath = (asset: LocalAsset) => path.join(vaultPath, asset.root, asset.path);
  const originalUrl = (asset: LocalAsset) => getAssetUrl({ imageHost, siteId, s3SubDir: asset.root, filePath: asset.path.split('/').map(encodeURIComponent).join('/'), mode: 'absolute' });

  function parseHostedAsset(source: string): LocalAsset | undefined {
    if (!imageHost) return undefined;
    for (const root of ['content', 'public'] as const) {
      const prefix = getAssetUrl({ imageHost, siteId, s3SubDir: root, filePath: '', mode: 'absolute' });
      if (source.startsWith(prefix)) {
        const assetPath = safelyDecodeUriComponent({ value: new URL(source).pathname.slice(new URL(prefix).pathname.length) });
        if (!isSafeAssetPath(assetPath)) throw new Error('Unsafe hosted image path in WordPress content.');
        return { root, path: assetPath };
      }
    }
    return undefined;
  }

  function resolve({ src }: { src: string }): string {
    if (!src) return src;
    if (!/^https?:\/\//i.test(src) && !src.startsWith('//') && !src.startsWith('/api/vault-public/')) {
      const relative = safelyDecodeUriComponent({ value: src.replace(/^\//, '') });
      if (!isSafeAssetPath(relative)) throw new Error('Unsafe local image path in WordPress content.');
      return relative;
    }
    const source = cleanUrl(new URL(src, imageHost).href);
    const prior = prepared.get(source) || references.get(source);
    if (prior) return prior.path;
    const mapped = state[getWordPressAssetKey({ scope, source })];
    const url = new URL(source);
    let local: LocalAsset | undefined;
    let hosted = false;
    let candidates: string[] = [];
    const hostedAsset = parseHostedAsset(source);
    const hostedRoot = hostedAsset?.root;
    const hostedPath = hostedAsset?.path ?? (src.startsWith('/api/vault-public/')
      ? safelyDecodeUriComponent({ value: src.slice('/api/vault-public/'.length).split(/[?#]/)[0] }) : undefined);
    if (hostedPath !== undefined) {
      hosted = true;
      if (!isSafeAssetPath(hostedPath)) throw new Error('Unsafe hosted image path in WordPress content.');
      const roots: ('content' | 'public')[] = hostedRoot ? [hostedRoot] : ['content', 'public'];
      const thumbnail = hostedPath.startsWith(`${THUMBNAILS_DIR}/`);
      const base = thumbnail ? hostedPath.slice(THUMBNAILS_DIR.length + 1).replace(/-\d+\.webp$/, '') : hostedPath;
      const paths = thumbnail ? IMAGE_EXTENSIONS.map((ext) => `${base}${ext}`) : [base];
      const matches = roots.flatMap((root) => paths.map((assetPath) => ({ root, path: assetPath })))
        .filter((asset) => exists(fullPath(asset)));
      if (!mapped && matches.length > 1) throw new Error(`Ambiguous original image for ${src}. Keep one original or restore its recorded mapping.`);
      // A recorded path takes precedence over extension guessing, even when missing.
      local = mapped || matches[0];
      candidates = mapped ? [mapped.originalUrl] : roots.flatMap((root) => paths.map((assetPath) => originalUrl({ root, path: assetPath })));
    }
    if (!local && mapped) local = mapped;
    if (!local) {
      const filename = safelyDecodeUriComponent({ value: path.posix.basename(url.pathname) });
      const ext = path.posix.extname(filename).toLowerCase();
      if (!IMAGE_EXTENSIONS.includes(ext)) throw new Error(`Unsupported image source: ${src}`);
      const base = path.posix.basename(filename, ext).replace(/-\d+x\d+$/, '').replace(/[^\p{L}\p{N}._-]/gu, '-').slice(0, 80) || 'image';
      local = { root: 'content', path: `${folder}/${base}-${hash(`${scope}:${source}`).slice(0, 16)}${ext}` };
    }
    references.set(source, { ...local, source, hosted, originalUrls: candidates });
    return local.path;
  }

  async function prepare(): Promise<ImportedAsset[]> {
    const operations: ImportedAsset[] = [];
    let localAssets: LocalAsset[] | undefined;
    const knownByHash = new Map<string, LocalAsset>();
    const scanned = new Set<string>();
    for (const reference of references.values()) {
      const mapped = state[getWordPressAssetKey({ scope, source: reference.source })];
      const present = exists(fullPath(reference));
      const localBytes = present ? await read(fullPath(reference)) : undefined;
      const localHash = localBytes ? hash(localBytes) : undefined;
      if (mapped && localHash && localHash !== mapped.contentHash) {
        throw new Error(`Locally modified image conflicts with WordPress import: ${reference.path}`);
      }
      if (reference.hosted && present && localHash) {
        const asset = { ...reference, originalUrl: mapped?.originalUrl || originalUrl(reference), contentHash: localHash };
        prepared.set(reference.source, asset);
        operations.push(asset);
        continue;
      }
      const downloaded = await fetchOriginal({ source: reference.source, candidates: reference.originalUrls, hosted: reference.hosted });
      const contentHash = hash(downloaded.bytes);
      let destination: LocalAsset | undefined;
      if (present && localHash === contentHash) destination = reference;
      if (!destination) destination = knownByHash.get(contentHash);
      if (!destination) {
        localAssets ??= await list();
        for (const candidate of localAssets) {
          if (isGeneratedThumbnailPath(candidate.path) || candidate.path.split('/').some((part) => part.startsWith('_') || part.startsWith('.'))) continue;
          const candidatePath = fullPath(candidate);
          if (scanned.has(candidatePath)) continue;
          scanned.add(candidatePath);
          const candidateHash = hash(await read(candidatePath));
          knownByHash.set(candidateHash, candidate);
          if (candidateHash === contentHash) { destination = candidate; break; }
        }
      }
      let bytes: Buffer | undefined;
      if (!destination) {
        const filename = safelyDecodeUriComponent({ value: path.posix.basename(new URL(downloaded.url).pathname) });
        const ext = path.posix.extname(filename).toLowerCase();
        if (!IMAGE_EXTENSIONS.includes(ext)) throw new Error(`Original has an unsupported image extension: ${downloaded.url}`);
        destination = mapped && mapped.contentHash === contentHash ? mapped
          : getWordPressAssetDestination({ filename, folder, contentHash });
        if (reference.hosted && !mapped) destination = parseHostedAsset(downloaded.url) || destination;
        if (exists(fullPath(destination))) {
          if (hash(await read(fullPath(destination))) !== contentHash) throw new Error(`Asset filename collision: ${destination.path}`);
        } else bytes = downloaded.bytes;
      }
      knownByHash.set(contentHash, destination);
      const asset = { ...destination, source: reference.source, originalUrl: downloaded.url, contentHash, bytes };
      prepared.set(reference.source, asset);
      operations.push(asset);
    }
    return operations;
  }

  function isHosted({ src }: { src: string }): boolean {
    return references.get(cleanUrl(new URL(src, imageHost).href))?.hosted === true;
  }

  return { resolve, prepare, isHosted, references: () => [...references.values()] };
}
