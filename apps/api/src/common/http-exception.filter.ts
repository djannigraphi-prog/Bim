import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';
import { AppError } from './errors';

/** Format unique des erreurs : { error: { code, message, details? } }. Les erreurs inattendues ne divulguent rien. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      res.status(exception.status).json({
        error: { code: exception.code, message: exception.message, ...(exception.details ? { details: exception.details } : {}) },
      });
      return;
    }
    if (exception instanceof ThrottlerException) {
      res.status(HttpStatus.TOO_MANY_REQUESTS).json({
        error: { code: 'RATE_LIMITED', message: 'Trop de requêtes. Patiente un instant.' },
      });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as { message?: unknown };
      const code = status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : 'HTTP_ERROR';
      res.status(status).json({
        error: { code, message: status === 404 ? 'Ressource introuvable.' : 'La requête a échoué.', details: { reason: body?.message } },
      });
      return;
    }
    this.logger.error(describeSafely(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'INTERNAL_ERROR', message: 'Une erreur est survenue. Réessaie plus tard.' },
    });
  }
}

/**
 * Message d'erreur sans données personnelles : les erreurs SQL de Drizzle contiennent la requête et ses paramètres
 * (téléphones, empreintes…) ; on ne garde que le type, le code PostgreSQL et le message du moteur.
 */
function describeSafely(exception: unknown): string {
  if (!(exception instanceof Error)) return 'Erreur inconnue';
  const cause = (exception as Error & { cause?: { code?: string; message?: string } }).cause;
  if (exception.message.startsWith('Failed query')) {
    return `Erreur base de données ${cause?.code ?? ''} : ${cause?.message ?? 'inconnue'}`;
  }
  const firstStackLines = (exception.stack ?? '').split('\n').slice(0, 6).join('\n');
  return firstStackLines.replace(/params: .*/g, 'params: [masqués]');
}
