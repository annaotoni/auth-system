import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Post,
  Query,
  Body,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(201)
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
}
