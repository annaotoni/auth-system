import { HashOptions, argon2id, hash } from 'argon2';

// Parametros OWASP para Argon2id.
export const ARGON2_OPTIONS: HashOptions = {
  type: argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

let dummyHashPromise: Promise<string> | null = null;

// Verificar contra um hash real, mesmo quando o usuário não existe, custa o
// mesmo tempo que uma verificação legítima — sem isso, o tempo de resposta
// denunciaria se o e-mail está cadastrado. Calculado uma vez e cacheado.
export function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hash('dummy-password-for-timing-safety', ARGON2_OPTIONS);
  return dummyHashPromise;
}
