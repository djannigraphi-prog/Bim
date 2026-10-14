import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { CLOCK, ProjectsService } from './projects.service';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, { provide: CLOCK, useValue: { now: () => new Date() } }],
})
export class ProjectsModule {}
