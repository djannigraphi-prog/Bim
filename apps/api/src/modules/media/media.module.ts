import { Controller, Get, Global, Header, Module, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { StorageService } from './storage';

/** Lecture des fichiers par lien signé temporaire (stockage local de développement uniquement). */
@ApiExcludeController()
@Controller('v1/media')
export class MediaController {
  constructor(private readonly storage: StorageService) {}

  @Public()
  @Get(':token')
  @Header('Cache-Control', 'private, no-store')
  async read(@Param('token') token: string, @Res() res: Response) {
    const body = await this.storage.readSigned(token);
    res.type('image/jpeg').send(body);
  }
}

@Global()
@Module({ controllers: [MediaController], providers: [StorageService], exports: [StorageService] })
export class MediaModule {}
