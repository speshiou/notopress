import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_REGISTRY_FILENAME } from '../../../src/lib/constants';
import { assertArtifactHash, readVerifiedArtifact, type BuildArtifact } from '../../core/content/build-artifact';
import { mapWithConcurrency } from '../../core/concurrency';
import { hashByteStream } from './hash-stream';

type SnapshotFilesystem = {
  createTemporaryDirectory: () => Promise<string>;
  mkdir: (directory: string) => Promise<unknown>;
  copy: (input: { source: string; destination: string }) => Promise<void>;
  stat: (file: string) => Promise<{ atime: Date; mtime: Date }>;
  setTimes: (input: { file: string; atime: Date; mtime: Date }) => Promise<void>;
  hash: (file: string) => Promise<{ size: number; contentHash: string }>;
  write: (input: { file: string; bytes: Uint8Array }) => Promise<void>;
  remove: (directory: string) => Promise<void>;
};
const nativeFilesystem: SnapshotFilesystem = {
  createTemporaryDirectory: () => mkdtemp(path.join(tmpdir(), 'notopress-aws-')),
  mkdir: (directory) => mkdir(directory, { recursive: true }),
  copy: ({ source, destination }) => copyFile(source, destination, constants.COPYFILE_FICLONE),
  stat,
  setTimes: ({ file, atime, mtime }) => utimes(file, atime, mtime),
  hash: (file) => hashByteStream(createReadStream(file)),
  write: async ({ file, bytes }) => {
    await rm(file, { force: true });
    await writeFile(file, bytes);
  },
  remove: (directory) => rm(directory, { recursive: true, force: true }),
};

export async function createStorageSnapshot({ vaultPath, artifacts, filesystem = nativeFilesystem }: {
  vaultPath: string;
  artifacts: readonly (BuildArtifact & { key: string })[];
  filesystem?: SnapshotFilesystem;
}) {
  const directory = await filesystem.createTemporaryDirectory();
  const snapshotPath = path.join(directory, 'vault');
  const registryPath = path.join(directory, DEFAULT_REGISTRY_FILENAME);
  const configPath = path.join(directory, 'aws-config');
  try {
    await filesystem.mkdir(snapshotPath);
    await filesystem.write({ file: configPath, bytes: Buffer.from('[default]\nregion = auto\ns3 =\n    preferred_transfer_client = classic\n') });
    await mapWithConcurrency({ items: artifacts, concurrency: 8, worker: async (artifact) => {
      if (artifact.key === DEFAULT_REGISTRY_FILENAME) {
        await filesystem.write({ file: registryPath, bytes: await readVerifiedArtifact(artifact) });
        return;
      }
      const file = path.join(snapshotPath, artifact.path);
      await filesystem.mkdir(path.dirname(file));
      let unchanged = false;
      try {
        const times = await filesystem.stat(path.join(vaultPath, artifact.path));
        await filesystem.copy({ source: path.join(vaultPath, artifact.path), destination: file });
        const copied = await filesystem.hash(file);
        unchanged = copied.size === artifact.size && copied.contentHash === artifact.contentHash;
        if (unchanged) await filesystem.setTimes({ file, atime: times.atime, mtime: times.mtime });
      } catch (error: unknown) {
        if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      if (!unchanged) await filesystem.write({ file, bytes: await readVerifiedArtifact(artifact) });
    } });
    return {
      snapshotPath, registryPath, configPath,
      async verify() {
        for (const artifact of artifacts) {
          const file = artifact.key === DEFAULT_REGISTRY_FILENAME ? registryPath : path.join(snapshotPath, artifact.path);
          assertArtifactHash({ artifact, actual: await filesystem.hash(file) });
        }
      },
      close: () => filesystem.remove(directory),
    };
  } catch (error: unknown) {
    await filesystem.remove(directory);
    throw error;
  }
}
