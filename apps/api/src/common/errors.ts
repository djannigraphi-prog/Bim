import { HttpStatus } from '@nestjs/common';

/**
 * Erreur métier : un code stable (lu par l'app mobile) + un message en français affichable.
 * Les codes sont documentés dans docs/API_ERRORS.md ; ne jamais en renommer un sans migration côté mobile.
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  validation: (details: Record<string, unknown>) =>
    new AppError('VALIDATION_FAILED', 'Certaines informations sont invalides.', HttpStatus.BAD_REQUEST, details),
  unauthenticated: () => new AppError('UNAUTHENTICATED', 'Connecte-toi pour continuer.', HttpStatus.UNAUTHORIZED),
  forbidden: (message = "Tu n'as pas accès à cette action.") => new AppError('FORBIDDEN', message, HttpStatus.FORBIDDEN),
  notFound: (what = 'Élément') => new AppError('NOT_FOUND', `${what} introuvable.`, HttpStatus.NOT_FOUND),
  conflict: (code: string, message: string) => new AppError(code, message, HttpStatus.CONFLICT),
  tooMany: (message = 'Trop de tentatives. Réessaie dans quelques minutes.', details?: Record<string, unknown>) =>
    new AppError('TOO_MANY_ATTEMPTS', message, HttpStatus.TOO_MANY_REQUESTS, details),
  /** Fichier envoyé au-delà de la limite de réception (413) ; `limitMb` quand elle est connue. */
  fileTooLarge: (limitMb?: number) =>
    new AppError('FILE_TOO_LARGE', limitMb ? `Fichier trop lourd : ${limitMb} Mo au plus.` : 'Fichier trop lourd.', HttpStatus.PAYLOAD_TOO_LARGE, limitMb ? { limitMb } : undefined),
  notConfigured: (what: string) =>
    new AppError('NOT_CONFIGURED', `${what} n'est pas encore disponible.`, HttpStatus.SERVICE_UNAVAILABLE),
  ruleNotDecided: (rule: string) =>
    new AppError(
      'RULE_NOT_DECIDED',
      "Cette fonctionnalité n'est pas encore ouverte.",
      HttpStatus.SERVICE_UNAVAILABLE,
      { rule },
    ),
};
