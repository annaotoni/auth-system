import { IsString, Length } from 'class-validator';

export class MfaSetupConfirmDto {
  @IsString()
  @Length(6, 6)
  otp!: string;
}
