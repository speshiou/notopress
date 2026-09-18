import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import type { Registry, Site } from '../../../src/domain/registry';
import { env } from '../../../src/lib/env';
import { exists } from '../../core/files';
import { buildS3SyncArgs } from './s3-sync';
import { runProcess } from '../process';

function getEndpoint({ site, registry }: { site: Site; registry: Registry }): string | undefined {
  return site.endpoint || registry.endpoint || env.S3_ENDPOINT;
}

function getS3Credentials({ registry }: { registry: Registry }) {
  return {
    accessKeyId: registry.accessKeyId || env.S3_ACCESS_KEY_ID,
    secretAccessKey: registry.secretAccessKey || env.S3_SECRET_ACCESS_KEY,
  };
}

async function syncSite({
  site,
  registry,
  dryRun,
  deleteRemoteFiles,
  verbose,
}: {
  site: Site;
  registry: Registry;
  dryRun: boolean;
  deleteRemoteFiles: boolean;
  verbose: boolean;
}): Promise<void> {
  const endpoint = getEndpoint({ site, registry });
  const { accessKeyId, secretAccessKey } = getS3Credentials({ registry });
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing S3 credentials. Provide them in registry.json or through the S3 environment variables.');
  }
  if (!site.bucketName) throw new Error(`"bucketName" is not configured for site [${site.siteId}].`);

  console.log(`\n☁️  Preparing AWS S3 Sync...`);
  console.log(`- Local Path: ${site.vaultPath}`);
  console.log(`- S3 Bucket:  ${site.bucketName}`);
  console.log(`- Endpoint:   ${endpoint}\n`);

  const args = buildS3SyncArgs({
    vaultPath: site.vaultPath,
    bucketName: site.bucketName,
    siteId: site.siteId,
    endpoint,
    deleteRemoteFiles,
    dryRun,
    verbose,
  });
  console.log(`Executing:\n> aws ${args.join(' ')}\n`);
  await runProcess({
    command: 'aws',
    args,
    options: {
      stdio: 'inherit',
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: accessKeyId,
        AWS_SECRET_ACCESS_KEY: secretAccessKey,
      },
    },
  });
  console.log(dryRun ? '✅ S3 sync preview completed.' : '✅ S3 sync completed.');
}

async function uploadSanitizedRegistry({ site, registry }: { site: Site; registry: Registry }): Promise<void> {
  const endpoint = getEndpoint({ site, registry });
  const { accessKeyId, secretAccessKey } = getS3Credentials({ registry });
  if (!endpoint || !accessKeyId || !secretAccessKey || !site.bucketName) return;

  const sanitizedRegistry = {
    sites: registry.sites
      .filter((candidate) => candidate.bucketName === site.bucketName)
      .map((candidate) => ({ domain: candidate.domain, siteId: candidate.siteId })),
  };
  const temporaryPath = join(tmpdir(), `notopress-registry-${randomUUID()}.json`);
  try {
    await writeFile(temporaryPath, JSON.stringify(sanitizedRegistry, null, 2));
    await runProcess({
      command: 'aws',
      args: [
        's3', 'cp', temporaryPath, `s3://${site.bucketName}/registry.json`,
        '--endpoint-url', endpoint,
        '--only-show-errors',
      ],
      options: {
        stdio: 'inherit',
        env: {
          ...process.env,
          AWS_ACCESS_KEY_ID: accessKeyId,
          AWS_SECRET_ACCESS_KEY: secretAccessKey,
        },
      },
    });
  } finally {
    if (await exists(temporaryPath)) await unlink(temporaryPath);
  }
}

export async function applyNativeSite({
  site,
  registry,
  dryRun,
  deleteRemoteFiles,
  verbose,
}: {
  site: Site;
  registry: Registry;
  dryRun: boolean;
  deleteRemoteFiles: boolean;
  verbose: boolean;
}): Promise<void> {
  await syncSite({ site, registry, dryRun, deleteRemoteFiles, verbose });
  if (!dryRun) await uploadSanitizedRegistry({ site, registry });
}
