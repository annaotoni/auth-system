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
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
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
  ): Promise<{ accessToken: string }> {
    const { accessToken, refreshToken } = await this.authService.login(
      dto,
      ip,
      userAgent,
    );

    this.setRefreshCookie(res, refreshToken);

    return { accessToken };
  }

  @Post('refresh')
  @HttpCode(200)
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

    const { accessToken, refreshToken } = await this.authService.refresh(
      rawToken,
      ip,
      userAgent,
    );

    this.setRefreshCookie(res, refreshToken);

    return { accessToken };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ message: string }> {
    const rawToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME] as
      string | undefined;

    if (rawToken) {
      await this.authService.logout(rawToken, ip, userAgent);
    }

    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { path: '/auth' });

    return { message: 'Logout realizado com sucesso.' };
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
}
