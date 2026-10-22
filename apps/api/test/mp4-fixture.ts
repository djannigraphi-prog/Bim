/** Petit fichier MP4 synthétique (boîtes ISO BMFF) pour les tests : durée, taille d'image et position GPS ; `audio` : M4A (vocal). */
const box = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
};

/**
 * `metaTrack` : piste de métadonnées minutées (« hdlr » meta) avec sa description d'échantillons, ex. « mebx » (iPhone)
 * ou « gpmd » (GoPro) ; `keys` : texte placé dans la description (clés « mebx »).
 * `fragmented` : MP4 fragmenté (« mvhd » à 0) dont la durée est dans « mehd », ou seulement dans les fragments
 * (« trun » avec durées par échantillon, ou durée par défaut de « tfhd »), ou introuvable (« none »).
 */
export function testMp4(opts: { seconds?: number; width?: number; height?: number; gps?: string; version1?: boolean; gpsTrack?: boolean; audio?: boolean; rotate90?: boolean; metaTrack?: { entry: string; keys?: string }; fragmented?: 'mehd' | 'trun' | 'tfhd' | 'none' } = {}): Buffer {
  const timescale = 1000;
  const duration = Math.round((opts.seconds ?? 12) * timescale);
  const fragmented = opts.fragmented;
  let mvhd: Buffer;
  if (opts.version1) {
    mvhd = Buffer.alloc(32 + 80);
    mvhd.writeUInt8(1, 0);
    mvhd.writeUInt32BE(timescale, 20);
    mvhd.writeBigUInt64BE(BigInt(duration), 24);
  } else {
    mvhd = Buffer.alloc(20 + 80);
    mvhd.writeUInt32BE(timescale, 12);
    mvhd.writeUInt32BE(fragmented ? 0 : duration, 16);
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
  mdhd.writeUInt32BE(timescale, 12);
  tkhd.writeUInt32BE(1, 12); // identifiant de la piste
  const video = box('trak', box('tkhd', tkhd), box('mdia', box('mdhd', mdhd), hdlr(opts.audio ? 'soun' : 'vide')));
  const gpsTrak = opts.gpsTrack ? [box('trak', box('tkhd', Buffer.alloc(84)), box('mdia', hdlr('meta')))] : [];
  const metaTrak = opts.metaTrack
    ? [
        box('trak', box('tkhd', Buffer.alloc(84)), box('mdia', box('mdhd', Buffer.alloc(24)), hdlr('meta'),
          box('minf', box('stbl', box('stsd', Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]),
            box(opts.metaTrack.entry, Buffer.alloc(8), box('keys', Buffer.from(opts.metaTrack.keys ?? 'mdtacom.apple.quicktime.video-orientation', 'latin1'))))))),
        ),
      ]
    : [];
  const u32 = (...xs: number[]) => Buffer.concat(xs.map((x) => { const b = Buffer.alloc(4); b.writeUInt32BE(x >>> 0); return b; }));
  let mvex: Buffer[] = [];
  let fragments: Buffer[] = [];
  if (fragmented) {
    // 2 fragments de durée égale ; 25 images par seconde.
    const half = duration / 2;
    const perSample = timescale / 25;
    const n = Math.round(half / perSample);
    const trex = box('trex', u32(0, 1, 1, fragmented === 'trun' ? perSample : 0, 0, 0));
    mvex = [box('mvex', ...(fragmented === 'mehd' ? [box('mehd', u32(0, duration))] : []), trex)];
    if (fragmented !== 'mehd') {
      const traf = () => {
        if (fragmented === 'none') return box('traf', box('tfhd', u32(0x020000, 1)), box('trun', u32(0x000001, n, 0)));
        // « tfhd » : durée par défaut (drapeau 0x08) ; sinon « trun » donne la durée (0x100) et la taille (0x200) de chaque image.
        if (fragmented === 'tfhd') return box('traf', box('tfhd', u32(0x020008, 1, perSample)), box('trun', u32(0x000001, n, 0)));
        return box('traf', box('tfhd', u32(0x020000, 1)), box('trun', u32(0x000301, n, 0), ...Array.from({ length: n }, () => u32(perSample, 10))));
      };
      fragments = [box('moof', box('mfhd', u32(0, 1)), traf()), box('mdat', Buffer.alloc(64, 7)), box('moof', box('mfhd', u32(0, 2)), traf()), box('mdat', Buffer.alloc(64, 7))];
    }
  }
  const moov = box('moov', box('mvhd', mvhd), video, ...gpsTrak, ...metaTrak, ...mvex, udta);
  const mdat = box('mdat', Buffer.alloc(2048, 7));
  return Buffer.concat([ftyp, moov, ...(fragments.length ? fragments : [mdat])]);
}
