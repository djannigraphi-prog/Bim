import { Global, Module } from '@nestjs/common';
import { AgePolicyService } from './age-policy.service';

@Global()
@Module({ providers: [AgePolicyService], exports: [AgePolicyService] })
export class AgePolicyModule {}
