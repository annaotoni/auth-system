import { z } from 'zod';

// Falha rápido no boot: credencial ausente ou malformada nunca deve chegar ao runtime.
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    throw new Error(
      `Variáveis de ambiente inválidas:\n${result.error.toString()}`,
    );
  }

  return result.data;
}
