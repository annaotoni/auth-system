import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';

@Injectable()
export class HibpService {
  private readonly logger = new Logger(HibpService.name);

  // k-anonymity: só os 5 primeiros chars do SHA-1 saem da aplicação: a API
  // nunca recebe a senha nem o hash completo. Checagem é opcional por
  // natureza — indisponibilidade do HIBP nunca deve bloquear o usuário.
  async isPasswordPwned(password: string): Promise<boolean> {
    const sha1 = createHash('sha1')
      .update(password)
      .digest('hex')
      .toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    try {
      const response = await fetch(`${HIBP_RANGE_URL}${prefix}`);

      if (!response.ok) {
        return false;
      }

      const body = await response.text();
      return body
        .split('\n')
        .some((line) => line.split(':')[0].trim() === suffix);
    } catch (error) {
      this.logger.warn(
        `Falha ao consultar HIBP, seguindo sem bloquear: ${error}`,
      );
      return false;
    }
  }
}
