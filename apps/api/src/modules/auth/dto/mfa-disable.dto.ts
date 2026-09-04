import { IsString, Length } from 'class-validator';

export class MfaDisableDto {
  @IsString()
  @Length(6, 6)
  otp!: string;
}
