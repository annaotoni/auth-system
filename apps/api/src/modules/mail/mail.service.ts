import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

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
      html: `<p>Confirme seu cadastro clicando no link abaixo (válido por 24h):</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
    });
  }
}
