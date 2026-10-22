import { Controller, Get, Global, Module, Param, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { Public } from '../auth/auth.decorators';
import { StorageService } from './storage';

/**
 * Lecture des fichiers par lien signé temporaire (stockage local de développement uniquement).
 * Pas de limitation de débit : un fil d'images ou une vidéo lue par morceaux fait vite de nombreuses requêtes, et
 * l'accès est déjà protégé par le jeton signé et temporaire.
 */
@ApiExcludeController()
@SkipThrottle()
@Controller('v1/media')
export class MediaController {
  constructor(private readonly storage: StorageService) {}

  @Public()
  @Get(':token')
  async read(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const f = await this.storage.openSignedFile(token);
    res.setHeader('Cache-Control', 'private, no-store');
    // L'administration web (autre origine) affiche les images jointes aux signalements ; l'accès reste protégé
    // par le jeton signé et temporaire. Sans cet en-tête, helmet impose « same-origin » et le navigateur bloque l'image.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', f.contentType);
    // Lecture par morceaux (« Range ») : les lecteurs vidéo et audio des téléphones demandent le fichier par parties.
    const ranges = req.headers.range ? req.range(f.size, { combine: true }) : undefined;
    if (ranges === -1) {
      res.status(416).setHeader('Content-Range', `bytes */${f.size}`);
      res.end();
      return;
    }
    // En-tête mal formé ou plusieurs plages : le fichier entier (permis par la norme HTTP).
    const one = Array.isArray(ranges) && ranges.type === 'bytes' && ranges.length === 1 ? ranges[0] : undefined;
    const start = one ? one.start : 0;
    const end = one ? one.end : f.size - 1;
    if (one) {
      res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${f.size}`);
    } else {
      res.status(200);
    }
    res.setHeader('Content-Length', String(f.size === 0 ? 0 : end - start + 1));
    if (req.method === 'HEAD' || f.size === 0) {
      res.end();
      return;
    }
    const stream = createReadStream(f.path, { start, end });
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}

@Global()
@Module({ controllers: [MediaController], providers: [StorageService], exports: [StorageService] })
export class MediaModule {}
