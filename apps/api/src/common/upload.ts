import { CallHandler, ExecutionContext, Inject, Injectable, mixin, NestInterceptor, PayloadTooLargeException, Type } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { catchError, from, Observable, switchMap, throwError } from 'rxjs';
import { APP_CONFIG, AppConfig } from '../config/config';
import { Errors } from './errors';

/**
 * Réception d'une vidéo (Reel, vidéo d'article) : la limite vient de la configuration validée (MEDIA_MAX_VIDEO_MB),
 * lue au démarrage du module et non à l'import du fichier ; au-delà, l'envoi est coupé dès la réception avec un
 * message clair qui donne la limite.
 */
export function VideoFileInterceptor(field: string): Type<NestInterceptor> {
  @Injectable()
  class VideoInterceptor implements NestInterceptor {
    private readonly inner: NestInterceptor;
    private readonly limitMb: number;

    constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
      this.limitMb = cfg.MEDIA_MAX_VIDEO_MB;
      const Inner = FileInterceptor(field, { limits: { fileSize: this.limitMb * 1024 * 1024, files: 1 } });
      this.inner = new Inner();
    }

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
      return from(Promise.resolve(this.inner.intercept(context, next))).pipe(
        switchMap((o) => o),
        catchError((e: unknown) => throwError(() => (e instanceof PayloadTooLargeException ? Errors.fileTooLarge(this.limitMb) : e))),
      );
    }
  }
  return mixin(VideoInterceptor);
}
