import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { ImageProcessor } from '../../infrastructure/media/image-processor.js';
import type { MediaStore } from '../../infrastructure/media/local-media.store.js';
import { photoLinks } from './media.types.js';
import type { MediaResult, ProductPhoto } from './media.types.js';
type Sql = Pick<EntityManager, 'query'>;
export class ProductMediaService {
  private uploads = 0;
  constructor(
    private readonly source: DataSource,
    private readonly processor: ImageProcessor,
    private readonly store: MediaStore,
  ) {}
  async receive<T>(work: () => Promise<T>): Promise<T> {
    if (this.uploads >= 2)
      throw new ServiceUnavailableException({
        code: 'MEDIA_BUSY',
        message: 'Image processing is busy. Try again shortly.',
      });
    this.uploads++;
    try {
      return await work();
    } finally {
      this.uploads--;
    }
  }
  async photos(id: string, sql: Sql = this.source): Promise<ProductPhoto[]> {
    const rows: Omit<ProductPhoto, 'url' | 'thumbnailUrl'>[] = await sql.query(
      'SELECT id,width,height,is_primary AS "isPrimary" FROM catalog_product_photos WHERE product_id=$1 AND is_active ORDER BY is_primary DESC,created_at,id',
      [id],
    );
    return rows.map(photoLinks);
  }
  private fingerprint(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
  private async cached(
    sql: Sql,
    key: string,
    actor: string,
    hash: string,
  ): Promise<MediaResult | null> {
    const rows: { actorId: string; hash: string; response: MediaResult }[] = await sql.query(
      'SELECT actor_id AS "actorId",request_hash AS hash,response FROM catalog_media_requests WHERE key=$1',
      [key],
    );
    if (!rows[0]) return null;
    if (rows[0].actorId !== actor || rows[0].hash !== hash)
      throw new ConflictException({ code: 'IDEMPOTENCY_MISMATCH' });
    return rows[0].response;
  }
  private async productLock(sql: Sql, id: string, version: number) {
    const rows: { version: number }[] = await sql.query(
      'SELECT version FROM catalog_products WHERE id=$1 FOR UPDATE',
      [id],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND' });
    if (rows[0].version !== version) throw new ConflictException({ code: 'STALE_PRODUCT' });
  }
  private async finish(
    sql: Sql,
    id: string,
    photoId: string,
    actor: string,
    requestId: string,
    key: string,
    hash: string,
    action: string,
    before: ProductPhoto[],
  ): Promise<MediaResult> {
    await sql.query('UPDATE catalog_products SET version=version+1,updated_at=now() WHERE id=$1', [
      id,
    ]);
    const rows: { version: number }[] = await sql.query(
      'SELECT version FROM catalog_products WHERE id=$1',
      [id],
    );
    const photos = await this.photos(id, sql),
      version = rows[0]!.version;
    const metadata = {
      productId: id,
      photoId,
      version,
      beforePrimaryId: before.find((p) => p.isPrimary)?.id ?? null,
      afterPrimaryId: photos.find((p) => p.isPrimary)?.id ?? null,
      photoCount: photos.length,
    };
    await sql.query(
      'INSERT INTO audit_events(actor_id,action,request_id,metadata) VALUES ($1,$2,$3,$4::jsonb)',
      [actor, action, requestId, JSON.stringify(metadata)],
    );
    const result = { productId: id, version, photos };
    await sql.query(
      'INSERT INTO catalog_media_requests(key,actor_id,product_id,request_hash,response) VALUES ($1,$2,$3,$4,$5::jsonb)',
      [key, actor, id, hash, JSON.stringify(result)],
    );
    return result;
  }
  async upload(
    id: string,
    version: number,
    key: string,
    actor: string,
    requestId: string,
    body: Buffer,
    type: string,
  ): Promise<MediaResult> {
    const hash = this.fingerprint({
      operation: 'upload',
      id,
      version,
      type,
      content: createHash('sha256').update(body).digest('hex'),
    });
    const cached = await this.cached(this.source, key, actor, hash);
    if (cached) return cached;
    const processed = await this.processor.process(body, type),
      photoId = randomUUID();
    let keep = false,
      stored = false;
    try {
      await this.store.put(photoId, processed);
      stored = true;
      const result = await this.source.transaction(async (sql) => {
        await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,2))', [key]);
        const cached = await this.cached(sql, key, actor, hash);
        if (cached) return cached;
        await this.productLock(sql, id, version);
        const before = await this.photos(id, sql);
        if (before.length >= 8)
          throw new ConflictException({
            code: 'PHOTO_LIMIT',
            message: 'A product supports up to eight photos.',
          });
        await sql.query(
          'INSERT INTO catalog_product_photos(id,product_id,width,height,byte_size,content_hash,is_primary) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [
            photoId,
            id,
            processed.width,
            processed.height,
            processed.image.length,
            createHash('sha256').update(processed.image).digest('hex'),
            before.length === 0,
          ],
        );
        return this.finish(
          sql,
          id,
          photoId,
          actor,
          requestId,
          key,
          hash,
          'catalog.photo_uploaded',
          before,
        );
      });
      keep = result.photos.some((photo) => photo.id === photoId);
      return result;
    } finally {
      if (stored && !keep) {
        // A lost COMMIT acknowledgement is ambiguous: preserve files if the row exists or the database cannot be checked.
        let referenced = true;
        try {
          referenced =
            (
              await this.source.query('SELECT id FROM catalog_product_photos WHERE id=$1', [
                photoId,
              ])
            ).length > 0;
        } catch {}
        if (!referenced) await this.store.discard(photoId);
      }
    }
  }
  async mutate(
    operation: 'primary' | 'remove',
    id: string,
    photoId: string,
    version: number,
    key: string,
    actor: string,
    requestId: string,
  ): Promise<MediaResult> {
    const hash = this.fingerprint({ operation, id, photoId, version });
    return this.source.transaction(async (sql) => {
      await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,2))', [key]);
      const cached = await this.cached(sql, key, actor, hash);
      if (cached) return cached;
      await this.productLock(sql, id, version);
      const before = await this.photos(id, sql),
        target = before.find((p) => p.id === photoId);
      if (!target) throw new NotFoundException({ code: 'PHOTO_NOT_FOUND' });
      if (operation === 'primary') {
        await sql.query(
          'UPDATE catalog_product_photos SET is_primary=false WHERE product_id=$1 AND is_active',
          [id],
        );
        await sql.query('UPDATE catalog_product_photos SET is_primary=true WHERE id=$1', [photoId]);
      } else {
        await sql.query(
          'UPDATE catalog_product_photos SET is_active=false,is_primary=false WHERE id=$1',
          [photoId],
        );
        if (target.isPrimary) {
          const next = before.find((p) => p.id !== photoId);
          if (next)
            await sql.query('UPDATE catalog_product_photos SET is_primary=true WHERE id=$1', [
              next.id,
            ]);
        }
      }
      return this.finish(
        sql,
        id,
        photoId,
        actor,
        requestId,
        key,
        hash,
        operation === 'primary' ? 'catalog.photo_primary_changed' : 'catalog.photo_removed',
        before,
      );
    });
  }
  async read(photoId: string, size: 'image' | 'thumbnail'): Promise<Buffer> {
    const rows: { id: string }[] = await this.source.query(
      'SELECT id FROM catalog_product_photos WHERE id=$1 AND is_active',
      [photoId],
    );
    if (!rows.length) throw new NotFoundException({ code: 'PHOTO_NOT_FOUND' });
    try {
      return await this.store.read(photoId, size);
    } catch {
      throw new ServiceUnavailableException('Product image is temporarily unavailable');
    }
  }
}
