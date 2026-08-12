import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { hash, verify } from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  ARGON2_OPTIONS,
  getDummyHash,
} from '../../common/constants/argon2-options';
import { hashToken } from '../../common/crypto/hash-token';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { REFRESH_TOKEN_TTL_MS } from './auth.constants';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<void> {
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

  async login(
    dto: LoginDto,
    ip?: string,
    userAgent?: string,
  ): Promise<LoginResult> {
    const user = await this.usersService.findByEmail(dto.email);

    // Sempre roda argon2.verify, mesmo sem usuário (contra um hash dummy):
    // sem esse custo simétrico, o tempo de resposta denunciaria se o
    // e-mail está cadastrado.
    const passwordValid = await verify(
      user?.passwordHash ?? (await getDummyHash()),
      dto.password,
    );

    if (!user || !passwordValid) {
      await this.logFailedLogin(
        dto.email,
        'invalid_credentials',
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

    const accessToken = this.jwtService.sign({ sub: user.id });
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

    const accessToken = this.jwtService.sign({ sub: tokenRecord.userId });

    return { accessToken, refreshToken: rawRefreshToken };
  }

  async logout(
    rawToken: string,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
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
}
