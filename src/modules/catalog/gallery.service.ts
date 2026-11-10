import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { GalleryAsset, GalleryInput, GalleryItem, GalleryView } from './gallery.types.js';
interface GalleryBasis {
  productVersion: number;
  photos: {
    id: string;
    width: number;
    height: number;
    primary: boolean;
    alt: string;
    reviewState: string;
    hash: string;
    imageHash: string | null;
  }[];
  videos: {
    id: string;
    state: string;
    description: string;
    variantId: string | null;
    variantSku: string | null;
    variantActive: boolean;
    reviewState: string;
    manifest: { width: number; height: number; hasAudio: boolean; durationSeconds: number } | null;
  }[];
}
export function galleryIssues(items: GalleryItem[], assets: GalleryAsset[]) {
  const issues: string[] = [];
  const selected = items.map((x) => assets.find((a) => a.id === x.id && a.kind === x.kind));
  if (!selected.length)
    issues.push('Choose a primary product photo before preparing a website gallery.');
  if (selected.length && (!selected[0] || selected[0].kind !== 'photo' || !selected[0].primary))
    issues.push('Place the current primary product photo first.');
  for (let i = 0; i < selected.length; i++) {
    const a = selected[i],
      label = 'Item ' + (i + 1) + ': ';
    if (!a || !a.selectable) {
      issues.push(label + 'media is unavailable; remove it or restore the product media.');
      continue;
    }
    if (a.reviewState !== 'approved') issues.push(label + 'complete its separate media review.');
    if (!a.label.trim()) issues.push(label + 'add a descriptive label or alternative text.');
    if (a.kind === 'video' && a.hasAudio)
      issues.push(label + 'audio needs a captions/transcript policy before public release.');
  }
  return issues;
}
export class GalleryService {
  constructor(private readonly db: DataSource) {}
  async read(id: string, page: number): Promise<GalleryView> {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const [row] = await m.query(
        "SELECT b AS basis,encode(sha256(convert_to(b::text,'UTF8')),'hex') AS hash FROM public.catalog_gallery_basis($1) b",
        [id],
      );
      if (!row?.basis) throw new NotFoundException({ code: 'GALLERY_NOT_FOUND' });
      const b = row.basis as GalleryBasis;
      const [draft] = await m.query(
        'SELECT version,items FROM catalog_gallery_drafts WHERE product_id=$1',
        [id],
      );
      const assets: GalleryAsset[] = [
        ...b.photos.map((p) => ({
          kind: 'photo' as const,
          id: p.id,
          label: p.alt,
          width: p.width,
          height: p.height,
          primary: p.primary,
          selectable: true,
          state: 'ready',
          reviewState:
            p.reviewState === 'approved' && p.imageHash !== p.hash ? 'changed' : p.reviewState,
          variantId: null,
          variantSku: null,
          hasAudio: false,
          durationSeconds: null,
          url: '/api/v1/catalog/photos/' + p.id + '/image',
          thumbnailUrl: '/api/v1/catalog/photos/' + p.id + '/thumbnail',
        })),
        ...b.videos.map((v) => ({
          kind: 'video' as const,
          id: v.id,
          label: v.description,
          width: v.manifest?.width ?? null,
          height: v.manifest?.height ?? null,
          primary: false,
          selectable: v.state === 'ready' && (!v.variantId || v.variantActive),
          state: v.state,
          reviewState: v.reviewState,
          variantId: v.variantId,
          variantSku: v.variantSku,
          hasAudio: v.manifest?.hasAudio ?? false,
          durationSeconds: v.manifest?.durationSeconds ?? null,
          url: v.state === 'ready' ? '/api/v1/catalog/videos/' + v.id + '/playback' : null,
          thumbnailUrl: v.state === 'ready' ? '/api/v1/catalog/videos/' + v.id + '/poster' : null,
        })),
      ];
      const items: GalleryItem[] = draft?.items ?? [];
      const history = await m.query(
        'SELECT e.version,e.reason,e.items,e.created_at AS "createdAt",u.display_name AS "actorName" FROM catalog_gallery_events e JOIN staff_users u ON u.id=e.actor_id WHERE e.product_id=$1 ORDER BY e.version DESC LIMIT 21 OFFSET $2',
        [id, (page - 1) * 20],
      );
      return {
        productId: id,
        productVersion: b.productVersion,
        version: draft?.version ?? 0,
        basis: row.hash,
        items,
        assets,
        issues: galleryIssues(items, assets),
        history: history.slice(0, 20),
        page,
        hasMore: history.length > 20,
      };
    });
  }
  async save(id: string, b: GalleryInput, key: string, actor: string, req: string) {
    try {
      return (
        await this.db.query('SELECT public.catalog_gallery_post($1,$2,$3,$4::jsonb) AS result', [
          key,
          actor,
          req,
          JSON.stringify({ ...b, productId: id }),
        ])
      )[0].result;
    } catch (e) {
      const c = e instanceof Error ? e.message : '';
      if (c === 'GALLERY_PERMISSION') throw new ForbiddenException({ code: c });
      if (c === 'GALLERY_INVALID') throw new BadRequestException({ code: c });
      if (c === 'GALLERY_NOT_FOUND') throw new NotFoundException({ code: c });
      if (['GALLERY_STALE', 'GALLERY_MEDIA_CHANGED', 'GALLERY_IDEMPOTENCY'].includes(c))
        throw new ConflictException({ code: c });
      throw e;
    }
  }
}
