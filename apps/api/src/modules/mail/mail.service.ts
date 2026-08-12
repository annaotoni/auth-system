import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { buildEmailHtml } from './email-layout';

@Injectable()
export class MailService implements OnModuleInit {
  private transporter!: Transporter;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.transporter = createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: this.config.get<number>('SMTP_PORT'),
      secure: this.config.get<boolean>('SMTP_SECURE'),
      auth: this.config.get<string>('SMTP_USER')
        ? {
            user: this.config.get<string>('SMTP_USER'),
            pass: this.config.get<string>('SMTP_PASS'),
          }
        : undefined,
    });
  }

  async sendVerificationEmail(email: string, rawToken: string): Promise<void> {
    const verifyUrl = `${this.config.get<string>('FRONTEND_URL')}/verify-email?token=${rawToken}`;

    await this.transporter.sendMail({
      from: this.config.get<string>('MAIL_FROM'),
      to: email,
      subject: 'Confirme seu e-mail',
      html: buildEmailHtml({
        heading: 'Confirme seu e-mail',
        message:
          'Falta só um passo para ativar sua conta. Clique no botão abaixo para confirmar seu e-mail (o link é válido por 24 horas).',
        ctaLabel: 'Confirmar e-mail',
        ctaUrl: verifyUrl,
      }),
    });
  }

  async sendPasswordResetEmail(email: string, rawToken: string): Promise<void> {
    const resetUrl = `${this.config.get<string>('FRONTEND_URL')}/reset-password?token=${rawToken}`;

    await this.transporter.sendMail({
      from: this.config.get<string>('MAIL_FROM'),
      to: email,
      subject: 'Redefinição de senha',
      html: buildEmailHtml({
        heading: 'Redefinir senha',
        message:
          'Recebemos um pedido para redefinir sua senha. Clique no botão abaixo para escolher uma nova (o link é válido por 30 minutos).',
        ctaLabel: 'Redefinir senha',
        ctaUrl: resetUrl,
        footnote:
          'Se você não solicitou isso, pode ignorar este e-mail com segurança.',
      }),
    });
  }
}
