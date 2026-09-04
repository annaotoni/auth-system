import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { HibpModule } from '../hibp/hibp.module';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { ACCESS_TOKEN_TTL } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaService } from './services/mfa.service';
import { TokenBlocklistService } from './services/token-blocklist.service';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';

@Module({
  imports: [
    UsersModule,
    MailModule,
    HibpModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: ACCESS_TOKEN_TTL },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAccessStrategy,
    TokenBlocklistService,
    MfaService,
  ],
  exports: [TokenBlocklistService],
})
export class AuthModule {}
