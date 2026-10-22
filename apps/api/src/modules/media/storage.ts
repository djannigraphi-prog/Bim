import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { hmacSha256, safeEqualHex } from '../../common/crypto';
import { Errors } from '../../common/errors';

/**
 * Stockage privé des fichiers. Aucun fichier n'est public : la lecture passe par un lien temporaire
 * (URL présignée S3, ou lien signé servi par l'API pour le stockage local de développement).
 */
@Injectable()
export class StorageService {
  private s3?: S3Client;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    if (cfg.MEDIA_STORAGE === 's3') {
      this.s3 = new S3Client({
        region: cfg.S3_REGION,
        ...(cfg.S3_ENDPOINT ? { endpoint: cfg.S3_ENDPOINT, forcePathStyle: true } : {}),
      });
    }
  }

  get available(): boolean {
    return this.cfg.MEDIA_STORAGE !== 'none';
  }

  private assertAvailable() {
    if (!this.available) throw Errors.notConfigured('Le stockage des photos');
  }

  private localPath(key: string): string {
    const base = normalize(this.cfg.MEDIA_LOCAL_DIR);
    const p = normalize(join(base, key));
    if (!p.startsWith(base)) throw Errors.forbidden();
    return p;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.assertAvailable();
    if (this.s3) {
      await this.s3.send(new PutObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: this.cfg.S3_ENDPOINT ? undefined : 'AES256' }));
      return;
    }
    const p = this.localPath(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }

  /** Lecture directe d'un fichier par le serveur (ex. copie des photos avant / après dans une publication, lot 4). */
  async read(key: string): Promise<Buffer> {
    this.assertAvailable();
    if (this.s3) {
      const out = await this.s3.send(new GetObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }));
      return Buffer.from(await out.Body!.transformToByteArray());
    }
    return readFile(this.localPath(key));
  }

  async remove(key: string): Promise<void> {
    if (!this.available) return;
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }));
      return;
    }
    await rm(this.localPath(key), { force: true });
  }

  /**
   * Lien de lecture temporaire. `apiBaseUrl` sert au stockage local (lien servi par l'API).
   * Le lien est le même pour un fichier donné pendant toute une tranche de temps (MEDIA_URL_TTL_SECONDS) : l'app peut
   * garder l'image ou la vidéo en cache au lieu de la retélécharger à chaque actualisation. Il reste valable au moins
   * une durée complète (fin de la tranche suivante : entre 1 et 2 fois MEDIA_URL_TTL_SECONDS).
   */
  async temporaryUrl(key: string, apiBaseUrl: string): Promise<{ url: string; expiresAt: string }> {
    this.assertAvailable();
    const ttl = this.cfg.MEDIA_URL_TTL_SECONDS;
    const bucketStart = Math.floor(Date.now() / 1000 / ttl) * ttl;
    const exp = bucketStart + 2 * ttl;
    const expiresAt = new Date(exp * 1000).toISOString();
    if (this.s3) {
      // Signature datée du début de la tranche : même URL présignée pendant toute la tranche (mêmes identifiants).
      const url = await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }), { expiresIn: 2 * ttl, signingDate: new Date(bucketStart * 1000) });
      return { url, expiresAt };
    }
    const token = Buffer.from(`${key}|${exp}|${this.sign(key, exp)}`).toString('base64url');
    return { url: `${apiBaseUrl}/v1/media/${token}`, expiresAt };
  }

  private sign(key: string, exp: number): string {
    return hmacSha256(this.cfg.JWT_ACCESS_SECRET, `media:${key}:${exp}`);
  }

  /** Lecture d'un lien signé (stockage local uniquement). */
  async readSigned(token: string): Promise<Buffer> {
    return (await this.readSignedFile(token)).body;
  }

  /** Lecture d'un lien signé avec le type du fichier (lot 11 : vidéos « .mp4 » ; V1 : vocaux « .m4a »). */
  async readSignedFile(token: string): Promise<{ body: Buffer; contentType: string }> {
    const f = await this.openSignedFile(token);
    try {
      return { body: await readFile(f.path), contentType: f.contentType };
    } catch {
      throw Errors.notFound('Fichier');
    }
  }

  /**
   * Fichier désigné par un lien signé (stockage local uniquement), sans le lire : chemin, taille et type. Sert à la
   * lecture par morceaux (en-tête « Range ») des vidéos et des vocaux.
   */
  async openSignedFile(token: string): Promise<{ path: string; size: number; contentType: string }> {
    if (this.cfg.MEDIA_STORAGE !== 'local') throw Errors.notFound('Fichier');
    const [key, expRaw, sig] = Buffer.from(token, 'base64url').toString('utf8').split('|');
    const exp = Number(expRaw);
    if (!key || !sig || !Number.isFinite(exp) || exp < Date.now() / 1000 || !safeEqualHex(sig, this.sign(key, exp))) throw Errors.notFound('Fichier');
    const path = this.localPath(key);
    try {
      const st = await stat(path);
      if (!st.isFile()) throw new Error('not_file');
      return { path, size: st.size, contentType: key.endsWith('.mp4') ? 'video/mp4' : key.endsWith('.m4a') ? 'audio/mp4' : 'image/jpeg' };
    } catch {
      throw Errors.notFound('Fichier');
    }
  }
}
