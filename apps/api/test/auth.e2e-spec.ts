import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { hash } from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { ARGON2_OPTIONS } from '../src/common/constants/argon2-options';
import { AuthModule } from '../src/modules/auth/auth.module';
import { MailService } from '../src/modules/mail/mail.service';
import { UsersModule } from '../src/modules/users/users.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

const TEST_ENV = {
  JWT_ACCESS_SECRET: 'e2e-test-secret-com-pelo-menos-32-caracteres',
  NODE_ENV: 'test',
};

// PrismaService e MailService são mockados: este e2e cobre a camada HTTP
// (validação, status, formato de resposta, guards), não o banco real. A
// suíte com Postgres real fica pra Fase 7, quando o isolamento do banco de
// teste for montado. ConfigModule usa `load` (não o .env real) pra ficar
// hermético e funcionar igual em CI.
describe('Auth + Users (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    emailVerificationToken: {
      findUnique: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
    };
    refreshToken: {
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findUnique: jest.Mock;
    };
    authAuditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let mailService: { sendVerificationEmail: jest.Mock };
  let validPasswordHash: string;

  beforeAll(async () => {
    validPasswordHash = await hash('senha-correta-123', ARGON2_OPTIONS);
  });

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'user-1' }),
        update: jest.fn(),
      },
      emailVerificationToken: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        create: jest.fn(),
      },
      refreshToken: {
        create: jest.fn().mockResolvedValue({ id: 'refresh-1' }),
        update: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      authAuditLog: { create: jest.fn() },
      $transaction: jest.fn().mockResolvedValue(undefined),
    };
    mailService = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
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
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(MailService)
      .useValue(mailService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('/auth/register (POST)', () => {
    it('retorna 201 com resposta genérica quando o e-mail é novo', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'nova@example.com', password: 'senha1234' })
        .expect(201);

      expect(response.body).toEqual({ message: expect.any(String) });
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      expect(mailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
    });

    it('retorna a mesma resposta genérica quando o e-mail já existe e já foi verificado, sem criar nem enviar e-mail', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'existing',
        emailVerifiedAt: new Date(),
      });

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'ja@example.com', password: 'senha1234' })
        .expect(201);

      expect(response.body).toEqual({ message: expect.any(String) });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(mailService.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('reenvia um novo token quando o e-mail existe mas nunca foi verificado', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'existing-unverified',
        emailVerifiedAt: null,
      });

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'nunca-verificou@example.com', password: 'senha1234' })
        .expect(201);

      expect(response.body).toEqual({ message: expect.any(String) });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.emailVerificationToken.create).toHaveBeenCalledTimes(1);
      expect(mailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
    });

    it('retorna 400 quando o e-mail é inválido', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'nao-e-email', password: 'senha1234' })
        .expect(400);

      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('retorna 400 quando a senha tem menos de 8 caracteres', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'valido@example.com', password: 'curta' })
        .expect(400);

      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('/auth/verify (GET)', () => {
    it('retorna 400 quando o token não existe', async () => {
      await request(app.getHttpServer())
        .get('/auth/verify')
        .query({ token: 'inexistente' })
        .expect(400);
    });

    it('retorna 400 quando o parâmetro token está ausente', async () => {
      await request(app.getHttpServer()).get('/auth/verify').expect(400);
    });

    it('retorna 200 e verifica o e-mail quando o token é válido', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const response = await request(app.getHttpServer())
        .get('/auth/verify')
        .query({ token: 'valido' })
        .expect(200);

      expect(response.body).toEqual({ message: expect.any(String) });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('/auth/login (POST)', () => {
    it('retorna 200, accessToken no corpo e cookie httpOnly de refresh quando as credenciais são válidas', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        passwordHash: validPasswordHash,
        emailVerifiedAt: new Date(),
      });

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'user@example.com', password: 'senha-correta-123' })
        .expect(200);

      expect(response.body).toEqual({ accessToken: expect.any(String) });
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);

      const cookies = response.headers['set-cookie'];
      expect(cookies?.[0]).toMatch(/^refreshToken=/);
      expect(cookies?.[0]).toMatch(/HttpOnly/i);
      expect(cookies?.[0]).toMatch(/SameSite=Strict/i);
    });

    it('retorna 401 quando o usuário não existe', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'ninguem@example.com', password: 'qualquer-coisa' })
        .expect(401);

      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('retorna 401 quando a senha está errada', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        passwordHash: validPasswordHash,
        emailVerifiedAt: new Date(),
      });

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'user@example.com', password: 'senha-errada' })
        .expect(401);

      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('retorna 401 quando o e-mail nunca foi verificado', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        passwordHash: validPasswordHash,
        emailVerifiedAt: null,
      });

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'user@example.com', password: 'senha-correta-123' })
        .expect(401);

      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe('/auth/refresh (POST)', () => {
    it('retorna 200, novo accessToken e novo cookie de refresh quando o token é válido', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'old-token-id',
        userId: 'user-1',
        familyId: 'family-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', 'refreshToken=raw-old-token')
        .expect(200);

      expect(response.body).toEqual({ accessToken: expect.any(String) });
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
      expect(prisma.refreshToken.update).toHaveBeenCalledTimes(1);

      const cookies = response.headers['set-cookie'];
      expect(cookies?.[0]).toMatch(/^refreshToken=/);
      expect(cookies?.[0]).not.toMatch(/refreshToken=raw-old-token/);
    });

    it('retorna 401 quando não há cookie de refresh', async () => {
      await request(app.getHttpServer()).post('/auth/refresh').expect(401);

      expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled();
    });

    it('retorna 401 quando o token não existe', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', 'refreshToken=inexistente')
        .expect(401);
    });

    it('retorna 401 e revoga a family inteira quando um token já revogado é reapresentado (reuse detection)', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'old-token-id',
        userId: 'user-1',
        familyId: 'family-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', 'refreshToken=token-ja-usado')
        .expect(401);

      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'family-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.authAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ eventType: 'TOKEN_REUSE_DETECTED' }),
      });
    });
  });

  describe('/auth/logout (POST)', () => {
    it('revoga o token, limpa o cookie e retorna 200 quando havia uma sessão', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        revokedAt: null,
      });

      const response = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', 'refreshToken=raw-token')
        .expect(200);

      expect(response.body).toEqual({ message: expect.any(String) });
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'token-1' },
        data: { revokedAt: expect.any(Date) },
      });

      const cookies = response.headers['set-cookie'];
      expect(cookies?.[0]).toMatch(/^refreshToken=;/);
    });

    it('retorna 200 mesmo sem cookie de refresh (idempotente)', async () => {
      await request(app.getHttpServer()).post('/auth/logout').expect(200);

      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    });
  });

  describe('/users/me (GET)', () => {
    async function login(): Promise<string> {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        passwordHash: validPasswordHash,
        emailVerifiedAt: new Date(),
      });

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'user@example.com', password: 'senha-correta-123' })
        .expect(200);

      return (response.body as { accessToken: string }).accessToken;
    }

    it('retorna 401 sem token', async () => {
      await request(app.getHttpServer()).get('/users/me').expect(401);
    });

    it('retorna 401 com um token inválido', async () => {
      await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', 'Bearer token-invalido')
        .expect(401);
    });

    it('retorna o perfil do usuário autenticado quando o token é válido', async () => {
      const accessToken = await login();

      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        passwordHash: validPasswordHash,
        emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      const response = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: 'user-1',
        email: 'user@example.com',
      });
      expect(response.body).not.toHaveProperty('passwordHash');
    });
  });
});
