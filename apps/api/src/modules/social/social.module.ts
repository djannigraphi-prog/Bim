import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ProjectsModule } from '../projects/projects.module';
import { WalletModule } from '../wallet/wallet.module';
import { ModerationService } from './moderation.service';
import { PeopleService } from './people.service';
import { PostsService } from './posts.service';
import { ReelsService } from './reels.service';
import { StoriesService } from './stories.service';
import { ModerationController, SocialController } from './social.controller';

/** Lot 4 — Social (publications, « J'ai fait mon BIM », fil, j'aime, commentaires, abonnements, blocages, modération). */
@Module({
  imports: [ProjectsModule, CatalogModule, WalletModule],
  controllers: [SocialController, ModerationController],
  providers: [PostsService, PeopleService, ModerationService, StoriesService, ReelsService],
  exports: [StoriesService],
})
export class SocialModule {}
