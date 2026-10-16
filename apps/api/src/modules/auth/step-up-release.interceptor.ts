import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { catchError, from, Observable, switchMap, throwError } from 'rxjs';
import type { AuthedRequest } from './auth.decorators';
import { StepUpService } from './step-up.service';

/** Statut HTTP d'une erreur levée par l'application (AppError ou exception Nest). */
function statusOf(err: unknown): number {
  const e = err as { status?: unknown; getStatus?: () => number };
  if (typeof e?.getStatus === 'function') return e.getStatus();
  return typeof e?.status === 'number' ? e.status : 500;
}

/**
 * Audit du 16/10/2026, défaut 2 : la garde prend la confirmation d'identité avant la validation des données et
 * l'opération. Si la requête est refusée par une erreur 4xx (données invalides, règle métier), l'opération n'a rien
 * modifié : la confirmation est rendue, la personne peut corriger sa saisie sans refaire mot de passe et code.
 * Une erreur 5xx ne la rend pas (on ne sait pas si l'opération a abouti).
 */
@Injectable()
export class StepUpReleaseInterceptor implements NestInterceptor {
  private readonly logger = new Logger('StepUp');

  constructor(private readonly stepUp: StepUpService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    return next.handle().pipe(
      catchError((err: unknown) => {
        const grantId = req.stepUpGrantId;
        const status = statusOf(err);
        if (!grantId || status < 400 || status >= 500) return throwError(() => err);
        return from(
          this.stepUp.release(grantId).catch((e: unknown) => this.logger.error(`Confirmation non rendue : ${String(e)}`)),
        ).pipe(switchMap(() => throwError(() => err)));
      }),
    );
  }
}
