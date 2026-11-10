import {
  ConflictException,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type { MediaStore } from '../../infrastructure/media/local-media.store.js';
import {
  localVideoEnabled,
  readPreparedVideo,
} from '../../infrastructure/media/video-intake.store.js';
import type {
  GalleryReviewInput,
  GalleryReviewView,
  PublicGalleryItem,
} from './gallery-release.types.js';
type Sql = Pick<EntityManager, 'query'>;
type Selection = { ready: boolean; basis: string; media: PublicGalleryItem[] };
export class GalleryReleaseService {
  private downloads = 0;
  constructor(
    private readonly db: DataSource,
    private readonly env: NodeJS.ProcessEnv,
    private readonly photos: MediaStore,
  ) {}
  async read(id: string, sql: Sql = this.db): Promise<GalleryReviewView> {
    const [d] = await sql.query(
        'SELECT version,items FROM catalog_gallery_drafts WHERE product_id=$1',
        [id],
      ),
      [r] = await sql.query(
        'SELECT version,state,draft_version,items,basis_hash,snapshot FROM catalog_gallery_reviews WHERE product_id=$1',
        [id],
      );
    const [current] = await sql.query(
        'SELECT public.catalog_gallery_selection($1,$2::jsonb) AS value',
        [id, JSON.stringify(d?.items ?? [])],
      ),
      selection = current.value as Selection;
    let eligible = false;
    if (r?.state === 'approved') {
      const [saved] = await sql.query(
        'SELECT public.catalog_gallery_selection($1,$2::jsonb) AS value',
        [id, JSON.stringify(r.items)],
      );
      eligible = saved.value.ready && saved.value.basis === r.basis_hash;
    }
    const history = await sql.query(
      'SELECT e.version,e.action,e.reason,e.created_at AS "createdAt",u.display_name AS "actorName" FROM catalog_gallery_review_events e JOIN staff_users u ON u.id=e.actor_id WHERE e.product_id=$1 ORDER BY e.version DESC LIMIT 20',
      [id],
    );
    return {
      version: r?.version ?? 0,
      state: r?.state ?? 'not_reviewed',
      sourceDraftVersion: r?.draft_version ?? null,
      matchesDraft: !!r && r.draft_version === d?.version && r.basis_hash === selection.basis,
      eligible,
      currentDraftVersion: d?.version ?? 0,
      currentBasis: selection.basis,
      currentReady: selection.ready,
      approvedItems: r?.snapshot ?? [],
      history,
    };
  }
  private async files(id: string, mode: 'draft' | 'review') {
    const [row] = await this.db.query(
      'SELECT items FROM ' +
        (mode === 'draft' ? 'catalog_gallery_drafts' : 'catalog_gallery_reviews') +
        ' WHERE product_id=$1',
      [id],
    );
    if (!row) throw new ConflictException({ code: 'GALLERY_REVIEW_INCOMPLETE' });
    const [r] = await this.db.query(
        'SELECT public.catalog_gallery_selection($1,$2::jsonb) AS value',
        [id, JSON.stringify(row.items)],
      ),
      selection = r.value as Selection;
    if (!selection.ready) throw new ConflictException({ code: 'GALLERY_REVIEW_INCOMPLETE' });
    try {
      for (const item of selection.media) {
        if (item.kind === 'photo') {
          const [p] = await this.db.query(
            'SELECT p.content_hash,r.thumbnail_hash FROM catalog_product_photos p JOIN catalog_media_reviews r ON r.photo_id=p.id WHERE p.id=$1 AND p.product_id=$2 AND p.is_active',
            [item.id, id],
          );
          if (!p) throw Error('Missing photo');
          for (const size of ['image', 'thumbnail'] as const) {
            const bytes = await this.photos.read(item.id, size),
              expected = size === 'image' ? p.content_hash : p.thumbnail_hash;
            if (createHash('sha256').update(bytes).digest('hex') !== expected)
              throw Error('Changed photo');
          }
        } else {
          const [v] = await this.db.query(
            "SELECT artifact_id,manifest FROM catalog_product_videos WHERE id=$1 AND product_id=$2 AND state='ready'",
            [item.id, id],
          );
          if (!v) throw Error('Missing video');
          await readPreparedVideo(
            this.env.VIDEO_ARTIFACT_DIR!,
            v.artifact_id,
            'playback',
            v.manifest.playbackHash,
            83886080,
          );
          await readPreparedVideo(
            this.env.VIDEO_ARTIFACT_DIR!,
            v.artifact_id,
            'poster',
            v.manifest.posterHash,
            1048576,
          );
        }
      }
    } catch {
      throw new ConflictException({ code: 'GALLERY_REVIEW_FILES' });
    }
    return selection.basis;
  }
  async verifyForPublish(id: string) {
    const [r] = await this.db.query(
      "SELECT basis_hash FROM catalog_gallery_reviews WHERE product_id=$1 AND state='approved'",
      [id],
    );
    if (!r) return undefined;
    const basis = await this.files(id, 'review');
    if (basis !== r.basis_hash)
      throw new ConflictException({ code: 'PUBLICATION_GALLERY_INCOMPLETE' });
    return basis;
  }
  async post(id: string, b: GalleryReviewInput, key: string, actor: string, req: string) {
    let verifiedBasis: string | undefined;
    if (b.action === 'approve') {
      const cached = await this.db.query(
        'SELECT 1 FROM catalog_gallery_review_requests WHERE key=$1',
        [key],
      );
      if (!cached.length) verifiedBasis = await this.files(id, 'draft');
    }
    try {
      return (
        await this.db.query(
          'SELECT public.catalog_gallery_review_post($1,$2,$3,$4::jsonb) AS result',
          [
            key,
            actor,
            req,
            JSON.stringify({ ...b, productId: id, ...(verifiedBasis ? { verifiedBasis } : {}) }),
          ],
        )
      )[0].result;
    } catch (e) {
      const c = e instanceof Error ? e.message : '';
      if (c === 'GALLERY_REVIEW_PERMISSION') throw new ForbiddenException({ code: c });
      if (c === 'GALLERY_REVIEW_NOT_FOUND') throw new NotFoundException({ code: c });
      if (c === 'GALLERY_REVIEW_INVALID') throw new BadRequestException({ code: c });
      if (
        [
          'GALLERY_REVIEW_INCOMPLETE',
          'GALLERY_REVIEW_STALE',
          'GALLERY_REVIEW_IDEMPOTENCY',
          'GALLERY_REVIEW_STATE',
        ].includes(c)
      )
        throw new ConflictException({ code: c });
      throw e;
    }
  }
  gallery(slug: string, version: number, items: PublicGalleryItem[]) {
    return items.map((item) => ({
      ...item,
      ...(item.kind === 'photo'
        ? {
            url: '/api/v1/store/photos/' + item.id + '/image',
            thumbnailUrl: '/api/v1/store/photos/' + item.id + '/thumbnail',
          }
        : {
            url:
              '/api/v1/store/products/' + slug + '/media/' + version + '/' + item.id + '/playback',
            thumbnailUrl:
              '/api/v1/store/products/' + slug + '/media/' + version + '/' + item.id + '/poster',
          }),
    }));
  }
  private async publicRecord(slug: string, version: number, id: string) {
    const [r] = await this.db.query(
      "SELECT v.artifact_id,v.manifest FROM catalog_releases r JOIN catalog_product_videos v ON v.product_id=r.product_id WHERE r.snapshot->>'slug'=$1 AND r.version=$2 AND r.state='published' AND public.catalog_release_eligible(r.product_id) AND v.id=$3 AND v.state='ready' AND r.snapshot->'gallery'->'items' @> jsonb_build_array(jsonb_build_object('kind','video','id',$3::text))",
      [slug, version, id],
    );
    return r;
  }
  async publicVideo(
    slug: string,
    version: number,
    id: string,
    size: 'playback' | 'poster',
    res: { once: (name: string, fn: () => void) => unknown },
  ) {
    if (!localVideoEnabled(this.env) || !this.env.VIDEO_ARTIFACT_DIR) throw new NotFoundException();
    if (this.downloads >= 2) throw new ServiceUnavailableException({ code: 'VIDEO_BUSY' });
    this.downloads++;
    let done = false;
    const release = () => {
      if (!done) {
        done = true;
        this.downloads--;
      }
    };
    res.once('finish', release);
    res.once('close', release);
    try {
      const r = await this.publicRecord(slug, version, id);
      if (!r) throw Error('No eligible video');
      const bytes = await readPreparedVideo(
        this.env.VIDEO_ARTIFACT_DIR,
        r.artifact_id,
        size,
        size === 'poster' ? r.manifest.posterHash : r.manifest.playbackHash,
        size === 'poster' ? 1048576 : 83886080,
      );
      if (!(await this.publicRecord(slug, version, id))) throw Error('Release withdrawn');
      return bytes;
    } catch {
      release();
      throw new NotFoundException();
    }
  }
}
