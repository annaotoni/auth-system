import { createHash } from 'node:crypto';

// Tokens opacos já têm entropia suficiente (32 bytes aleatórios); um hash
// rápido basta para não guardar o valor usável em claro no banco.
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
