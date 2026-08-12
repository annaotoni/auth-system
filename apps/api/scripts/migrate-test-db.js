// Aplica as migrations no banco de teste isolado (nunca no de dev/produção)
// antes da suíte e2e real rodar. Roda via `pretest:e2e:real` no package.json.
const { execSync } = require('node:child_process');

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://auth:auth@localhost:5432/auth_system_test?schema=public';

if (!TEST_DATABASE_URL.includes('_test')) {
  throw new Error(
    `Recusando migrar: TEST_DATABASE_URL não parece um banco de teste (esperado "_test" no nome) — ${TEST_DATABASE_URL}`,
  );
}

execSync('npx prisma migrate deploy', {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
});
