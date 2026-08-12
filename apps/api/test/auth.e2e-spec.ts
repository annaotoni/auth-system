import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthModule } from '../src/modules/auth/auth.module';
import { MailService } from '../src/modules/mail/mail.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

// PrismaService e MailService são mockados: este e2e cobre a camada HTTP
// (validação, status, formato de resposta), não o banco real. A suíte com
// Postgres real fica pra Fase 7, quando o isolamento do banco de teste for montado.
describe('AuthController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    emailVerificationToken: {
      findUnique: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
    };
    authAuditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let mailService: { sendVerificationEmail: jest.Mock };

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
      authAuditLog: { create: jest.fn() },
      $transaction: jest.fn().mockResolvedValue(undefined),
    };
    mailService = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, PrismaModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(MailService)
      .useValue(mailService)
      .compile();

    app = moduleFixture.createNestApplication();
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
});
