import { z } from 'zod';

export const ThumbnailSizesSchema = z.array(z.number().int().positive()).min(1).optional();

export const SiteSchema = z.object({
  domain: z.string().optional(),
  siteId: z.string(),
  vaultPath: z.string(),
  bucketName: z.string().optional(),
  vercelProjectId: z.string().optional(),
  endpoint: z.string().url().optional(),
  thumbnailSizes: ThumbnailSizesSchema,
});

export const RegistrySchema = z.object({
  endpoint: z.string().url().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  thumbnailSizes: ThumbnailSizesSchema,
  sites: z.array(SiteSchema),
});

export type Site = z.infer<typeof SiteSchema>;
export type Registry = z.infer<typeof RegistrySchema>;
