import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { hash } from 'argon2';
import { ARGON2_OPTIONS } from '../../common/constants/argon2-options';
import type { AccessTokenPayload } from '../../common/interfaces/access-token-payload';
import { PrismaService } from '../../prisma/prisma.service';
import { HibpService } from '../hibp/hibp.service';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { MfaService } from './services/mfa.service';
import { TokenBlocklistService } from './services/token-blocklist.service';

// Impede import do otplib (ESM-only) no ambiente CommonJS do Jest.
jest.mock('./services/mfa.service');

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { create: jest.Mock; update: jest.Mock };
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
    passwordResetToken: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
    };
    authAuditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let usersService: {
    findByEmail: jest.Mock;
    findById: jest.Mock;
    findByIdWithMfa: jest.Mock;
  };
  let mailService: {
    sendVerificationEmail: jest.Mock;
    sendPasswordResetEmail: jest.Mock;
  };
  let jwtService: { sign: jest.Mock };
  let hibpService: { isPasswordPwned: jest.Mock };
  let tokenBlocklist: { block: jest.Mock; isBlocked: jest.Mock };
  let mfaServiceMock: {
    generateSetup: jest.Mock;
    verifyToken: jest.Mock;
    issueChallenge: jest.Mock;
    consumeChallenge: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: { create: jest.fn(), update: jest.fn() },
      emailVerificationToken: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
      },
      passwordResetToken: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      authAuditLog: { create: jest.fn() },
      $transaction: jest.fn().mockResolvedValue(undefined),
    };
    usersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      findByIdWithMfa: jest.fn(),
    };
    mailService = {
      sendVerificationEmail: jest.fn(),
      sendPasswordResetEmail: jest.fn(),
    };
    jwtService = { sign: jest.fn().mockReturnValue('signed-access-token') };
    hibpService = { isPasswordPwned: jest.fn().mockResolvedValue(false) };
    tokenBlocklist = {
      block: jest.fn().mockResolvedValue(undefined),
      isBlocked: jest.fn().mockResolvedValue(false),
    };
    mfaServiceMock = {
      generateSetup: jest.fn().mockResolvedValue({
        secret: 'BASE32SECRET',
        otpauthUrl: 'otpauth://totp/...',
        qrCodeDataUrl: 'data:image/png;base64,...',
      }),
      verifyToken: jest.fn().mockResolvedValue(true),
      issueChallenge: jest.fn().mockResolvedValue('challenge-uuid'),
      consumeChallenge: jest.fn().mockResolvedValue('user-1'),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: MailService, useValue: mailService },
        { provide: JwtService, useValue: jwtService },
        { provide: HibpService, useValue: hibpService },
        { provide: TokenBlocklistService, useValue: tokenBlocklist },
        { provide: MfaService, useValue: mfaServiceMock },
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

    it('lança BadRequestException quando a senha apareceu em vazamentos conhecidos (HIBP)', async () => {
      hibpService.isPasswordPwned.mockResolvedValue(true);

      await expect(
        service.register({
          email: 'novo@example.com',
          password: 'senha-vazada',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(usersService.findByEmail).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const password = 'senha-correta-123';
    let passwordHash: string;

    beforeAll(async () => {
      passwordHash = await hash(password, ARGON2_OPTIONS);
    });

    it('retorna access e refresh token e grava LOGIN_SUCCESS quando as credenciais são válidas', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'user-1',
        passwordHash,
        emailVerifiedAt: new Date(),
      });
      prisma.refreshToken.create.mockResolvedValue({ id: 'refresh-1' });

      const result = await service.login(
        { email: 'user@example.com', password },
        '127.0.0.1',
        'jest',
      );

      expect(result.accessToken).toBe('signed-access-token');
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'user-1',
        jti: expect.any(String),
      });
      expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);

      const refreshArgs = prisma.refreshToken.create.mock.calls[0][0];
      expect(refreshArgs.data.userId).toBe('user-1');
      expect(refreshArgs.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(refreshArgs.data.tokenHash).not.toBe(result.refreshToken);

      expect(prisma.authAuditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          eventType: 'LOGIN_SUCCESS',
          ip: '127.0.0.1',
          userAgent: 'jest',
        },
      });
    });

    it('lança UnauthorizedException e grava LOGIN_FAILED quando o usuário não existe', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'ninguem@example.com', password }),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      expect(prisma.authAuditLog.create).toHaveBeenCalledWith({
        data: {
          userId: undefined,
          eventType: 'LOGIN_FAILED',
          ip: undefined,
          userAgent: undefined,
          metadata: {
            email: 'ninguem@example.com',
            reason: 'invalid_credentials',
          },
        },
      });
    });

    it('lança UnauthorizedException e grava LOGIN_FAILED com o userId quando a senha está errada', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'user-1',
        passwordHash,
        emailVerifiedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      });

      await expect(
        service.login({ email: 'user@example.com', password: 'senha-errada' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      expect(prisma.authAuditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          eventType: 'LOGIN_FAILED',
          ip: undefined,
          userAgent: undefined,
          metadata: {
            email: 'user@example.com',
            reason: 'invalid_credentials',
          },
        },
      });
    });

    it('lança UnauthorizedException quando o e-mail nunca foi verificado', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'user-1',
        passwordHash,
        emailVerifiedAt: null,
      });

      await expect(
        service.login({ email: 'user@example.com', password }),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      expect(prisma.authAuditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          eventType: 'LOGIN_FAILED',
          ip: undefined,
          userAgent: undefined,
          metadata: { email: 'user@example.com', reason: 'email_not_verified' },
        },
      });
    });

    describe('lockout progressivo', () => {
      it('incrementa failedLoginCount numa senha errada sem travar antes do threshold', async () => {
        usersService.findByEmail.mockResolvedValue({
          id: 'user-1',
          passwordHash,
          emailVerifiedAt: new Date(),
          failedLoginCount: 2,
          lockedUntil: null,
        });

        await expect(
          service.login({ email: 'user@example.com', password: 'errada' }),
        ).rejects.toThrow(UnauthorizedException);

        expect(prisma.user.update).toHaveBeenCalledWith({
          where: { id: 'user-1' },
          data: { failedLoginCount: 3, lockedUntil: undefined },
        });
      });

      it('trava a conta ao atingir o threshold de falhas', async () => {
        usersService.findByEmail.mockResolvedValue({
          id: 'user-1',
          passwordHash,
          emailVerifiedAt: new Date(),
          failedLoginCount: 4,
          lockedUntil: null,
        });

        await expect(
          service.login({ email: 'user@example.com', password: 'errada' }),
        ).rejects.toThrow(UnauthorizedException);

        const updateArgs = prisma.user.update.mock.calls[0][0];
        expect(updateArgs.data.failedLoginCount).toBe(5);
        expect(updateArgs.data.lockedUntil).toBeInstanceOf(Date);
        expect(updateArgs.data.lockedUntil.getTime()).toBeGreaterThan(
          Date.now(),
        );
      });

      it('rejeita com mensagem genérica quando a conta está travada, mesmo com a senha correta, sem incrementar o contador de novo', async () => {
        usersService.findByEmail.mockResolvedValue({
          id: 'user-1',
          passwordHash,
          emailVerifiedAt: new Date(),
          failedLoginCount: 5,
          lockedUntil: new Date(Date.now() + 60_000),
        });

        await expect(
          service.login({ email: 'user@example.com', password }),
        ).rejects.toThrow(UnauthorizedException);

        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(prisma.authAuditLog.create).toHaveBeenCalledWith({
          data: {
            userId: 'user-1',
            eventType: 'LOGIN_FAILED',
            ip: undefined,
            userAgent: undefined,
            metadata: { email: 'user@example.com', reason: 'account_locked' },
          },
        });
      });

      it('reseta failedLoginCount e lockedUntil quando o login é bem-sucedido', async () => {
        usersService.findByEmail.mockResolvedValue({
          id: 'user-1',
          passwordHash,
          emailVerifiedAt: new Date(),
          failedLoginCount: 3,
          lockedUntil: null,
        });
        prisma.refreshToken.create.mockResolvedValue({ id: 'refresh-1' });

        await service.login({ email: 'user@example.com', password });

        expect(prisma.user.update).toHaveBeenCalledWith({
          where: { id: 'user-1' },
          data: { failedLoginCount: 0, lockedUntil: null },
        });
      });
    });
  });

  describe('refresh', () => {
    it('rotaciona: cria novo token na mesma family e revoga o atual apontando pro novo', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'old-token-id',
        userId: 'user-1',
        familyId: 'family-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await service.refresh(
        'raw-old-token',
        '127.0.0.1',
        'jest',
      );

      expect(result.accessToken).toBe('signed-access-token');
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'user-1',
        jti: expect.any(String),
      });
      expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(result.refreshToken).not.toBe('raw-old-token');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      const createArgs = prisma.refreshToken.create.mock.calls[0][0];
      expect(createArgs.data.userId).toBe('user-1');
      expect(createArgs.data.familyId).toBe('family-1');
      expect(createArgs.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);

      const updateArgs = prisma.refreshToken.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: 'old-token-id' });
      expect(updateArgs.data.revokedAt).toBeInstanceOf(Date);
      expect(updateArgs.data.replacedBy).toBe(createArgs.data.id);
    });

    it('lança UnauthorizedException quando o token não existe', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh('token-inexistente')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lança UnauthorizedException quando o token expirou (mas não estava revogado)', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'old-token-id',
        userId: 'user-1',
        familyId: 'family-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1_000),
      });

      await expect(service.refresh('token-expirado')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('detecta reuso: token revogado reapresentado revoga a family inteira e grava TOKEN_REUSE_DETECTED', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'old-token-id',
        userId: 'user-1',
        familyId: 'family-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(
        service.refresh('token-ja-usado', '127.0.0.1', 'jest'),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'family-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.authAuditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          eventType: 'TOKEN_REUSE_DETECTED',
          ip: '127.0.0.1',
          userAgent: 'jest',
          metadata: { familyId: 'family-1' },
        },
      });
    });
  });

  describe('logout', () => {
    const fakePayload: AccessTokenPayload = {
      sub: 'user-1',
      jti: 'jti-test',
      iat: 0,
      exp: Math.floor(Date.now() / 1000) + 900,
    };

    it('revoga o token e grava LOGOUT quando o token existe e não estava revogado', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        revokedAt: null,
      });

      await service.logout('raw-token', fakePayload, '127.0.0.1', 'jest');

      expect(tokenBlocklist.block).toHaveBeenCalledWith(
        'jti-test',
        fakePayload.exp,
      );
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'token-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.authAuditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          eventType: 'LOGOUT',
          ip: '127.0.0.1',
          userAgent: 'jest',
        },
      });
    });

    it('não faz nada quando o token não existe', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(
        service.logout('inexistente', fakePayload),
      ).resolves.toBeUndefined();
      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
      expect(prisma.authAuditLog.create).not.toHaveBeenCalled();
    });

    it('não faz nada quando o token já estava revogado', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        revokedAt: new Date(),
      });

      await expect(
        service.logout('ja-revogado', fakePayload),
      ).resolves.toBeUndefined();
      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('cria o token de reset e envia o e-mail quando o usuário existe', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
      });

      await service.forgotPassword('user@example.com');

      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
      const createArgs = prisma.passwordResetToken.create.mock.calls[0][0];
      expect(createArgs.data.userId).toBe('user-1');
      expect(createArgs.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);

      expect(mailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'user@example.com',
        expect.any(String),
      );
    });

    it('não faz nada quando o usuário não existe', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.forgotPassword('ninguem@example.com'),
      ).resolves.toBeUndefined();

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('redefine a senha, marca o token como usado e revoga todos os refresh tokens', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'reset-token-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      await service.resetPassword(
        'raw-reset-token',
        'nova-senha-1234',
        '127.0.0.1',
        'jest',
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: 'reset-token-1' },
        data: { usedAt: expect.any(Date) },
      });

      const userUpdateArgs = prisma.user.update.mock.calls[0][0];
      expect(userUpdateArgs.where).toEqual({ id: 'user-1' });
      expect(userUpdateArgs.data.passwordHash).not.toBe('nova-senha-1234');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });

      expect(prisma.authAuditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          eventType: 'PASSWORD_RESET',
          ip: '127.0.0.1',
          userAgent: 'jest',
        },
      });
    });

    it('lança BadRequestException quando o token não existe', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword('invalido', 'nova-senha-1234'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lança BadRequestException quando o token já foi usado', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'reset-token-1',
        userId: 'user-1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(
        service.resetPassword('usado', 'nova-senha-1234'),
      ).rejects.toThrow(BadRequestException);
    });

    it('lança BadRequestException quando o token expirou', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'reset-token-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1_000),
      });

      await expect(
        service.resetPassword('expirado', 'nova-senha-1234'),
      ).rejects.toThrow(BadRequestException);
    });

    it('lança BadRequestException quando a nova senha apareceu em vazamentos conhecidos (HIBP)', async () => {
      hibpService.isPasswordPwned.mockResolvedValue(true);

      await expect(
        service.resetPassword('token-valido', 'senha-vazada'),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.passwordResetToken.findUnique).not.toHaveBeenCalled();
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

  describe('resendVerification', () => {
    it('emite um novo token e reenvia o e-mail quando a conta existe e não foi verificada', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        emailVerifiedAt: null,
      });

      await service.resendVerification('user@example.com');

      expect(prisma.emailVerificationToken.create).toHaveBeenCalledTimes(1);
      const createArgs = prisma.emailVerificationToken.create.mock.calls[0][0];
      expect(createArgs.data.userId).toBe('user-1');
      expect(createArgs.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);

      expect(mailService.sendVerificationEmail).toHaveBeenCalledWith(
        'user@example.com',
        expect.any(String),
      );
    });

    it('não faz nada quando o usuário não existe', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.resendVerification('ninguem@example.com'),
      ).resolves.toBeUndefined();

      expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
      expect(mailService.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('não faz nada quando o e-mail já foi verificado', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        emailVerifiedAt: new Date(),
      });

      await expect(
        service.resendVerification('user@example.com'),
      ).resolves.toBeUndefined();

      expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
      expect(mailService.sendVerificationEmail).not.toHaveBeenCalled();
    });
  });

  describe('setupMfa', () => {
    it('armazena o segredo provisório e retorna qrCodeDataUrl e secret', async () => {
      usersService.findById.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        mfaEnabled: false,
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.setupMfa('user-1');

      expect(result.qrCodeDataUrl).toBeTruthy();
      expect(result.secret).toBeTruthy();
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { mfaSecret: result.secret },
      });
    });

    it('lança BadRequestException quando MFA já está ativado', async () => {
      usersService.findById.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        mfaEnabled: true,
      });

      await expect(service.setupMfa('user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('enableMfa', () => {
    it('ativa MFA e grava MFA_ENABLED quando o OTP é válido', async () => {
      usersService.findByIdWithMfa.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        mfaEnabled: false,
        mfaSecret: 'BASE32SECRET',
      });

      await service.enableMfa('user-1', '123456');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { mfaEnabled: true },
      });
      expect(prisma.authAuditLog.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', eventType: 'MFA_ENABLED' },
      });
    });

    it('lança UnauthorizedException quando o OTP é inválido', async () => {
      usersService.findByIdWithMfa.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        mfaEnabled: false,
        mfaSecret: 'BASE32SECRET',
      });
      mfaServiceMock.verifyToken.mockResolvedValueOnce(false);

      await expect(service.enableMfa('user-1', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('disableMfa', () => {
    it('desativa MFA e grava MFA_DISABLED quando o OTP é válido', async () => {
      usersService.findByIdWithMfa.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        mfaEnabled: true,
        mfaSecret: 'BASE32SECRET',
      });

      await service.disableMfa('user-1', '123456');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { mfaEnabled: false, mfaSecret: null },
      });
      expect(prisma.authAuditLog.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', eventType: 'MFA_DISABLED' },
      });
    });

    it('lança BadRequestException quando MFA não está ativado', async () => {
      usersService.findByIdWithMfa.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        mfaEnabled: false,
        mfaSecret: null,
      });

      await expect(service.disableMfa('user-1', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('login com MFA habilitado', () => {
    const password = 'senha-correta-123';
    let passwordHash: string;

    beforeAll(async () => {
      passwordHash = await hash(password, ARGON2_OPTIONS);
    });

    it('retorna mfaRequired:true e challengeId quando o usuário tem MFA ativo', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'user-mfa',
        passwordHash,
        emailVerifiedAt: new Date(),
        mfaEnabled: true,
        failedLoginCount: 0,
        lockedUntil: null,
      });

      const result = await service.login(
        { email: 'user@example.com', password },
        '127.0.0.1',
        'jest',
      );

      expect(result.mfaRequired).toBe(true);
      expect(result.challengeId).toBeTruthy();
      expect(result.accessToken).toBeNull();
      expect(result.refreshToken).toBeNull();
    });
  });

  describe('completeMfaLogin', () => {
    it('retorna tokens e grava MFA_CHALLENGE_PASSED quando challenge e OTP são válidos', async () => {
      usersService.findByIdWithMfa.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        mfaEnabled: true,
        mfaSecret: 'BASE32SECRET',
      });
      prisma.refreshToken.create.mockResolvedValue({ id: 'refresh-1' });

      const result = await service.completeMfaLogin(
        'valid-challenge-id',
        '123456',
        '127.0.0.1',
        'jest',
      );

      expect(result.accessToken).toBe('signed-access-token');
      expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(prisma.authAuditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          eventType: 'MFA_CHALLENGE_PASSED',
          ip: '127.0.0.1',
          userAgent: 'jest',
        },
      });
    });

    it('lança UnauthorizedException quando o challenge é inválido ou expirado', async () => {
      mfaServiceMock.consumeChallenge.mockResolvedValueOnce(null);

      await expect(
        service.completeMfaLogin('challenge-invalido', '123456'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('grava MFA_CHALLENGE_FAILED e lança UnauthorizedException quando OTP está errado', async () => {
      usersService.findByIdWithMfa.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        mfaEnabled: true,
        mfaSecret: 'BASE32SECRET',
      });
      mfaServiceMock.consumeChallenge.mockResolvedValueOnce('user-1');
      mfaServiceMock.verifyToken.mockResolvedValueOnce(false);

      await expect(
        service.completeMfaLogin(
          'valid-challenge',
          'wrong-otp',
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.authAuditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          eventType: 'MFA_CHALLENGE_FAILED',
          ip: '127.0.0.1',
          userAgent: 'jest',
        },
      });
    });
  });
});
