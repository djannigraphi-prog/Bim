import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ModerationService } from './moderation.service';
import { PeopleService } from './people.service';
import { PostsService } from './posts.service';
import { ModerationController, SocialController } from './social.controller';

/** Lot 4 — Social (publications, « J'ai fait mon BIM », fil, j'aime, commentaires, abonnements, blocages, modération). */
@Module({
  imports: [ProjectsModule],
  controllers: [SocialController, ModerationController],
  providers: [PostsService, PeopleService, ModerationService],
})
export class SocialModule {}
