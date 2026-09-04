import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const BLOCKLIST_PREFIX = 'blocklist:jti:';

@Injectable()
export class TokenBlocklistService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'));
  }

  onModuleDestroy() {
    void this.redis.quit();
  }

  // Registra o jti como inválido até o token expirar naturalmente.
  async block(jti: string, expiresAt: number): Promise<void> {
    const ttlSeconds = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
    if (ttlSeconds === 0) return;
    await this.redis.set(`${BLOCKLIST_PREFIX}${jti}`, '1', 'EX', ttlSeconds);
  }

  async isBlocked(jti: string): Promise<boolean> {
    const result = await this.redis.exists(`${BLOCKLIST_PREFIX}${jti}`);
    return result === 1;
  }
}
