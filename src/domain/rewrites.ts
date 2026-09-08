import { z } from 'zod';

export const RewriteRuleSchema = z.object({
  source: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !value.startsWith('/'), {
      message: 'Rewrite source must be a vault path under content/ without a leading slash.',
    }),
  destination: z
    .string()
    .trim()
    .min(1)
    .refine((value) => value.startsWith('/'), {
      message: 'Rewrite destination must be a public URL path starting with /.',
    }),
});

export const RewriteRulesSchema = z.array(RewriteRuleSchema);

export type RewriteRule = z.infer<typeof RewriteRuleSchema>;
export type RewriteRules = z.infer<typeof RewriteRulesSchema>;
