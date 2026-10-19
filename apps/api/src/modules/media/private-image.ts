/// <reference types="multer" />
import sharp, { Metadata, OutputInfo } from 'sharp';
import { Errors } from '../../common/errors';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const REAL_FORMATS = ['jpeg', 'png', 'webp'];

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
/**
 * V1 (19/10/2026) — Formats d'un article du BimShop, façon Pinterest : carré ou portrait, jamais paysage. Rapport
 * largeur / hauteur entre 2:3 (portrait le plus haut) et 1:1 (carré) ; hors de ces bornes, la photo est recadrée.
 */
export const PRODUCT_ASPECT = { min: 2 / 3, max: 1 } as const;

/** Taille finale (1600 px au plus, jamais agrandie) et recadrage éventuel pour rester dans les bornes du rapport. */
export function cropTarget(width: number, height: number, aspect?: { min: number; max: number }, maxSide = 1600) {
  let w = width;
  let h = height;
  if (aspect) {
    const r = w / h;
    if (r > aspect.max) w = Math.round(h * aspect.max);
    else if (r < aspect.min) h = Math.round(w / aspect.min);
  }
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), cropped: w !== width || h !== height };
}

export async function encodePrivateImage(file: Express.Multer.File | undefined, maxMb: number, field: string, aspect?: { min: number; max: number }): Promise<PrivateImage> {
  if (!file) throw Errors.validation({ fields: { [field]: ['Image manquante.'] } });
  if (file.size > maxMb * 1024 * 1024) throw Errors.validation({ fields: { [field]: [`Image trop lourde (${maxMb} Mo au plus).`] } });
  if (!ACCEPTED.includes(file.mimetype)) throw Errors.validation({ fields: { [field]: ['Formats acceptés : JPEG, PNG, WebP.'] } });
  // Le type annoncé vient du client : on vérifie le contenu réel avant tout décodage (pas de SVG, TIFF… audit A-14).
  let format: string | undefined;
  let meta: Metadata;
  try {
    meta = await sharp(file.buffer, { limitInputPixels: 50_000_000 }).metadata();
    format = meta.format;
  } catch {
    throw Errors.validation({ fields: { [field]: ['Image illisible.'] } });
  }
  if (!format || !REAL_FORMATS.includes(format)) throw Errors.validation({ fields: { [field]: ['Formats acceptés : JPEG, PNG, WebP.'] } });
  let out: { data: Buffer; info: OutputInfo };
  // Dimensions telles qu'affichées (orientation EXIF 5 à 8 : image tournée d'un quart de tour).
  const turned = (meta.orientation ?? 1) >= 5;
  const shown = { width: (turned ? meta.height : meta.width) ?? 0, height: (turned ? meta.width : meta.height) ?? 0 };
  const target = aspect && shown.width > 0 && shown.height > 0 ? cropTarget(shown.width, shown.height, aspect) : null;
  try {
    out = await sharp(file.buffer, { failOn: 'error', limitInputPixels: 50_000_000 })
      .rotate()
      // Recadrage centré sur la partie la plus intéressante de l'image (« attention » : visages, contrastes).
      .resize(target?.cropped ? { width: target.width, height: target.height, fit: 'cover', position: sharp.strategy.attention } : { width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw Errors.validation({ fields: { [field]: ['Image illisible.'] } });
  }
  return { data: out.data, width: out.info.width, height: out.info.height, bytes: out.data.length };
}
