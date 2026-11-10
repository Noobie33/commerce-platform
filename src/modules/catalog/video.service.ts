import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import {
  VideoIntakeStore,
  localVideoEnabled,
  readPreparedVideo,
} from '../../infrastructure/media/video-intake.store.js';
import { readVideoPolicy } from '../../infrastructure/media/video-policy.js';
import type { StaffRequest, StaffResponse } from '../identity/http.types.js';
export class CatalogVideoService {
  private receiving = 0;
  private downloads = 0;
  constructor(
    private readonly db: DataSource,
    private readonly env: NodeJS.ProcessEnv,
  ) {}
  get enabled() {
    return (
      localVideoEnabled(this.env) &&
      !!this.env.VIDEO_QUARANTINE_DIR &&
      !!this.env.VIDEO_ARTIFACT_DIR
    );
  }
  async list(pid: string, page: number, removed: boolean) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const [p] = await m.query('SELECT version FROM catalog_products WHERE id=$1', [pid]);
      if (!p) throw new NotFoundException();
      const items = await m.query(
        `SELECT id,version,state,attempts,description,variant_id AS "variantId",position,review_state AS "reviewState",error_code AS "errorCode",source_bytes::text AS "sourceBytes",source_type AS "sourceType",manifest->'width' AS width,manifest->'height' AS height,manifest->'durationSeconds' AS "durationSeconds",manifest->'hasAudio' AS "hasAudio",created_at AS "createdAt" FROM catalog_product_videos WHERE product_id=$1 AND ($2 OR state<>'removed') ORDER BY position,created_at,id LIMIT 20 OFFSET $3`,
        [pid, removed, (page - 1) * 20],
      );
      const total = (
        await m.query(
          "SELECT count(*)::int AS n FROM catalog_product_videos WHERE product_id=$1 AND ($2 OR state<>'removed')",
          [pid, removed],
        )
      )[0].n;
      return {
        enabled: this.enabled,
        productVersion: p.version,
        items,
        total,
        page,
        pageSize: 20,
        policy: {
          ...(
            await m.query(
              'SELECT max_per_product AS "maxPerProduct",max_pending AS "maxPending" FROM catalog_video_policy',
            )
          )[0],
          maxSourceBytes: readVideoPolicy(this.env).maxSourceBytes,
          maxDurationSeconds: readVideoPolicy(this.env).maxDurationSeconds,
        },
      };
    });
  }
  async history(id: string, page: number) {
    const rows = await this.db.query(
      'SELECT e.version,e.action,e.reason,e.snapshot,e.created_at AS "createdAt",u.display_name AS "actorName" FROM catalog_video_events e JOIN staff_users u ON u.id=e.actor_id WHERE e.video_id=$1 ORDER BY e.version DESC LIMIT 21 OFFSET $2',
      [id, (page - 1) * 20],
    );
    return { items: rows.slice(0, 20), page, hasMore: rows.length > 20 };
  }
  private error(e: unknown): never {
    const c = e instanceof Error ? e.message : '';
    if (c === 'VIDEO_PERMISSION') throw new ForbiddenException({ code: c });
    if (c === 'VIDEO_NOT_FOUND') throw new NotFoundException({ code: c });
    if (c === 'VIDEO_INVALID') throw new BadRequestException({ code: c });
    if (['VIDEO_STALE', 'VIDEO_STATE', 'VIDEO_IDEMPOTENCY', 'VIDEO_LIMIT'].includes(c))
      throw new ConflictException({ code: c });
    throw e;
  }
  async upload(
    pid: string,
    version: number,
    key: string,
    actor: string,
    req: StaffRequest,
    res: StaffResponse,
  ) {
    if (!this.enabled) throw new ServiceUnavailableException({ code: 'VIDEO_INTAKE_DISABLED' });
    if (this.receiving >= 2) throw new ServiceUnavailableException({ code: 'VIDEO_BUSY' });
    this.receiving++;
    const store = new VideoIntakeStore(this.env.VIDEO_QUARANTINE_DIR!);
    let source: { id: string; bytes: number; hash: string } | undefined,
      discard = false;
    try {
      source = await store.receive(req, res, readVideoPolicy(this.env).maxSourceBytes);
      const [r] = await this.db.query(
        'SELECT public.catalog_video_post($1,$2,$3,$4::jsonb) AS result',
        [
          key,
          actor,
          req.requestId,
          JSON.stringify({
            action: 'upload',
            id: source.id,
            productId: pid,
            expectedProductVersion: version,
            sourceType: req.headers['content-type']!.split(';')[0]!.trim().toLowerCase(),
            sourceHash: source.hash,
            sourceBytes: source.bytes,
          }),
        ],
      );
      discard = r.result.id !== source.id;
      return r.result;
    } catch (e) {
      if (source) {
        try {
          discard = !(
            await this.db.query('SELECT 1 FROM catalog_product_videos WHERE id=$1', [source.id])
          ).length;
        } catch {
          discard = false;
        }
      }
      this.error(e);
    } finally {
      try {
        if (source && discard) await store.discard(source.id);
      } finally {
        this.receiving--;
      }
    }
  }
  async action(id: string, b: Record<string, unknown>, key: string, actor: string, req: string) {
    let verified = {};
    if (b.action === 'approve') {
      const [v] = await this.db.query(
        "SELECT artifact_id,manifest FROM catalog_product_videos WHERE id=$1 AND state='ready'",
        [id],
      );
      if (!v) throw new ConflictException({ code: 'VIDEO_STATE' });
      try {
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
      } catch {
        throw new ConflictException({ code: 'VIDEO_FILES_UNAVAILABLE' });
      }
      verified = {
        verifiedPlaybackHash: v.manifest.playbackHash,
        verifiedPosterHash: v.manifest.posterHash,
      };
    }
    try {
      return (
        await this.db.query('SELECT public.catalog_video_post($1,$2,$3,$4::jsonb) AS result', [
          key,
          actor,
          req,
          JSON.stringify({ ...b, id, ...verified }),
        ])
      )[0].result;
    } catch (e) {
      this.error(e);
    }
  }
  async file(
    id: string,
    size: 'playback' | 'poster' | 'original',
    res: { once: (event: string, listener: () => void) => unknown },
  ) {
    if (this.downloads >= 2) throw new ServiceUnavailableException({ code: 'VIDEO_BUSY' });
    this.downloads++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        this.downloads--;
      }
    };
    res.once('finish', release);
    res.once('close', release);
    try {
      const [v] = await this.db.query(
        "SELECT state,artifact_id,manifest,source_hash,source_bytes::text,source_type FROM catalog_product_videos WHERE id=$1 AND state<>'removed'",
        [id],
      );
      if (!v) throw new NotFoundException();
      if (size === 'original') {
        const bytes = v.artifact_id
          ? await readPreparedVideo(
              this.env.VIDEO_ARTIFACT_DIR!,
              v.artifact_id,
              'original',
              v.source_hash,
              209715200,
            )
          : await new VideoIntakeStore(this.env.VIDEO_QUARANTINE_DIR!).read(id, v.source_hash);
        return {
          bytes,
          type: 'application/octet-stream',
          extension: v.source_type === 'video/quicktime' ? 'mov' : 'mp4',
        };
      }
      if (v.state !== 'ready') throw new NotFoundException();
      const bytes = await readPreparedVideo(
        this.env.VIDEO_ARTIFACT_DIR!,
        v.artifact_id,
        size,
        size === 'poster' ? v.manifest.posterHash : v.manifest.playbackHash,
        size === 'poster' ? 1048576 : 83886080,
      );
      return {
        bytes,
        type: size === 'poster' ? 'image/webp' : 'video/mp4',
        extension: size === 'poster' ? 'webp' : 'mp4',
      };
    } catch {
      release();
      throw new NotFoundException();
    }
  }
}
