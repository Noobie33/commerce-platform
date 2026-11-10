import { GalleryReleaseService } from './gallery-release.service.js';
import type { PublicGalleryItem } from './gallery-release.types.js';
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { MediaStore } from '../../infrastructure/media/local-media.store.js';
import type { PublicationInput, PublicationView } from './publication.types.js';
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
export class PublicationService {
  constructor(
    private readonly db: DataSource,
    private readonly store: MediaStore,
    private readonly gallery: GalleryReleaseService,
  ) {}
  async read(id: string, page: number): Promise<PublicationView> {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const [p] = await m.query('SELECT version FROM catalog_products WHERE id=$1', [id]);
      if (!p) throw new NotFoundException({ code: 'PUBLICATION_NOT_FOUND' });
      const [row] = await m.query(
        'SELECT public.catalog_release_basis($1) AS basis,r.version,r.state,coalesce(public.catalog_release_eligible($1),false) AS effective FROM(SELECT 1)x LEFT JOIN catalog_releases r ON r.product_id=$1',
        [id],
      );
      const galleryReview = await this.gallery.read(id, m);
      const basis = row.basis,
        history = await m.query(
          'SELECT version,kind,action,reason,created_at AS "createdAt" FROM catalog_publication_events WHERE product_id=$1 ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET $2',
          [id, (page - 1) * 20],
        );
      const photos = await m.query(
        `SELECT p.id,coalesce(r.version,0) AS version,coalesce(r.state,'not_reviewed') AS state,coalesce(r.alt,'') AS alt FROM catalog_product_photos p LEFT JOIN catalog_media_reviews r ON r.photo_id=p.id WHERE p.product_id=$1 AND p.is_active ORDER BY p.is_primary DESC,p.created_at,p.id`,
        [id],
      );
      return {
        galleryReview: {
          state: galleryReview.state,
          version: galleryReview.version,
          eligible: galleryReview.eligible,
          itemCount: galleryReview.approvedItems.length,
        },
        productId: id,
        productVersion: p.version,
        contentVersion: basis.contentVersion ?? 0,
        version: row.version ?? 0,
        state: row.state ?? 'never_published',
        effectivePublic: row.effective,
        issues: [
          ...(galleryReview.state === 'approved' && !galleryReview.eligible
            ? [
                'The approved mixed gallery changed. Review it again or revoke it before publishing.',
              ]
            : []),
          ...(!basis.contentReady ? ['Approve the current, complete product content.'] : []),
          ...(!basis.categoryReady ? ['Prepare active category and ancestor URL names.'] : []),
          ...(!basis.mediaReady
            ? ['Approve every active photo with descriptive alternative text and a primary photo.']
            : []),
        ],
        photos: photos.map((x: { id: string }) => ({
          ...x,
          thumbnailUrl: '/api/v1/catalog/photos/' + x.id + '/thumbnail',
        })),
        history: history.slice(0, 20),
        page,
        hasMore: history.length > 20,
      };
    });
  }
  private async files(id: string, expected: string) {
    try {
      const image = await this.store.read(id, 'image'),
        thumbnail = await this.store.read(id, 'thumbnail');
      if (hash(image) !== expected) throw Error('Mismatch');
      return { imageHash: expected, thumbnailHash: hash(thumbnail) };
    } catch {
      throw new ConflictException({
        code: 'PUBLICATION_MEDIA_UNAVAILABLE',
        message:
          'A display image is missing or changed. Restore and verify the media before approval or publication.',
      });
    }
  }
  async post(
    id: string,
    photoId: string | null,
    input: PublicationInput,
    key: string,
    actor: string,
    requestId: string,
  ) {
    let integrity: Record<string, string> = {};
    if (input.action === 'publish') {
      const galleryBasis = await this.gallery.verifyForPublish(id);
      if (galleryBasis) integrity.galleryBasis = galleryBasis;
    }
    if (input.action === 'approve') {
      const [p] = await this.db.query(
        'SELECT content_hash FROM catalog_product_photos WHERE id=$1 AND product_id=$2 AND is_active',
        [photoId, id],
      );
      if (!p) throw new NotFoundException({ code: 'PUBLICATION_NOT_FOUND' });
      integrity = await this.files(photoId!, p.content_hash);
    }
    if (input.action === 'publish') {
      const photos = await this.db.query(
        'SELECT p.id,p.content_hash,r.thumbnail_hash FROM catalog_product_photos p LEFT JOIN catalog_media_reviews r ON r.photo_id=p.id WHERE p.product_id=$1 AND p.is_active',
        [id],
      );
      for (const p of photos) {
        const checked = await this.files(p.id, p.content_hash);
        if (checked.thumbnailHash !== p.thumbnail_hash)
          throw new ConflictException({ code: 'PUBLICATION_MEDIA_UNAVAILABLE' });
      }
    }
    try {
      return (
        await this.db.query(
          'SELECT public.catalog_publication_post($1,$2,$3,$4::jsonb) AS result',
          [
            key,
            actor,
            requestId,
            JSON.stringify({
              ...input,
              productId: id,
              ...(photoId ? { photoId } : {}),
              ...integrity,
            }),
          ],
        )
      )[0].result;
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      if (code === 'PUBLICATION_PERMISSION') throw new ForbiddenException({ code: 'FORBIDDEN' });
      if (code === 'PUBLICATION_NOT_FOUND') throw new NotFoundException({ code });
      if (code === 'PUBLICATION_INVALID') throw new BadRequestException({ code });
      if (
        [
          'PUBLICATION_STALE',
          'PUBLICATION_IDEMPOTENCY',
          'PUBLICATION_INCOMPLETE',
          'PUBLICATION_STATE',
          'PUBLICATION_GALLERY_INCOMPLETE',
        ].includes(code)
      )
        throw new ConflictException({ code });
      throw e;
    }
  }
  async publicProduct(slug: string) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 120) throw new NotFoundException();
    const [r] = await this.db.query(
      "SELECT snapshot,version FROM catalog_releases WHERE snapshot->>'slug'=$1 AND state='published' AND public.catalog_release_eligible(product_id)",
      [slug],
    );
    if (!r) throw new NotFoundException();
    return {
      ...r.snapshot,
      releaseVersion: r.version,
      gallery: this.gallery.gallery(
        slug,
        r.version,
        (r.snapshot.gallery?.items ??
          r.snapshot.photos.map(
            (p: { id: string; alt: string; width: number; height: number; primary: boolean }) => ({
              kind: 'photo',
              id: p.id,
              label: p.alt,
              width: p.width,
              height: p.height,
              primary: p.primary,
            }),
          )) as PublicGalleryItem[],
      ),
      photos: r.snapshot.photos.map((p: { id: string }) => ({
        ...p,
        url: '/api/v1/store/photos/' + p.id + '/image',
        thumbnailUrl: '/api/v1/store/photos/' + p.id + '/thumbnail',
      })),
    };
  }
  async publicPhoto(id: string, size: 'image' | 'thumbnail') {
    const [r] = await this.db.query(
      `SELECT CASE WHEN $2='image' THEN m.image_hash ELSE m.thumbnail_hash END AS hash FROM catalog_media_reviews m JOIN catalog_product_photos p ON p.id=m.photo_id JOIN catalog_releases r ON r.product_id=p.product_id WHERE p.id=$1 AND p.is_active AND m.state='approved' AND public.catalog_release_eligible(r.product_id) AND r.snapshot->'photos' @> jsonb_build_array(jsonb_build_object('id',p.id))`,
      [id, size],
    );
    if (!r) throw new NotFoundException();
    try {
      const bytes = await this.store.read(id, size);
      if (hash(bytes) !== r.hash) throw Error('Mismatch');
      return bytes;
    } catch {
      throw new NotFoundException();
    }
  }
}
