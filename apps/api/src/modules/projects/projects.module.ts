import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectPhotosService } from './photos.service';
import { CLOCK, ProjectsService } from './projects.service';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectPhotosService, { provide: CLOCK, useValue: { now: () => new Date() } }],
})
export class ProjectsModule {}
