process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://auth:auth@localhost:5432/auth_system_test?schema=public';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthModule } from '../src/modules/auth/auth.module';
import { HibpService } from '../src/modules/hibp/hibp.service';
import { MailService } from '../src/modules/mail/mail.service';
import { UsersModule } from '../src/modules/users/users.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

const TEST_ENV = {
  JWT_ACCESS_SECRET: 'e2e-real-test-secret-com-pelo-menos-32-caracteres',
  NODE_ENV: 'test',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
};

const TEST_EMAIL = 'fluxo-critico.e2e@auth-system.local';
const PASSWORD = 'senhaOriginal123';
const NEW_PASSWORD = 'senhaNovaTrocada456';

function refreshCookieFrom(response: request.Response): string {
  const cookies = response.headers['set-cookie'] as unknown as
    string[] | undefined;
  const raw = cookies?.find((cookie) => cookie.startsWith('refreshToken='));
  if (!raw) {
    throw new Error('Resposta não trouxe cookie refreshToken.');
  }
  return raw.split(';')[0];
}

// Ponta a ponta contra Postgres real (banco isolado auth_system_test — nunca
// o de dev). Só e-mail e HIBP são mockados; Prisma, hashing, JWT e cookies
// são o código de produção de fato. Os testes rodam em sequência e dependem
// uns dos outros (mesma conta atravessa o fluxo inteiro).
describe('Fluxo crítico de autenticação (e2e real)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailService: {
    sendVerificationEmail: jest.Mock;
    sendPasswordResetEmail: jest.Mock;
  };

  let verificationToken: string;
  let firstRefreshCookie: string;
  let secondRefreshCookie: string;
  let thirdRefreshCookie: string;
  let resetToken: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL.includes('_test')) {
      throw new Error(
        `Recusando rodar e2e real: DATABASE_URL não aponta pra um banco de teste (${process.env.DATABASE_URL}).`,
      );
    }

    mailService = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => TEST_ENV],
        }),
        AuthModule,
        UsersModule,
        PrismaModule,
      ],
    })
      .overrideProvider(MailService)
      .useValue(mailService)
      .overrideProvider(HibpService)
      .useValue({ isPasswordPwned: jest.fn().mockResolvedValue(false) })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
    await app.close();
  });

  it('registra a conta e envia o token de verificação', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: TEST_EMAIL, password: PASSWORD })
      .expect(201);

    expect(mailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
    verificationToken = mailService.sendVerificationEmail.mock.calls[0][1];
  });

  it('bloqueia login antes da verificação de e-mail', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: PASSWORD })
      .expect(401);
  });

  it('verifica o e-mail com o token recebido', async () => {
    await request(app.getHttpServer())
      .get('/auth/verify')
      .query({ token: verificationToken })
      .expect(200);
  });

  it('faz login após a verificação e recebe access token + cookie de refresh', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: PASSWORD })
      .expect(200);

    expect(response.body).toEqual({ accessToken: expect.any(String) });
    firstRefreshCookie = refreshCookieFrom(response);
  });

  it('gira o refresh token a cada uso', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', firstRefreshCookie)
      .expect(200);

    expect(response.body).toEqual({ accessToken: expect.any(String) });
    secondRefreshCookie = refreshCookieFrom(response);
    expect(secondRefreshCookie).not.toEqual(firstRefreshCookie);

    const response2 = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', secondRefreshCookie)
      .expect(200);

    thirdRefreshCookie = refreshCookieFrom(response2);
    expect(thirdRefreshCookie).not.toEqual(secondRefreshCookie);
  });

  it('detecta reuso do refresh token e revoga a family inteira', async () => {
    // firstRefreshCookie já foi rotacionado (revogado) no passo anterior —
    // reapresentá-lo é justamente o sinal de roubo que a rotação existe pra pegar.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', firstRefreshCookie)
      .expect(401);

    // a family inteira cai junto, inclusive o token mais recente e ainda válido
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', thirdRefreshCookie)
      .expect(401);
  });

  it('solicita redefinição de senha e recebe o token por e-mail', async () => {
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: TEST_EMAIL })
      .expect(200);

    expect(mailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    resetToken = mailService.sendPasswordResetEmail.mock.calls[0][1];
  });

  it('redefine a senha com o token e invalida a senha antiga', async () => {
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: resetToken, newPassword: NEW_PASSWORD })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: PASSWORD })
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: NEW_PASSWORD })
      .expect(200);
  });
});
