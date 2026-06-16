import { z } from 'zod';

export const ThumbnailSizesSchema = z.array(z.number().int().positive()).min(1).optional();

export const WordPressCredentialsSchema = z.object({
  username: z.string(),
  applicationPassword: z.string(),
  endpoint: z.string().url().optional(),
});

export const SiteSchema = z.object({
  domain: z.string().optional(),
  siteId: z.string(),
  vaultPath: z.string(),
  bucketName: z.string().optional(),
  vercelProjectId: z.string().optional(),
  endpoint: z.string().url().optional(),
  thumbnailSizes: ThumbnailSizesSchema,
  wordpress: WordPressCredentialsSchema.optional(),
  imageHost: z.string().url().optional(),
});

export const RegistrySchema = z.object({
  endpoint: z.string().url().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  thumbnailSizes: ThumbnailSizesSchema,
  imageHost: z.string().url().optional(),
  sites: z.array(SiteSchema),
});

export type Site = z.infer<typeof SiteSchema>;
export type Registry = z.infer<typeof RegistrySchema>;

