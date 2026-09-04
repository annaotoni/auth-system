import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthModule } from '../src/modules/auth/auth.module';
import { HibpService } from '../src/modules/hibp/hibp.service';
import { MfaService } from '../src/modules/auth/services/mfa.service';
import { TokenBlocklistService } from '../src/modules/auth/services/token-blocklist.service';
import { MailService } from '../src/modules/mail/mail.service';
import { UsersModule } from '../src/modules/users/users.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

const TEST_ENV = {
  JWT_ACCESS_SECRET: 'e2e-test-secret-com-pelo-menos-32-caracteres',
  NODE_ENV: 'test',
};

// Exercita o ThrottlerGuard de ponta a ponta contra os limites reais
// configurados via @Throttle() nas rotas sensíveis. Prisma/Mail/HIBP
// mockados, sem banco real nem chamada de rede.
describe('Throttler (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => TEST_ENV],
        }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
        AuthModule,
        UsersModule,
        PrismaModule,
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    })
      .overrideProvider(PrismaService)
      .useValue({
        user: { findUnique: jest.fn().mockResolvedValue(null) },
        authAuditLog: { create: jest.fn() },
        emailVerificationToken: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
        passwordResetToken: { findUnique: jest.fn().mockResolvedValue(null) },
        refreshToken: { findUnique: jest.fn().mockResolvedValue(null) },
      })
      .overrideProvider(MailService)
      .useValue({
        sendVerificationEmail: jest.fn(),
        sendPasswordResetEmail: jest.fn(),
      })
      .overrideProvider(HibpService)
      .useValue({ isPasswordPwned: jest.fn().mockResolvedValue(false) })
      .overrideProvider(TokenBlocklistService)
      .useValue({
        block: jest.fn(),
        isBlocked: jest.fn().mockResolvedValue(false),
      })
      .overrideProvider(MfaService)
      .useValue({
        generateSetup: jest.fn(),
        verifyToken: jest.fn().mockResolvedValue(false),
        issueChallenge: jest.fn(),
        consumeChallenge: jest.fn().mockResolvedValue(null),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('bloqueia com 429 depois de exceder o limite de /auth/login (5 por minuto)', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'ninguem@example.com', password: 'qualquer' })
        .expect(401);
    }

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'ninguem@example.com', password: 'qualquer' })
      .expect(429);
  });

  it('bloqueia com 429 depois de exceder o limite mais agressivo de /auth/forgot-password (3 por minuto)', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'ninguem@example.com' })
        .expect(200);
    }

    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'ninguem@example.com' })
      .expect(429);
  });

  it('bloqueia com 429 depois de exceder o limite de /auth/reset-password (5 por minuto)', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'qualquer', newPassword: 'qualquer1234' })
        .expect((res) => {
          expect([400, 401]).toContain(res.status);
        });
    }

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: 'qualquer', newPassword: 'qualquer1234' })
      .expect(429);
  });

  it('bloqueia com 429 depois de exceder o limite de /auth/verify (10 por minuto)', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .get('/auth/verify')
        .query({ token: 'token-invalido' })
        .expect(400);
    }

    await request(app.getHttpServer())
      .get('/auth/verify')
      .query({ token: 'token-invalido' })
      .expect(429);
  });

  it('bloqueia com 429 depois de exceder o limite de /auth/refresh (10 por minuto)', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer()).post('/auth/refresh').expect(401);
    }

    await request(app.getHttpServer()).post('/auth/refresh').expect(429);
  });
});
