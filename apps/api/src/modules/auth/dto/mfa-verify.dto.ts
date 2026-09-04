import { IsString, IsUUID, Length } from 'class-validator';

export class MfaVerifyDto {
  @IsUUID()
  challengeId!: string;

  @IsString()
  @Length(6, 6)
  otp!: string;
}
