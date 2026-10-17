import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../../common/errors';
import { SettingsService } from '../settings/settings.service';
import { APP_PLATFORMS, AppPlatform, compareVersions, PLATFORM_HEADER, VERSION_HEADER } from './version';

/** Routes jamais bloquées : santé, administration (navigateur), notifications des prestataires, configuration de l'app. */
const EXEMPT = [/^\/health/, /^\/admin\//, /^\/v1\/payments\/webhooks\//, /^\/v1\/app\//];

/**
 * Lot 7-A — Version minimale de l'app (à imposer avant l'ouverture des commandes). L'app mobile envoie sa version et sa
 * plateforme à chaque requête ; si un minimum est **décidé** pour cette plateforme (`app.min_version_android`,
 * `app.min_version_ios`) et que la version est plus ancienne ou illisible, la requête est refusée (426,
 * APP_UPDATE_REQUIRED) et l'app affiche « Mise à jour nécessaire ». Sans minimum décidé : aucun effet.
 * Les requêtes sans plateforme mobile (administration, navigateur, outils) ne sont pas concernées.
 */
@Injectable()
export class AppVersionGuard implements CanActivate {
  constructor(private readonly settings: SettingsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    const path = req.path ?? req.url ?? '';
    if (EXEMPT.some((r) => r.test(path))) return true;
    const platform = String(req.headers[PLATFORM_HEADER] ?? '').toLowerCase();
    if (!APP_PLATFORMS.includes(platform as AppPlatform)) return true;
    const min = await this.minimum(platform as AppPlatform);
    if (!min) return true;
    const version = String(req.headers[VERSION_HEADER] ?? '');
    const cmp = compareVersions(version, min);
    if (cmp === null || cmp < 0) {
      throw new AppError('APP_UPDATE_REQUIRED', 'Une nouvelle version de BIM est nécessaire. Mets l’app à jour pour continuer.', 426 as HttpStatus, { minVersion: min, platform });
    }
    return true;
  }

  async minimum(platform: AppPlatform): Promise<string | null> {
    const s = await this.settings.get<string | null>(`app.min_version_${platform}`);
    return s?.decisionStatus === 'decided' && typeof s.value === 'string' && compareVersions(s.value, s.value) === 0 ? s.value : null;
  }
}
