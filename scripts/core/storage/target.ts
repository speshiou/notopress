import { z } from 'zod';
import { isRelativeObjectPath } from './paths';

export const StorageTargetSchema = z.object({
  endpoint: z.string().url().refine((value) => {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }).transform((value) => new URL(value).toString().replace(/\/+$/, '')),
  bucket: z.string().min(1).refine((value) => isRelativeObjectPath(value) && !value.includes('/') && !/\s/.test(value)),
  siteId: z.string().refine((value) => isRelativeObjectPath(value) && !value.includes('/')),
}).strict();

export type StorageTarget = z.infer<typeof StorageTargetSchema>;
