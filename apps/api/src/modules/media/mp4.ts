/**
 * Lot 11 — Lecture minimale d'un fichier MP4 / MOV (ISO BMFF), sans dépendance ni transcodage :
 *  - `inspectMp4` vérifie le format (boîte « ftyp » en tête, « moov » présente) et lit la durée (« mvhd ») et la taille
 *    de l'image (« tkhd » de la piste vidéo) ;
 *  - `scrubMp4Metadata` neutralise les métadonnées (« udta », « meta », « uuid » : position GPS, appareil, logiciel) en
 *    les renommant « free » et en effaçant leur contenu : même taille, donc les positions des images dans le fichier restent valables et le
 *    lecteur ignore simplement ces boîtes ; les dates de création sont remises à zéro. Une vidéo qui porte une piste de
 *    données de capteurs (GPS minuté) est refusée par le service, faute de pouvoir l'effacer sans transcodage.
 */

export interface Mp4Info {
  durationMs: number;
  width: number | null;
  height: number | null;
  /** Piste de métadonnées minutées (GPS des caméras d'action, capteurs…) : refusée, elle ne peut pas être effacée sans transcodage. */
  metadataTrack: boolean;
}

/** Types de pistes qui transportent des données de capteurs (dont la position) dans les échantillons eux-mêmes. */
const METADATA_HANDLERS = new Set(['meta', 'camm']);

interface Box {
  type: string;
  /** Début de la boîte (en-tête compris). */
  start: number;
  /** Début du contenu. */
  body: number;
  end: number;
}

function* boxes(buf: Buffer, from: number, to: number): Generator<Box> {
  let at = from;
  while (at + 8 <= to) {
    let size = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    let body = at + 8;
    if (size === 1) {
      if (at + 16 > to) return;
      const big = buf.readBigUInt64BE(at + 8);
      if (big > BigInt(to - at)) return;
      size = Number(big);
      body = at + 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < body - at || at + size > to) return;
    yield { type, start: at, body, end: at + size };
    at += size;
  }
}

const child = (buf: Buffer, parent: Box, type: string) => [...boxes(buf, parent.body, parent.end)].find((b) => b.type === type);

export class Mp4Error extends Error {}

export function inspectMp4(buf: Buffer): Mp4Info {
  const top = [...boxes(buf, 0, buf.length)];
  if (top[0]?.type !== 'ftyp') throw new Mp4Error('not_mp4');
  const moov = top.find((b) => b.type === 'moov');
  if (!moov) throw new Mp4Error('no_moov');
  const mvhd = child(buf, moov, 'mvhd');
  if (!mvhd || mvhd.body + 4 > mvhd.end) throw new Mp4Error('no_mvhd');
  const version = buf.readUInt8(mvhd.body);
  let timescale: number;
  let duration: number;
  if (version === 1) {
    if (mvhd.body + 32 > mvhd.end) throw new Mp4Error('bad_mvhd');
    timescale = buf.readUInt32BE(mvhd.body + 20);
    duration = Number(buf.readBigUInt64BE(mvhd.body + 24));
  } else {
    if (mvhd.body + 20 > mvhd.end) throw new Mp4Error('bad_mvhd');
    timescale = buf.readUInt32BE(mvhd.body + 12);
    duration = buf.readUInt32BE(mvhd.body + 16);
  }
  if (!timescale) throw new Mp4Error('bad_mvhd');
  let width: number | null = null;
  let height: number | null = null;
  let metadataTrack = false;
  for (const trak of [...boxes(buf, moov.body, moov.end)].filter((b) => b.type === 'trak')) {
    const mdia = child(buf, trak, 'mdia');
    const hdlr = mdia ? child(buf, mdia, 'hdlr') : undefined;
    if (hdlr && hdlr.body + 12 <= hdlr.end && METADATA_HANDLERS.has(buf.toString('latin1', hdlr.body + 8, hdlr.body + 12))) metadataTrack = true;
    const tkhd = child(buf, trak, 'tkhd');
    if (!tkhd || tkhd.end - tkhd.body < 84) continue;
    // Largeur et hauteur : les 8 derniers octets de « tkhd », en virgule fixe 16.16.
    const w = buf.readUInt32BE(tkhd.end - 8) >>> 16;
    const h = buf.readUInt32BE(tkhd.end - 4) >>> 16;
    if (w > 0 && h > 0 && width === null) {
      width = w;
      height = h;
    }
  }
  return { durationMs: Math.round((duration / timescale) * 1000), width, height, metadataTrack };
}

const SCRUB = new Set(['udta', 'meta', 'uuid']);

/** Copie du fichier dont les boîtes de métadonnées (fichier, film, pistes) sont devenues « free ». */
export function scrubMp4Metadata(input: Buffer): Buffer {
  const buf = Buffer.from(input);
  // Renommée « free » et vidée : le contenu (coordonnées…) ne reste pas dans le fichier.
  const neutralize = (b: Box) => {
    buf.write('free', b.start + 4, 'latin1');
    buf.fill(0, b.body, b.end);
  };
  // Dates de création et de modification (« mvhd », « tkhd », « mdhd ») remises à zéro : elles disent quand et, avec
  // le fuseau, parfois où la vidéo a été filmée.
  const clearDates = (b: Box) => {
    if (b.body + 4 > b.end) return;
    const wide = buf.readUInt8(b.body) === 1;
    const len = wide ? 16 : 8;
    if (b.body + 4 + len <= b.end) buf.fill(0, b.body + 4, b.body + 4 + len);
  };
  for (const b of boxes(buf, 0, buf.length)) {
    if (SCRUB.has(b.type)) neutralize(b);
    if (b.type !== 'moov') continue;
    for (const m of boxes(buf, b.body, b.end)) {
      if (SCRUB.has(m.type)) neutralize(m);
      if (m.type === 'mvhd') clearDates(m);
      if (m.type !== 'trak') continue;
      for (const t of boxes(buf, m.body, m.end)) {
        if (SCRUB.has(t.type)) neutralize(t);
        if (t.type === 'tkhd') clearDates(t);
        if (t.type === 'mdia') for (const x of boxes(buf, t.body, t.end)) if (x.type === 'mdhd') clearDates(x);
      }
    }
  }
  return buf;
}
