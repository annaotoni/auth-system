import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../../common/interfaces/access-token-payload';
import {
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_TTL_MS,
} from './auth.constants';
import { AuthService } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { MfaDisableDto } from './dto/mfa-disable.dto';
import { MfaSetupConfirmDto } from './dto/mfa-setup-confirm.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_TOKEN_COOKIE_NAME, token, {
      httpOnly: true,
      secure: this.config.getOrThrow<string>('NODE_ENV') === 'production',
      sameSite: 'strict',
      maxAge: REFRESH_TOKEN_TTL_MS,
      path: '/auth',
    });
  }

  @Post('register')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(@Body() dto: RegisterDto): Promise<{ message: string }> {
    await this.authService.register(dto);
    return {
      message:
        'Se o e-mail informado não estiver em uso, você receberá um link de verificação.',
    };
  }

  @Get('verify')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyEmail(
    @Query() query: VerifyEmailDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ message: string }> {
    await this.authService.verifyEmail(query.token, ip, userAgent);
    return { message: 'E-mail verificado com sucesso.' };
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
  ): Promise<
    { accessToken: string } | { mfaRequired: true; challengeId: string }
  > {
    const result = await this.authService.login(dto, ip, userAgent);

    if (result.mfaRequired) {
      return { mfaRequired: true, challengeId: result.challengeId! };
    }

    this.setRefreshCookie(res, result.refreshToken!);

    return { accessToken: result.accessToken! };
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async refresh(
    @Req() req: Request,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ accessToken: string }> {
    const rawToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME] as
      string | undefined;

    if (!rawToken) {
      throw new UnauthorizedException('Refresh token ausente');
    }

    const result = await this.authService.refresh(rawToken, ip, userAgent);

    this.setRefreshCookie(res, result.refreshToken!);

    return { accessToken: result.accessToken! };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async logout(
    @Req() req: Request,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() currentUser: AccessTokenPayload,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ message: string }> {
    const rawToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME] as
      string | undefined;

    if (rawToken) {
      await this.authService.logout(rawToken, currentUser, ip, userAgent);
    }

    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { path: '/auth' });

    return { message: 'Logout realizado com sucesso.' };
  }

  @Post('resend-verification')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async resendVerification(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.resendVerification(dto.email);
    return {
      message:
        'Se o e-mail informado tiver um cadastro pendente, você receberá um novo link de verificação.',
    };
  }

  @Post('forgot-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.forgotPassword(dto.email);
    return {
      message:
        'Se o e-mail informado estiver cadastrado, você receberá um link para redefinir a senha.',
    };
  }

  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ message: string }> {
    await this.authService.resetPassword(
      dto.token,
      dto.newPassword,
      ip,
      userAgent,
    );
    return { message: 'Senha redefinida com sucesso.' };
  }

  @Post('mfa/setup')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async mfaSetup(
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<{ qrCodeDataUrl: string; secret: string }> {
    return this.authService.setupMfa(user.sub);
  }

  @Post('mfa/enable')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async mfaEnable(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: MfaSetupConfirmDto,
  ): Promise<{ message: string }> {
    await this.authService.enableMfa(user.sub, dto.otp);
    return { message: 'MFA ativado com sucesso.' };
  }

  @Post('mfa/disable')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async mfaDisable(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: MfaDisableDto,
  ): Promise<{ message: string }> {
    await this.authService.disableMfa(user.sub, dto.otp);
    return { message: 'MFA desativado.' };
  }

  @Post('mfa/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async mfaVerify(
    @Body() dto: MfaVerifyDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ accessToken: string }> {
    const result = await this.authService.completeMfaLogin(
      dto.challengeId,
      dto.otp,
      ip,
      userAgent,
    );
    this.setRefreshCookie(res, result.refreshToken!);
    return { accessToken: result.accessToken! };
  }
}
