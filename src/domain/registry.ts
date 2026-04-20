import { z } from 'zod';

export const SiteSchema = z.object({
  domain: z.string(),
  siteId: z.string(),
  vaultPath: z.string(),
});

export const RegistrySchema = z.object({
  sites: z.array(SiteSchema),
});

export type Site = z.infer<typeof SiteSchema>;
export type Registry = z.infer<typeof RegistrySchema>;
