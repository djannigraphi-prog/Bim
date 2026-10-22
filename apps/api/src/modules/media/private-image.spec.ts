import sharp from 'sharp';
import { cropTarget, encodePrivateImage, PRODUCT_ASPECT } from './private-image';

const file = async (width: number, height: number, orientation?: number) => {
  let img = sharp({ create: { width, height, channels: 3, background: 'teal' } }).jpeg();
  if (orientation) img = img.withMetadata({ orientation });
  const buffer = await img.toBuffer();
  return { buffer, size: buffer.length, mimetype: 'image/jpeg' } as Express.Multer.File;
};

describe('Photos d’articles : carré ou portrait (V1, 19/10/2026)', () => {
  it('calcule le recadrage : paysage → carré, trop haut → 2:3, sinon inchangé ; 1600 px au plus', () => {
    expect(cropTarget(1200, 800, PRODUCT_ASPECT)).toEqual({ width: 800, height: 800, cropped: true });
    expect(cropTarget(600, 1200, PRODUCT_ASPECT)).toEqual({ width: 600, height: 900, cropped: true });
    expect(cropTarget(800, 1000, PRODUCT_ASPECT)).toEqual({ width: 800, height: 1000, cropped: false });
    expect(cropTarget(4000, 3000, PRODUCT_ASPECT)).toEqual({ width: 1600, height: 1600, cropped: true });
    expect(cropTarget(4000, 3000)).toEqual({ width: 1600, height: 1200, cropped: false });
  });

  it('recadre réellement l’image envoyée, orientation de l’appareil comprise', async () => {
    expect(await encodePrivateImage(await file(1200, 800), 10, 'photos', PRODUCT_ASPECT)).toMatchObject({ width: 800, height: 800 });
    expect(await encodePrivateImage(await file(500, 1500), 10, 'photos', PRODUCT_ASPECT)).toMatchObject({ width: 500, height: 750 });
    expect(await encodePrivateImage(await file(900, 1200), 10, 'photos', PRODUCT_ASPECT)).toMatchObject({ width: 900, height: 1200 });
    // Stockée en paysage mais affichée en portrait (orientation 6) : déjà au bon format, gardée telle quelle.
    expect(await encodePrivateImage(await file(1200, 900, 6), 10, 'photos', PRODUCT_ASPECT)).toMatchObject({ width: 900, height: 1200 });
    // Sans bornes (photos de projet) : jamais recadrée.
    expect(await encodePrivateImage(await file(1200, 800), 10, 'photo')).toMatchObject({ width: 1200, height: 800 });
  });
});

describe('Images privées : transparence et très grandes images (V1)', () => {
  it('pose la transparence sur du blanc (PNG détouré), jamais sur du noir', async () => {
    const buffer = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const out = await encodePrivateImage({ buffer, size: buffer.length, mimetype: 'image/png' } as Express.Multer.File, 10, 'photo');
    const [r, g, b] = await sharp(out.data).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    expect(Math.min(r, g, b)).toBeGreaterThan(245);
  });

  it('au-delà de 50 mégapixels : « Image trop grande », pas « Image illisible »', async () => {
    const buffer = await sharp({ create: { width: 8192, height: 6144, channels: 3, background: 'teal' } }).jpeg({ quality: 50 }).toBuffer();
    const err = await encodePrivateImage({ buffer, size: buffer.length, mimetype: 'image/jpeg' } as Express.Multer.File, 25, 'photo').catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: { photo: [expect.stringMatching(/^Image trop grande/)] } } });
  });
});
