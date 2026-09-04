import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import { hash, verify } from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  ARGON2_OPTIONS,
  getDummyHash,
} from '../../common/constants/argon2-options';
import { hashToken } from '../../common/crypto/hash-token';
import type { AccessTokenPayload } from '../../common/interfaces/access-token-payload';
import { PrismaService } from '../../prisma/prisma.service';
import { HibpService } from '../hibp/hibp.service';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import {
  LOCKOUT_THRESHOLD,
  LOCKOUT_TIERS_MS,
  REFRESH_TOKEN_TTL_MS,
} from './auth.constants';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { MfaService } from './services/mfa.service';
import { TokenBlocklistService } from './services/token-blocklist.service';

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const PWNED_PASSWORD_MESSAGE =
  'Esta senha apareceu em vazamentos de dados conhecidos. Escolha outra.';

export interface LoginResult {
  accessToken: string | null;
  refreshToken: string | null;
  mfaRequired?: boolean;
  challengeId?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly jwtService: JwtService,
    private readonly hibpService: HibpService,
    private readonly tokenBlocklist: TokenBlocklistService,
    private readonly mfaService: MfaService,
  ) {}

  async register(dto: RegisterDto): Promise<void> {
    if (await this.hibpService.isPasswordPwned(dto.password)) {
      throw new BadRequestException(PWNED_PASSWORD_MESSAGE);
    }

    const existing = await this.usersService.findByEmail(dto.email);

    // Hash sempre computado, exista ou não a conta: sem esse custo simétrico,
    // o tempo de resposta denunciaria se o e-mail já está cadastrado.
    const passwordHash = await hash(dto.password, ARGON2_OPTIONS);

    // Conta já ativa: nada a fazer. Já existente mas nunca verificada: emite
    // um novo token — senão a conta fica presa (sem novo link possível) se o
    // primeiro e-mail de verificação nunca chegou.
    if (existing?.emailVerifiedAt) {
      return;
    }

    const rawToken = randomBytes(32).toString('hex');
    const verificationToken = {
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
    };

    try {
      if (existing) {
        await this.prisma.emailVerificationToken.create({
          data: { ...verificationToken, userId: existing.id },
        });
      } else {
        await this.prisma.user.create({
          data: {
            email: dto.email,
            passwordHash,
            emailVerifications: { create: verificationToken },
          },
        });
      }
    } catch (error) {
      // Corrida entre o findByEmail e o create: outro registro venceu.
      // Resposta permanece genérica, sem 500 e sem revelar a duplicidade.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return;
      }
      throw error;
    }

    await this.mailService.sendVerificationEmail(dto.email, rawToken);
  }

  async verifyEmail(
    rawToken: string,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    const tokenRecord = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });

    if (
      !tokenRecord ||
      tokenRecord.usedAt ||
      tokenRecord.expiresAt < new Date()
    ) {
      throw new BadRequestException('Token inválido ou expirado');
    }

    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: tokenRecord.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: tokenRecord.userId },
        data: { emailVerifiedAt: new Date() },
      }),
      this.prisma.authAuditLog.create({
        data: {
          userId: tokenRecord.userId,
          eventType: 'EMAIL_VERIFIED',
          ip,
          userAgent,
        },
      }),
    ]);
  }

  async resendVerification(email: string): Promise<void> {
    const existing = await this.usersService.findByEmail(email);

    // Resposta idêntica em qualquer caso (inexistente, já verificado ou
    // reenvio de fato): nenhuma ramificação pode ser observada de fora.
    if (!existing || existing.emailVerifiedAt) {
      return;
    }

    const rawToken = randomBytes(32).toString('hex');

    await this.prisma.emailVerificationToken.create({
      data: {
        userId: existing.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
      },
    });

    await this.mailService.sendVerificationEmail(existing.email, rawToken);
  }

  async login(
    dto: LoginDto,
    ip?: string,
    userAgent?: string,
  ): Promise<LoginResult> {
    const user = await this.usersService.findByEmail(dto.email);

    // Sempre roda argon2.verify, mesmo sem usuário (contra um hash dummy):
    // sem esse custo simétrico, o tempo de resposta denunciaria se o
    // e-mail está cadastrado. Precisa rodar ANTES de checar lockedUntil,
    // senão uma conta travada responderia mais rápido — outro vazamento
    // por timing, agora revelando o estado de bloqueio.
    const passwordValid = await verify(
      user?.passwordHash ?? (await getDummyHash()),
      dto.password,
    );

    const isLocked = Boolean(
      user?.lockedUntil && user.lockedUntil > new Date(),
    );

    if (!user || !passwordValid || isLocked) {
      if (user && !isLocked) {
        await this.recordFailedAttempt(user);
      }
      // Mensagem genérica mesmo quando travada: não revelar o estado de
      // lockout evita dar feedback de progresso a quem está forçando a conta.
      await this.logFailedLogin(
        dto.email,
        isLocked ? 'account_locked' : 'invalid_credentials',
        ip,
        userAgent,
        user?.id,
      );
      throw new UnauthorizedException('Credenciais inválidas');
    }

    if (!user.emailVerifiedAt) {
      await this.logFailedLogin(
        dto.email,
        'email_not_verified',
        ip,
        userAgent,
        user.id,
      );
      throw new UnauthorizedException('E-mail não verificado');
    }

    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }

    if (user.mfaEnabled) {
      await this.prisma.authAuditLog.create({
        data: {
          userId: user.id,
          eventType: 'LOGIN_FAILED',
          ip,
          userAgent,
          metadata: { email: dto.email, reason: 'mfa_challenge_issued' },
        },
      });
      const challengeId = await this.mfaService.issueChallenge(user.id);
      return {
        accessToken: null,
        refreshToken: null,
        mfaRequired: true,
        challengeId,
      };
    }

    const jti = randomUUID();
    const accessToken = this.jwtService.sign({ sub: user.id, jti });
    const rawRefreshToken = randomBytes(32).toString('hex');

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawRefreshToken),
        familyId: randomUUID(),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        ip,
        userAgent,
      },
    });

    await this.prisma.authAuditLog.create({
      data: { userId: user.id, eventType: 'LOGIN_SUCCESS', ip, userAgent },
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }

  private async recordFailedAttempt(user: User): Promise<void> {
    const failedLoginCount = user.failedLoginCount + 1;
    const lockoutDurationMs = this.computeLockoutDuration(failedLoginCount);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount,
        lockedUntil: lockoutDurationMs
          ? new Date(Date.now() + lockoutDurationMs)
          : undefined,
      },
    });
  }

  private computeLockoutDuration(failedLoginCount: number): number | null {
    if (failedLoginCount < LOCKOUT_THRESHOLD) {
      return null;
    }
    const tier = Math.min(
      Math.floor((failedLoginCount - LOCKOUT_THRESHOLD) / 5),
      LOCKOUT_TIERS_MS.length - 1,
    );
    return LOCKOUT_TIERS_MS[tier];
  }

  private async logFailedLogin(
    email: string,
    reason: string,
    ip?: string,
    userAgent?: string,
    userId?: string,
  ): Promise<void> {
    await this.prisma.authAuditLog.create({
      data: {
        userId,
        eventType: 'LOGIN_FAILED',
        ip,
        userAgent,
        metadata: { email, reason },
      },
    });
  }

  async refresh(
    rawToken: string,
    ip?: string,
    userAgent?: string,
  ): Promise<LoginResult> {
    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException('Sessão inválida, faça login novamente');
    }

    // Token já revogado sendo reapresentado: outro refresh já rotacionou essa
    // family depois dele — só acontece se alguém mais tiver esse valor
    // (roubo). Revoga a family inteira, punindo atacante e vítima igualmente.
    if (tokenRecord.revokedAt) {
      await this.revokeFamily(
        tokenRecord.familyId,
        tokenRecord.userId,
        ip,
        userAgent,
      );
      throw new UnauthorizedException('Sessão inválida, faça login novamente');
    }

    if (tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('Sessão expirada, faça login novamente');
    }

    const newTokenId = randomUUID();
    const rawRefreshToken = randomBytes(32).toString('hex');

    await this.prisma.$transaction([
      this.prisma.refreshToken.create({
        data: {
          id: newTokenId,
          userId: tokenRecord.userId,
          tokenHash: hashToken(rawRefreshToken),
          familyId: tokenRecord.familyId,
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
          ip,
          userAgent,
        },
      }),
      this.prisma.refreshToken.update({
        where: { id: tokenRecord.id },
        data: { revokedAt: new Date(), replacedBy: newTokenId },
      }),
    ]);

    const jti = randomUUID();
    const accessToken = this.jwtService.sign({ sub: tokenRecord.userId, jti });

    return { accessToken, refreshToken: rawRefreshToken };
  }

  async logout(
    rawToken: string,
    currentUser: AccessTokenPayload,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    // Bloqueia o access token imediatamente — sem esperar expirar naturalmente.
    await this.tokenBlocklist.block(currentUser.jti, currentUser.exp);

    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });

    // Idempotente: token inexistente ou já revogado não é erro.
    if (!tokenRecord || tokenRecord.revokedAt) {
      return;
    }

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: tokenRecord.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.authAuditLog.create({
        data: {
          userId: tokenRecord.userId,
          eventType: 'LOGOUT',
          ip,
          userAgent,
        },
      }),
    ]);
  }

  private async revokeFamily(
    familyId: string,
    userId: string,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.authAuditLog.create({
        data: {
          userId,
          eventType: 'TOKEN_REUSE_DETECTED',
          ip,
          userAgent,
          metadata: { familyId },
        },
      }),
    ]);
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);

    // Resposta idêntica exista ou não a conta: nenhuma ramificação aqui pode
    // ser observada de fora.
    if (!user) {
      return;
    }

    const rawToken = randomBytes(32).toString('hex');

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      },
    });

    await this.mailService.sendPasswordResetEmail(user.email, rawToken);
  }

  async resetPassword(
    rawToken: string,
    newPassword: string,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    if (await this.hibpService.isPasswordPwned(newPassword)) {
      throw new BadRequestException(PWNED_PASSWORD_MESSAGE);
    }

    const tokenRecord = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });

    if (
      !tokenRecord ||
      tokenRecord.usedAt ||
      tokenRecord.expiresAt < new Date()
    ) {
      throw new BadRequestException('Token inválido ou expirado');
    }

    const passwordHash = await hash(newPassword, ARGON2_OPTIONS);

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: tokenRecord.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: tokenRecord.userId },
        data: { passwordHash },
      }),
      // Redefinir a senha encerra todas as sessões: se o roubo original foi
      // da senha, refresh tokens antigos não podem sobreviver à troca.
      this.prisma.refreshToken.updateMany({
        where: { userId: tokenRecord.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.authAuditLog.create({
        data: {
          userId: tokenRecord.userId,
          eventType: 'PASSWORD_RESET',
          ip,
          userAgent,
        },
      }),
    ]);
  }

  async setupMfa(
    userId: string,
  ): Promise<{ qrCodeDataUrl: string; secret: string }> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('Usuário não encontrado');
    if (user.mfaEnabled) throw new BadRequestException('MFA já está ativado');

    const setup = await this.mfaService.generateSetup(user.email);

    // Armazena o segredo provisório até a confirmação — se o usuário não confirmar,
    // o segredo não é ativado no banco.
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: setup.secret },
    });

    return { qrCodeDataUrl: setup.qrCodeDataUrl, secret: setup.secret };
  }

  async enableMfa(userId: string, otp: string): Promise<void> {
    const user = await this.usersService.findByIdWithMfa(userId);
    if (!user?.mfaSecret)
      throw new BadRequestException('Execute /mfa/setup primeiro');
    if (user.mfaEnabled) throw new BadRequestException('MFA já está ativado');

    if (!(await this.mfaService.verifyToken(otp, user.mfaSecret))) {
      throw new UnauthorizedException('OTP inválido');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { mfaEnabled: true },
      }),
      this.prisma.authAuditLog.create({
        data: { userId, eventType: 'MFA_ENABLED' },
      }),
    ]);
  }

  async disableMfa(userId: string, otp: string): Promise<void> {
    const user = await this.usersService.findByIdWithMfa(userId);
    if (!user?.mfaEnabled || !user.mfaSecret) {
      throw new BadRequestException('MFA não está ativado');
    }

    if (!(await this.mfaService.verifyToken(otp, user.mfaSecret))) {
      throw new UnauthorizedException('OTP inválido');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { mfaEnabled: false, mfaSecret: null },
      }),
      this.prisma.authAuditLog.create({
        data: { userId, eventType: 'MFA_DISABLED' },
      }),
    ]);
  }

  async completeMfaLogin(
    challengeId: string,
    otp: string,
    ip?: string,
    userAgent?: string,
  ): Promise<LoginResult> {
    const userId = await this.mfaService.consumeChallenge(challengeId);

    if (!userId) {
      throw new UnauthorizedException('Challenge MFA inválido ou expirado');
    }

    const user = await this.usersService.findByIdWithMfa(userId);

    if (!user?.mfaEnabled || !user.mfaSecret) {
      throw new UnauthorizedException('MFA não configurado');
    }

    if (!(await this.mfaService.verifyToken(otp, user.mfaSecret))) {
      await this.prisma.authAuditLog.create({
        data: { userId, eventType: 'MFA_CHALLENGE_FAILED', ip, userAgent },
      });
      throw new UnauthorizedException('OTP inválido');
    }

    const jti = randomUUID();
    const accessToken = this.jwtService.sign({ sub: userId, jti });
    const rawRefreshToken = randomBytes(32).toString('hex');

    await this.prisma.$transaction([
      this.prisma.refreshToken.create({
        data: {
          userId,
          tokenHash: hashToken(rawRefreshToken),
          familyId: randomUUID(),
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
          ip,
          userAgent,
        },
      }),
      this.prisma.authAuditLog.create({
        data: { userId, eventType: 'MFA_CHALLENGE_PASSED', ip, userAgent },
      }),
    ]);

    return { accessToken, refreshToken: rawRefreshToken };
  }
}
