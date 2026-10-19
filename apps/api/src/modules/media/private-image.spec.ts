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
