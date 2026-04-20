import { z } from 'zod';

export const SiteSchema = z.object({
  domain: z.string(),
  siteId: z.string(),
  vaultPath: z.string(),
  bucketName: z.string().optional(),
  vercelProjectId: z.string().optional(),
});

export const RegistrySchema = z.object({
  accountId: z.string(),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  sites: z.array(SiteSchema),
});

export type Site = z.infer<typeof SiteSchema>;
export type Registry = z.infer<typeof RegistrySchema>;
