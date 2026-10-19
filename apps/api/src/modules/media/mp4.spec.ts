import { testMp4 } from '../../../test/mp4-fixture';
import { inspectMp4, Mp4Error, scrubMp4Metadata } from './mp4';

describe('MP4 (lot 11)', () => {
  it('lit la durée et la taille de l’image (versions 0 et 1 de « mvhd »)', () => {
    expect(inspectMp4(testMp4({ seconds: 12.5, width: 720, height: 1280 }))).toEqual({ durationMs: 12500, width: 720, height: 1280, metadataTrack: false });
    expect(inspectMp4(testMp4({ gpsTrack: true })).metadataTrack).toBe(true);
    expect(inspectMp4(testMp4({ seconds: 61, version1: true }))).toMatchObject({ durationMs: 61000 });
  });

  it('V1 : taille affichée, rotation comprise (portrait filmé au téléphone, enregistré « couché »)', () => {
    expect(inspectMp4(testMp4({ width: 1920, height: 1080, rotate90: true }))).toMatchObject({ width: 1080, height: 1920 });
    expect(inspectMp4(testMp4({ width: 1920, height: 1080 }))).toMatchObject({ width: 1920, height: 1080 });
  });

  it('refuse ce qui n’est pas un MP4 ou un fichier tronqué', () => {
    expect(() => inspectMp4(Buffer.from('%PDF-1.4 pas une vidéo'))).toThrow(Mp4Error);
    const f = testMp4();
    expect(() => inspectMp4(f.subarray(0, 40))).toThrow(Mp4Error);
  });

  it('neutralise les métadonnées (position GPS) sans changer la taille ni la durée', () => {
    const f = testMp4({ gps: '+05.3600-004.0083/' });
    expect(f.includes(Buffer.from('udta'))).toBe(true);
    const out = scrubMp4Metadata(f);
    expect(out.length).toBe(f.length);
    expect(out.includes(Buffer.from('udta'))).toBe(false);
    expect(out.includes(Buffer.from('+05.3600-004.0083/'))).toBe(false);
    expect(out.includes(Buffer.from([0xde, 0xad, 0xbe, 0xef]))).toBe(false); // dates de création effacées
    expect(inspectMp4(out)).toEqual(inspectMp4(f));
    expect(f.includes(Buffer.from('udta'))).toBe(true); // l'original n'est pas modifié
  });
});
