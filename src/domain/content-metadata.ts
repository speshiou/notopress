import { z } from 'zod';

export const TaxonomySlugSchema = z.string().trim().min(1);

export const ContentTaxonomiesSchema = z.object({
  categories: z.array(TaxonomySlugSchema).optional(),
  tags: z.array(TaxonomySlugSchema).optional(),
});

export type ContentTaxonomies = z.infer<typeof ContentTaxonomiesSchema>;
