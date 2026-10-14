import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

  async remove(key: string): Promise<void> {
    if (!this.available) return;
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }));
      return;
    }
    await rm(this.localPath(key), { force: true });
  }

  /** Lien de lecture temporaire. `apiBaseUrl` sert au stockage local (lien servi par l'API). */
  async temporaryUrl(key: string, apiBaseUrl: string): Promise<{ url: string; expiresAt: string }> {
    this.assertAvailable();
    const ttl = this.cfg.MEDIA_URL_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    if (this.s3) {
      const url = await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }), { expiresIn: ttl });
      return { url, expiresAt };
    }
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const token = Buffer.from(`${key}|${exp}|${this.sign(key, exp)}`).toString('base64url');
    return { url: `${apiBaseUrl}/v1/media/${token}`, expiresAt };
  }

  private sign(key: string, exp: number): string {
    return hmacSha256(this.cfg.JWT_ACCESS_SECRET, `media:${key}:${exp}`);
  }

  /** Lecture d'un lien signé (stockage local uniquement). */
  async readSigned(token: string): Promise<Buffer> {
    if (this.cfg.MEDIA_STORAGE !== 'local') throw Errors.notFound('Fichier');
    const [key, expRaw, sig] = Buffer.from(token, 'base64url').toString('utf8').split('|');
    const exp = Number(expRaw);
    if (!key || !sig || !Number.isFinite(exp) || exp < Date.now() / 1000 || !safeEqualHex(sig, this.sign(key, exp))) throw Errors.notFound('Fichier');
    try {
      return await readFile(this.localPath(key));
    } catch {
      throw Errors.notFound('Fichier');
    }
  }
}
