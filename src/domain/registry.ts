import { z } from 'zod';
import { RewriteRulesSchema } from './rewrites';

export const ThumbnailSizesSchema = z.array(z.number().int().positive()).min(1).optional();

export const WordPressCredentialsSchema = z.object({
  username: z.string(),
  applicationPassword: z.string(),
  endpoint: z.string().url().optional(),
});

export const PlatformDefinitionSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
});

export const SiteSchema = z.object({
  domain: z.string().optional(),
  siteId: z.string(),
  vaultPath: z.string(),
  noteIncludePaths: z.array(z.string()).optional(),
  bucketName: z.string().optional(),
  vercelProjectId: z.string().optional(),
  endpoint: z.string().url().optional(),
  thumbnailSizes: ThumbnailSizesSchema,
  wordpress: WordPressCredentialsSchema.optional(),
  publishers: z.array(PlatformDefinitionSchema).optional(),
  imageHost: z.string().url().optional(),
  rewrites: RewriteRulesSchema.optional(),
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
export type PlatformDefinition = z.infer<typeof PlatformDefinitionSchema>;
