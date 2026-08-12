import { HashOptions, argon2id } from 'argon2';

// Parametros OWASP para Argon2id.
export const ARGON2_OPTIONS: HashOptions = {
  type: argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};
