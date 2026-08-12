import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { create: jest.Mock; update: jest.Mock };
    emailVerificationToken: {
      findUnique: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
    };
    authAuditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let usersService: { findByEmail: jest.Mock };
  let mailService: { sendVerificationEmail: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { create: jest.fn(), update: jest.fn() },
      emailVerificationToken: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      authAuditLog: { create: jest.fn() },
      $transaction: jest.fn().mockResolvedValue(undefined),
    };
    usersService = { findByEmail: jest.fn() };
    mailService = { sendVerificationEmail: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('register', () => {
    it('cria usuário, gera token hasheado e envia e-mail quando o e-mail é novo', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'user-1' });

      await service.register({
        email: 'nova@example.com',
        password: 'senha1234',
      });

      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs.data.email).toBe('nova@example.com');
      expect(createArgs.data.passwordHash).not.toBe('senha1234');
      expect(createArgs.data.emailVerifications.create.tokenHash).toMatch(
        /^[0-9a-f]{64}$/,
      );

      expect(mailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
      const [emailArg, rawTokenArg] =
        mailService.sendVerificationEmail.mock.calls[0];
      expect(emailArg).toBe('nova@example.com');
      expect(rawTokenArg).not.toBe(
        createArgs.data.emailVerifications.create.tokenHash,
      );
    });

    it('não faz nada quando o e-mail já existe e já foi verificado', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'existing',
        emailVerifiedAt: new Date(),
      });

      await expect(
        service.register({ email: 'ja@example.com', password: 'senha1234' }),
      ).resolves.toBeUndefined();

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
      expect(mailService.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('emite um novo token e reenvia o e-mail quando a conta existe mas nunca foi verificada', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'existing-unverified',
        emailVerifiedAt: null,
      });

      await service.register({
        email: 'nunca-verificou@example.com',
        password: 'senha1234',
      });

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.emailVerificationToken.create).toHaveBeenCalledTimes(1);
      const createArgs = prisma.emailVerificationToken.create.mock.calls[0][0];
      expect(createArgs.data.userId).toBe('existing-unverified');
      expect(createArgs.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);

      expect(mailService.sendVerificationEmail).toHaveBeenCalledWith(
        'nunca-verificou@example.com',
        expect.any(String),
      );
    });

    it('resolve normalmente quando duas requisições colidem no mesmo e-mail (unique constraint)', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.2.1',
        }),
      );

      await expect(
        service.register({
          email: 'corrida@example.com',
          password: 'senha1234',
        }),
      ).resolves.toBeUndefined();

      expect(mailService.sendVerificationEmail).not.toHaveBeenCalled();
    });
  });

  describe('verifyEmail', () => {
    it('marca o e-mail como verificado e grava audit log quando o token é válido', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      await service.verifyEmail('token-cru', '127.0.0.1', 'jest');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.emailVerificationToken.update).toHaveBeenCalledWith({
        where: { id: 'token-1' },
        data: { usedAt: expect.any(Date) },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { emailVerifiedAt: expect.any(Date) },
      });
      expect(prisma.authAuditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          eventType: 'EMAIL_VERIFIED',
          ip: '127.0.0.1',
          userAgent: 'jest',
        },
      });
    });

    it('lança BadRequestException quando o token não existe', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(null);

      await expect(service.verifyEmail('invalido')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lança BadRequestException quando o token já foi usado', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(service.verifyEmail('usado')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lança BadRequestException quando o token expirou', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1_000),
      });

      await expect(service.verifyEmail('expirado')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
