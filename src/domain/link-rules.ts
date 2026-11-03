import { z } from 'zod';

const HostnameSchema = z.string().trim().toLowerCase().transform((value) => value.replace(/\.$/, ''))
  .pipe(z.string().regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, 'Expected a hostname without a scheme, port, path, or wildcard.'));

export const LinkRuleSchema = z.object({
  name: z.string().trim().min(1).optional(),
  hostnames: z.array(HostnameSchema).min(1),
  includeSubdomains: z.boolean().optional(),
  query: z.record(z.string(), z.string()).optional(),
  rel: z.array(z.enum(['sponsored', 'ugc', 'nofollow', 'noopener', 'noreferrer', 'external'])).min(1).optional(),
  target: z.enum(['_blank', '_self']).optional(),
}).strict().refine((rule) => rule.rel !== undefined || rule.target !== undefined, {
  message: 'A link rule must specify rel or target.',
});

export const LinkRulesSchema = z.array(LinkRuleSchema);
export type LinkRule = z.infer<typeof LinkRuleSchema>;
