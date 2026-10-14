import { describe, expect, it } from 'vitest';
import { ApiError, errorText, weekdaysLabel } from './api';

describe('outils du client admin', () => {
  it('libellé des jours', () => {
    expect(weekdaysLabel(127)).toBe('Tous les jours');
    expect(weekdaysLabel(0b0010101)).toBe('Lun · Mer · Ven');
  });

  it('message d’erreur : erreurs de champ d’abord', () => {
    expect(errorText(new ApiError(400, 'VALIDATION', 'Données invalides.', { value: ['Entier entre 13 et 99.'] }))).toBe('Entier entre 13 et 99.');
    expect(errorText(new ApiError(403, 'FORBIDDEN', 'Interdit.'))).toBe('Interdit.');
    expect(errorText(new Error('x'))).toBe('Erreur inattendue.');
  });
});
