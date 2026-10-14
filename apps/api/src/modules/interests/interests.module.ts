import { Module } from '@nestjs/common';
import { InterestsController } from './interests.controller';

@Module({ controllers: [InterestsController] })
export class InterestsModule {}
