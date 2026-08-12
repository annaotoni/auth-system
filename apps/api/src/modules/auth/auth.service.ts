import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hash } from 'argon2';
import { randomBytes } from 'node:crypto';
import { ARGON2_OPTIONS } from '../../common/constants/argon2-options';
import { hashToken } from '../../common/crypto/hash-token';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
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
}
