/// <reference types="multer" />
import sharp, { OutputInfo } from 'sharp';
import { Errors } from '../../common/errors';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export interface PrivateImage {
  data: Buffer;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Contrôle et ré-encode une image envoyée par une personne (photos de projet, pièces jointes des signalements).
 * Le fichier est réécrit en JPEG (orientation corrigée, 1600 px au plus) : les métadonnées, dont la position GPS,
 * ne sont jamais conservées. `field` est le nom du champ renvoyé dans les erreurs de validation.
 */
export async function encodePrivateImage(file: Express.Multer.File | undefined, maxMb: number, field: string): Promise<PrivateImage> {
  if (!file) throw Errors.validation({ fields: { [field]: ['Image manquante.'] } });
  if (file.size > maxMb * 1024 * 1024) throw Errors.validation({ fields: { [field]: [`Image trop lourde (${maxMb} Mo au plus).`] } });
  if (!ACCEPTED.includes(file.mimetype)) throw Errors.validation({ fields: { [field]: ['Formats acceptés : JPEG, PNG, WebP.'] } });
  let out: { data: Buffer; info: OutputInfo };
  try {
    out = await sharp(file.buffer, { failOn: 'error', limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw Errors.validation({ fields: { [field]: ['Image illisible.'] } });
  }
  return { data: out.data, width: out.info.width, height: out.info.height, bytes: out.data.length };
}
