import { createOperationPlan, type OperationPlan } from '../../core/publishing/operation-plan';
import type { ImportedAsset, WordPressAssetEntry } from './import-assets';

export type WordPressImportOperation =
  | { kind: 'context'; scope: string; previousStateHash: string | null; assetFolder: string }
  | { kind: 'asset'; asset: ImportedAsset }
  | { kind: 'markdown'; path: string; markdown: string; previousHash: string | null };

export function createWordPressImportPlan({ assets, path, markdown, previousHash, scope, previousStateHash, assetFolder }: {
  scope: string;
  previousStateHash: string | null;
  assetFolder: string;
  assets: readonly ImportedAsset[];
  path: string;
  markdown: string;
  previousHash: string | null;
}): OperationPlan<WordPressImportOperation> {
  const operations: WordPressImportOperation[] = [
    { kind: 'context', scope, previousStateHash, assetFolder },
    ...assets.map((asset): WordPressImportOperation => ({ kind: 'asset', asset })),
    { kind: 'markdown', path, markdown, previousHash },
  ];
  return createOperationPlan({ kind: 'wordpress-import', operations, serializeOperation: (operation) => {
    if (operation.kind !== 'asset') return operation;
    const { bytes, ...asset } = operation.asset;
    return { kind: operation.kind, asset, action: bytes ? 'download' : 'reuse' };
  } });
}

export function createWordPressImportApplier(deps: {
  getHash: (path: string) => Promise<string | null>;
  hash: (bytes: Buffer) => string;
  assetPath: (asset: ImportedAsset) => string;
  writeAsset: (input: { path: string; bytes: Buffer }) => Promise<void>;
  commit: (input: { path: string; markdown: string; entries: Record<string, WordPressAssetEntry> }) => Promise<void>;
  assetKey: (source: string) => string;
}) {
  return async ({ plan }: { plan: OperationPlan<WordPressImportOperation> }) => {
    const assets = plan.operations.filter((operation) => operation.kind === 'asset').map((operation) => operation.asset);
    const markdown = plan.operations.find((operation) => operation.kind === 'markdown');
    if (!markdown || markdown.kind !== 'markdown') throw new Error('Import plan has no Markdown operation.');
    if (await deps.getHash(markdown.path) !== markdown.previousHash) throw new Error('Local article changed during import. Run the import again.');
    for (const asset of assets) {
      const currentHash = await deps.getHash(deps.assetPath(asset));
      if (currentHash !== null && currentHash !== asset.contentHash) throw new Error(`Local image changed during import: ${asset.path}`);
      const pendingDownload = assets.some((candidate) => candidate.bytes && deps.assetPath(candidate) === deps.assetPath(asset) && candidate.contentHash === asset.contentHash);
      if (currentHash === null && !asset.bytes && !pendingDownload) throw new Error(`Local image disappeared during import: ${asset.path}`);
      if (asset.bytes && deps.hash(asset.bytes) !== asset.contentHash) throw new Error('Import asset bytes do not match the reviewed plan.');
    }
    for (const asset of assets) {
      if (asset.bytes) await deps.writeAsset({ path: deps.assetPath(asset), bytes: asset.bytes });
    }
    const entries: Record<string, WordPressAssetEntry> = {};
    for (const asset of assets) entries[deps.assetKey(asset.source)] = {
      root: asset.root, path: asset.path, originalUrl: asset.originalUrl, contentHash: asset.contentHash,
    };
    await deps.commit({ path: markdown.path, markdown: markdown.markdown, entries });
  };
}
