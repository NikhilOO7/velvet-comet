/**
 * Config validated once, at startup, fail-fast (PLAN.md §12). Nothing else in
 * the codebase reads process.env directly.
 */
import { z } from 'zod';

const EnvSchema = z.object({
  FIRECRAWL_API_KEY: z.string().min(1).optional(),
  FIRECRAWL_BASE_URL: z.string().url().default('https://api.firecrawl.dev'),
  FIRECRAWL_RPM: z.coerce.number().int().positive().default(5000),
  FIRECRAWL_MAX_CONCURRENCY: z.coerce.number().int().positive().default(100),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parse and validate the environment. Throws (fail-fast) on invalid config. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}
