/** Petit fichier MP4 synthétique (boîtes ISO BMFF) pour les tests : durée, taille d'image et position GPS ; `audio` : M4A (vocal). */
const box = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
};

export function testMp4(opts: { seconds?: number; width?: number; height?: number; gps?: string; version1?: boolean; gpsTrack?: boolean; audio?: boolean; rotate90?: boolean } = {}): Buffer {
  const timescale = 1000;
  const duration = Math.round((opts.seconds ?? 12) * timescale);
  let mvhd: Buffer;
  if (opts.version1) {
    mvhd = Buffer.alloc(32 + 80);
    mvhd.writeUInt8(1, 0);
    mvhd.writeUInt32BE(timescale, 20);
    mvhd.writeBigUInt64BE(BigInt(duration), 24);
  } else {
    mvhd = Buffer.alloc(20 + 80);
    mvhd.writeUInt32BE(timescale, 12);
    mvhd.writeUInt32BE(duration, 16);
  }
  // Date de création (secondes depuis 1904) : doit disparaître du fichier publié.
  mvhd.writeUInt32BE(0xdeadbeef, 4);
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(0xdeadbeef, 4);
  // Son seul (message vocal) : aucune taille d'image.
  tkhd.writeUInt32BE((opts.audio ? 0 : (opts.width ?? 720)) << 16, 76);
  tkhd.writeUInt32BE((opts.audio ? 0 : (opts.height ?? 1280)) << 16, 80);
  // Matrice : identité, ou quart de tour (vidéo de téléphone filmée en portrait, enregistrée « couchée »).
  if (opts.rotate90) {
    tkhd.writeInt32BE(0x10000, 44);
    tkhd.writeInt32BE(-0x10000, 52);
  } else {
    tkhd.writeInt32BE(0x10000, 40);
    tkhd.writeInt32BE(0x10000, 56);
  }
  tkhd.writeInt32BE(0x40000000, 72);
  const udta = box('udta', box('\xa9xyz', Buffer.from(opts.gps ?? '+05.3600-004.0083/', 'latin1')));
  const ftyp = box('ftyp', Buffer.from('isom\0\0\x02\0isomiso2mp41', 'latin1'));
  const hdlr = (type: string) => box('hdlr', Buffer.concat([Buffer.alloc(8), Buffer.from(type, 'latin1'), Buffer.alloc(13)]));
  const mdhd = Buffer.alloc(24);
  mdhd.writeUInt32BE(0xdeadbeef, 4);
  const video = box('trak', box('tkhd', tkhd), box('mdia', box('mdhd', mdhd), hdlr(opts.audio ? 'soun' : 'vide')));
  const gpsTrak = opts.gpsTrack ? [box('trak', box('tkhd', Buffer.alloc(84)), box('mdia', hdlr('meta')))] : [];
  const moov = box('moov', box('mvhd', mvhd), video, ...gpsTrak, udta);
  const mdat = box('mdat', Buffer.alloc(2048, 7));
  return Buffer.concat([ftyp, moov, mdat]);
}
