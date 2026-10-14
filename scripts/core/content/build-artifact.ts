import { computeContentHash } from '../state/sync-state';

/** An expected output; readers are local and never part of a serialized plan. */
export type BuildArtifact = {
  path: string;
  size: number;
  contentHash: string;
  read: () => Promise<Uint8Array>;
  verify?: () => Promise<void>;
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
