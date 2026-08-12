import { Module } from '@nestjs/common';
import { HibpService } from './hibp.service';

@Module({
  providers: [HibpService],
  exports: [HibpService],
})
export class HibpModule {}
