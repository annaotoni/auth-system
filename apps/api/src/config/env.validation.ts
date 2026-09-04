import { z } from 'zod';

// Falha rápido no boot: credencial ausente ou malformada nunca deve chegar ao runtime.
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  SMTP_HOST: z.string().min(1).default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  // z.coerce.boolean() faz Boolean(string): "false" (não-vazia) virava true.
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().email().default('noreply@auth-system.local'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((val) =>
      val
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    )
    .refine(
      (origins) =>
        origins.every((o) => {
          try {
            new URL(o);
            return true;
          } catch {
            return false;
          }
        }),
      {
        message: 'CORS_ORIGINS deve conter URLs válidas separadas por vírgula',
      },
    ),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string().min(32),
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
