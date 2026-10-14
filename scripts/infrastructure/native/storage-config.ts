import type { Registry, Site } from '../../../src/domain/registry';
import { env } from '../../../src/lib/env';
import { StorageTargetSchema, type StorageTarget } from '../../core/storage/target';

export type StorageConnection = {
  target: StorageTarget;
  credentials: { accessKeyId: string; secretAccessKey: string };
};

export function getStorageConnection({ site, registry, environment = env }: {
  site: Site;
  registry: Registry;
  environment?: Pick<typeof env, 'S3_ENDPOINT' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY'>;
}): StorageConnection {
  const endpoint = site.endpoint || registry.endpoint || environment.S3_ENDPOINT;
  const accessKeyId = registry.accessKeyId || environment.S3_ACCESS_KEY_ID;
  const secretAccessKey = registry.secretAccessKey || environment.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey || !site.bucketName) {
    throw new Error('Missing storage configuration. Provide the destination and credentials through the registry or environment.');
  }
  const target = StorageTargetSchema.safeParse({ endpoint, bucket: site.bucketName, siteId: site.siteId });
  if (!target.success) throw new Error('Invalid storage destination. HTTP(S) endpoints must not contain credentials, query parameters or fragments; site IDs must be single relative segments.');
  return {
    target: target.data,
    credentials: { accessKeyId, secretAccessKey },
  };
}
