import { computeContentHash } from '../state/sync-state';

/** An expected output; readers are local and never part of a serialized plan. */
export type BuildArtifact = {
  path: string;
  size: number;
  contentHash: string;
  read: () => Promise<Uint8Array>;
  verify?: () => Promise<void>;
  distribution?: {
    sourceSlug: string;
    noteSlugs: readonly string[];
    assets: readonly string[];
  };
};

export type CollectBuildArtifact = (artifact: BuildArtifact) => void;

export function createBuildArtifact({ path, content, read }: {
  path: string;
  content: string | Uint8Array;
  read?: () => Promise<Uint8Array>;
}): BuildArtifact {
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  return { path, size: bytes.byteLength, contentHash: computeContentHash(bytes), read: read || (async () => bytes) };
}

export async function readVerifiedArtifact(artifact: BuildArtifact): Promise<Uint8Array> {
  const bytes = await artifact.read();
  assertArtifactHash({ artifact, actual: { size: bytes.byteLength, contentHash: computeContentHash(bytes) } });
  return bytes;
}

export function assertArtifactHash({ artifact, actual }: {
  artifact: Pick<BuildArtifact, 'path' | 'size' | 'contentHash'>;
  actual: { size: number; contentHash: string };
}): void {
  if (actual.size !== artifact.size || actual.contentHash !== artifact.contentHash) {
    throw new Error(`Prepared artifact changed: ${artifact.path}. Run the dry-run again.`);
  }
}

export function assertBuildSourceHashes({ artifacts, sources }: {
  artifacts: readonly Pick<BuildArtifact, 'path' | 'contentHash'>[];
  sources: readonly Pick<BuildArtifact, 'path' | 'contentHash'>[];
}): void {
  const hashes = new Map(artifacts.map((artifact) => [artifact.path, artifact.contentHash]));
  for (const source of sources) {
    if (hashes.get(source.path) !== source.contentHash) {
      throw new Error(`Build source changed during preparation: ${source.path}. Run the dry-run again.`);
    }
  }
}
