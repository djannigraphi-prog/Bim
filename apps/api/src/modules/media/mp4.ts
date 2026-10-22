/**
 * Lot 11 — Lecture minimale d'un fichier MP4 / MOV (ISO BMFF), sans dépendance ni transcodage :
 *  - `inspectMp4` vérifie le format (boîte « ftyp » en tête, « moov » présente) et lit la durée (« mvhd ») et la taille
 *    de l'image telle qu'affichée (« tkhd » de la piste vidéo, rotation comprise) ;
 *  - `scrubMp4Metadata` neutralise les métadonnées (« udta », « meta », « uuid » : position GPS, appareil, logiciel) en
 *    les renommant « free » et en effaçant leur contenu : même taille, donc les positions des images dans le fichier restent valables et le
 *    lecteur ignore simplement ces boîtes ; les dates de création sont remises à zéro. Une vidéo qui porte une piste de
 *    données de capteurs (GPS minuté des caméras d'action) est refusée par le service, faute de pouvoir l'effacer sans
 *    transcodage ; les pistes minutées des iPhone (« mebx » : orientation, mise au point) sont acceptées.
 */

export interface Mp4Info {
  durationMs: number;
  width: number | null;
  height: number | null;
  /** Piste de données de capteurs (GPS des caméras d'action…) : refusée, elle ne peut pas être effacée sans transcodage. */
  metadataTrack: boolean;
}

/** Types de pistes de métadonnées minutées (leurs échantillons sont dans « mdat », pas dans une boîte effaçable). */
const METADATA_HANDLERS = new Set(['meta', 'camm']);
/** Formats d'échantillons connus pour transporter des données de capteurs : GoPro (« gpmd »), caméras 360 (« camm »). */
const SENSOR_SAMPLE_ENTRIES = new Set(['gpmd', 'camm']);
/**
 * Indices de position dans la description d'une piste de métadonnées (clés « mebx » d'Apple, type MIME ou espace de
 * noms de « mett » / « metx ») : ex. « com.apple.quicktime.location.ISO6709 ».
 */
const LOCATION_HINT = /location|gps|iso6709|latitude|longitude/i;

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
  /** Pistes : identifiant, échelle de temps (« mdhd ») et nature, pour la durée d'un MP4 fragmenté. */
  const tracks: { id: number; timescale: number; video: boolean }[] = [];
  for (const trak of [...boxes(buf, moov.body, moov.end)].filter((b) => b.type === 'trak')) {
    const mdia = child(buf, trak, 'mdia');
    const hdlr = mdia ? child(buf, mdia, 'hdlr') : undefined;
    const handler = hdlr && hdlr.body + 12 <= hdlr.end ? buf.toString('latin1', hdlr.body + 8, hdlr.body + 12) : '';
    if (METADATA_HANDLERS.has(handler) && sensorTrack(buf, mdia!, handler)) metadataTrack = true;
    const tkhd = child(buf, trak, 'tkhd');
    const mdhd = mdia ? child(buf, mdia, 'mdhd') : undefined;
    if (tkhd && mdhd) {
      const v1 = (box: Box) => box.body < box.end && buf.readUInt8(box.body) === 1;
      const idAt = tkhd.body + (v1(tkhd) ? 20 : 12);
      const tsAt = mdhd.body + (v1(mdhd) ? 20 : 12);
      if (idAt + 4 <= tkhd.end && tsAt + 4 <= mdhd.end) tracks.push({ id: buf.readUInt32BE(idAt), timescale: buf.readUInt32BE(tsAt), video: handler === 'vide' });
    }
    if (!tkhd || tkhd.end - tkhd.body < 84) continue;
    // Largeur et hauteur : les 8 derniers octets de « tkhd », en virgule fixe 16.16.
    const w = buf.readUInt32BE(tkhd.end - 8) >>> 16;
    const h = buf.readUInt32BE(tkhd.end - 4) >>> 16;
    if (w > 0 && h > 0 && width === null) {
      // Matrice de la piste (36 octets avant la taille) : a = 0 → quart de tour (vidéo filmée en portrait par un
      // téléphone et enregistrée « couchée ») ; la taille affichée est alors inversée.
      const a = buf.readInt32BE(tkhd.end - 8 - 36);
      const b = buf.readInt32BE(tkhd.end - 8 - 32);
      const quarter = a === 0 && b !== 0;
      width = quarter ? h : w;
      height = quarter ? w : h;
    }
  }
  let durationMs = Math.round((duration / timescale) * 1000);
  // MP4 fragmenté (enregistrement en continu) : « mvhd » ne donne pas la durée ; elle est dans « mvex/mehd » ou, à
  // défaut, se calcule à partir des durées d'échantillons des fragments (« moof »). 0 si elle reste introuvable.
  if (durationMs === 0) durationMs = fragmentedDurationMs(buf, top, moov, timescale, tracks);
  return { durationMs, width, height, metadataTrack };
}

/**
 * Piste de métadonnées minutées qui peut transporter des données de capteurs (position…) : refusée, faute de pouvoir
 * l'effacer sans transcodage. Les pistes minutées des iPhone (« mebx » : orientation, mise au point, Live Photo) sont
 * acceptées, sauf si leur description annonce une position. Une description illisible est refusée par prudence.
 */
function sensorTrack(buf: Buffer, mdia: Box, handler: string): boolean {
  if (handler === 'camm') return true;
  const minf = child(buf, mdia, 'minf');
  const stbl = minf ? child(buf, minf, 'stbl') : undefined;
  const stsd = stbl ? child(buf, stbl, 'stsd') : undefined;
  // « stsd » : version et drapeaux (4), nombre d'entrées (4), puis les descriptions (taille 4 + format 4…).
  if (!stsd || stsd.body + 16 > stsd.end) return true;
  const entries = [...boxes(buf, stsd.body + 8, stsd.end)];
  if (!entries.length) return true;
  return entries.some((e) => SENSOR_SAMPLE_ENTRIES.has(e.type) || LOCATION_HINT.test(buf.toString('latin1', e.body, e.end)));
}

/** Durée d'un MP4 fragmenté, en millisecondes (0 si elle ne peut pas être lue simplement). */
function fragmentedDurationMs(buf: Buffer, top: Box[], moov: Box, movieTimescale: number, tracks: { id: number; timescale: number; video: boolean }[]): number {
  const mvex = child(buf, moov, 'mvex');
  if (!mvex) return 0;
  const mehd = child(buf, mvex, 'mehd');
  if (mehd && mehd.body + 8 <= mehd.end) {
    const wide = buf.readUInt8(mehd.body) === 1;
    const d = wide ? (mehd.body + 12 <= mehd.end ? Number(buf.readBigUInt64BE(mehd.body + 4)) : 0) : buf.readUInt32BE(mehd.body + 4);
    if (d > 0) return Math.round((d / movieTimescale) * 1000);
  }
  const track = tracks.find((t) => t.video) ?? tracks[0];
  if (!track?.timescale) return 0;
  // Durée par défaut des échantillons de la piste (« trex »).
  let trexDuration = 0;
  for (const trex of boxes(buf, mvex.body, mvex.end)) {
    if (trex.type === 'trex' && trex.body + 16 <= trex.end && buf.readUInt32BE(trex.body + 4) === track.id) trexDuration = buf.readUInt32BE(trex.body + 12);
  }
  let total = 0;
  for (const moof of top.filter((b) => b.type === 'moof')) {
    for (const traf of boxes(buf, moof.body, moof.end)) {
      if (traf.type !== 'traf') continue;
      const tfhd = child(buf, traf, 'tfhd');
      if (!tfhd || tfhd.body + 8 > tfhd.end || buf.readUInt32BE(tfhd.body + 4) !== track.id) continue;
      const tf = buf.readUInt32BE(tfhd.body) & 0xffffff;
      // Champs facultatifs de « tfhd », dans l'ordre : base_data_offset (8), sample_description_index (4), default_sample_duration (4).
      const at = tfhd.body + 8 + (tf & 0x01 ? 8 : 0) + (tf & 0x02 ? 4 : 0);
      let defaultDuration = trexDuration;
      if (tf & 0x08) {
        if (at + 4 > tfhd.end) return 0;
        defaultDuration = buf.readUInt32BE(at);
      }
      for (const trun of boxes(buf, traf.body, traf.end)) {
        if (trun.type !== 'trun' || trun.body + 8 > trun.end) continue;
        const f = buf.readUInt32BE(trun.body) & 0xffffff;
        const n = buf.readUInt32BE(trun.body + 4);
        if (!(f & 0x100)) {
          total += n * defaultDuration;
          continue;
        }
        // Une valeur de 4 octets par champ présent : durée (0x100), taille (0x200), drapeaux (0x400), décalage (0x800).
        const stride = 4 * [0x100, 0x200, 0x400, 0x800].filter((x) => f & x).length;
        let p = trun.body + 8 + (f & 0x01 ? 4 : 0) + (f & 0x04 ? 4 : 0);
        if (p + n * stride > trun.end) return 0;
        for (let i = 0; i < n; i++, p += stride) total += buf.readUInt32BE(p);
      }
    }
  }
  return Math.round((total / track.timescale) * 1000);
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
