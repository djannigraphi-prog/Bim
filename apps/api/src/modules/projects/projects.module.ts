import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectPhotosService } from './photos.service';
import { CLOCK, ProjectsService } from './projects.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ProjectsController, ReportsController],
  providers: [ProjectsService, ProjectPhotosService, ReportsService, { provide: CLOCK, useValue: { now: () => new Date() } }],
})
export class ProjectsModule {}
