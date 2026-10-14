import { z } from 'zod';
import { isRelativeObjectPath, isManagedStorageKey } from './paths';

const ContentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
function isPublicStorageEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export const StorageTargetSchema = z.object({
  endpoint: z.string().url().refine(isPublicStorageEndpoint).transform((value) => new URL(value).toString().replace(/\/+$/, '')),
  bucket: z.string().min(1),
  siteId: z.string().refine((value) => isRelativeObjectPath(value) && !value.includes('/')),
}).strict();

export const StorageEntrySchema = z.object({
  key: z.string().refine(isRelativeObjectPath),
  size: z.number().int().nonnegative(),
  contentHash: ContentHashSchema.nullable(),
  etag: z.string().min(1),
}).strict();

export const StorageManifestSchema = z.object({
  version: z.literal(1),
  target: StorageTargetSchema,
  generation: z.string().min(1),
  status: z.enum(['ready', 'pending']),
  planFingerprint: ContentHashSchema.nullable(),
  entries: z.array(StorageEntrySchema),
}).strict().superRefine((manifest, context) => {
  const keys = new Set<string>();
  for (const entry of manifest.entries) {
    if (keys.has(entry.key) || !isManagedStorageKey({ siteId: manifest.target.siteId, key: entry.key })) {
      context.addIssue({ code: 'custom', message: 'Duplicate or out-of-scope storage entry.' });
    }
    keys.add(entry.key);
  }
});

export type StorageTarget = z.infer<typeof StorageTargetSchema>;
export type StorageEntry = z.infer<typeof StorageEntrySchema>;
export type StorageManifest = z.infer<typeof StorageManifestSchema>;

export function sameStorageTarget({ left, right }: { left: StorageTarget; right: StorageTarget }): boolean {
  return left.endpoint === right.endpoint && left.bucket === right.bucket && left.siteId === right.siteId;
}
