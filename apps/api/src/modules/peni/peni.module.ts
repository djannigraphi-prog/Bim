import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { ProjectsModule } from '../projects/projects.module';
import { DisabledLlmProvider, LLM_PROVIDER, LlmProvider } from './llm-provider';
import { PeniController } from './peni.controller';
import { PeniService } from './peni.service';

function llmFactory(cfg: AppConfig): LlmProvider {
  switch (cfg.PENI_LLM_PROVIDER) {
    default:
      // Aucun fournisseur d'IA tant que le fondateur ne l'a pas autorisé.
      return new DisabledLlmProvider();
  }
}

/** Peni (lot 3). */
@Module({
  imports: [ProjectsModule],
  controllers: [PeniController],
  providers: [PeniService, { provide: LLM_PROVIDER, useFactory: llmFactory, inject: [APP_CONFIG] }],
  exports: [PeniService],
})
export class PeniModule {}
