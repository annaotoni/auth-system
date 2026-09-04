import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { generateSecret, generateURI, verify } from 'otplib';
import * as qrcode from 'qrcode';
import { randomUUID } from 'node:crypto';
import { MFA_CHALLENGE_TTL_S } from '../auth.constants';

const CHALLENGE_PREFIX = 'mfa:challenge:';

export interface MfaSetupResult {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

@Injectable()
export class MfaService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'));
  }

  onModuleDestroy() {
    void this.redis.quit();
  }

  // Gera um segredo TOTP e o QR code para o usuário escanear no app autenticador.
  async generateSetup(userEmail: string): Promise<MfaSetupResult> {
    const secret = generateSecret();
    const otpauthUrl = generateURI({
      issuer: 'auth-system',
      label: userEmail,
      secret,
    });
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);
    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  // Verifica o token TOTP contra o segredo do usuário.
  async verifyToken(token: string, secret: string): Promise<boolean> {
    const result = await verify({ token, secret });
    return result.valid;
  }

  // Emite um challenge opaco que identifica o userId pendente de MFA.
  async issueChallenge(userId: string): Promise<string> {
    const challengeId = randomUUID();
    await this.redis.set(
      `${CHALLENGE_PREFIX}${challengeId}`,
      userId,
      'EX',
      MFA_CHALLENGE_TTL_S,
    );
    return challengeId;
  }

  // Recupera e consome o challenge — uso único.
  async consumeChallenge(challengeId: string): Promise<string | null> {
    const key = `${CHALLENGE_PREFIX}${challengeId}`;
    const userId = await this.redis.getdel(key);
    return userId;
  }
}
