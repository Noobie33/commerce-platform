import { APPLICATION_SCHEMA_VERSION } from '../../database/schema-version.js';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { VideoProcessor } from '../../infrastructure/media/video-processor.js';
import { VideoArtifactStore } from '../../infrastructure/media/video-artifact.store.js';
import {
  VideoIntakeStore,
  localVideoEnabled,
  syncVideoDirectory,
  syncVideoFile,
} from '../../infrastructure/media/video-intake.store.js';
import { privateVideoRoot, contained } from '../../infrastructure/media/video-workspace.js';
import { readVideoTools, readVideoPolicy } from '../../infrastructure/media/video-policy.js';
import { databaseUrl } from '../../infrastructure/database/data-source.js';
export function videoWorkerSource(env: NodeJS.ProcessEnv) {
  if (!localVideoEnabled(env)) throw Error('Local development worker configuration required');
  const url = databaseUrl({ ...env, DATABASE_URL: env.VIDEO_WORKER_DATABASE_URL }, 'DATABASE_URL'),
    u = new URL(url),
    mode =
      u.pathname === '/commerce_platform_test'
        ? 'test'
        : u.pathname === '/commerce_platform_dev'
          ? 'dev'
          : null;
  if (!mode || u.username !== 'commerce_' + mode + '_video_worker')
    throw Error('Restricted video worker login required');
  return new DataSource({
    type: 'postgres',
    url,
    entities: [],
    synchronize: false,
    logging: false,
    connectTimeoutMS: 5000,
    extra: { max: 2, statement_timeout: 5000, query_timeout: 6000 },
  });
}
export async function assertVideoWorker(db: DataSource) {
  const [r] = await db.query(
    "SELECT (SELECT version FROM app_schema_version) AS version,rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls AS elevated,has_table_privilege(current_user,'staff_users','SELECT') AS staff_read,has_table_privilege(current_user,'catalog_product_videos','UPDATE') AS direct_write FROM pg_roles WHERE rolname=current_user",
  );
  if (r.version !== APPLICATION_SCHEMA_VERSION || r.elevated || r.staff_read || r.direct_write)
    throw Error('Worker must have only scoped video-job privileges');
}
export class VideoWorker {
  constructor(
    private readonly db: DataSource,
    private readonly env: NodeJS.ProcessEnv,
  ) {}
  async once(signal?: AbortSignal) {
    const token = randomUUID(),
      [claimed] = await this.db.query('SELECT public.catalog_video_claim($1,$2) AS job', [
        token,
        randomUUID(),
      ]),
      job = claimed.job as {
        id: string;
        sourceType: string;
        sourceHash: string;
        sourceBytes: number;
      } | null;
    if (!job) return false;
    const abort = new AbortController(),
      cancel = () => abort.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) abort.abort();
    let lost = false,
      beating = false;
    const heartbeat = setInterval(() => {
      if (beating) return;
      beating = true;
      void this.db
        .query('SELECT public.catalog_video_heartbeat($1,$2) AS active', [job.id, token])
        .then(([r]) => {
          if (!r.active) {
            lost = true;
            abort.abort();
          }
        })
        .catch(() => {
          lost = true;
          abort.abort();
        })
        .finally(() => {
          beating = false;
        });
    }, 10000);
    heartbeat.unref();
    let root = '',
      dir = '',
      created = false;
    try {
      const tools = readVideoTools(this.env);
      root = await privateVideoRoot(tools.artifactRoot);
      dir = join(root, token);
      const source = await new VideoIntakeStore(this.env.VIDEO_QUARANTINE_DIR!).read(
        job.id,
        job.sourceHash,
        readVideoPolicy(this.env).maxSourceBytes,
      );
      if (source.length !== Number(job.sourceBytes)) throw Error('Source length mismatch');
      const prepared = await new VideoProcessor(tools, readVideoPolicy(this.env)).process(
        source,
        job.sourceType,
        abort.signal,
      );
      if (lost || abort.signal.aborted) throw Error('Worker lease lost');
      await new VideoArtifactStore(tools.artifactRoot).put(token, prepared);
      created = true;
      for (const name of ['original.bin', 'playback.mp4', 'poster.webp', 'manifest.json'])
        await syncVideoFile(join(dir, name));
      await syncVideoDirectory(dir);
      await syncVideoDirectory(root);
      if (lost || abort.signal.aborted) throw Error('Worker lease lost');
      const data = {
        originalHash: prepared.originalHash,
        playbackHash: prepared.playbackHash,
        posterHash: prepared.posterHash,
        width: prepared.playbackMetadata.width,
        height: prepared.playbackMetadata.height,
        durationSeconds: prepared.playbackMetadata.durationSeconds,
        hasAudio: prepared.playbackMetadata.hasAudio,
        posterWidth: prepared.posterWidth,
        posterHeight: prepared.posterHeight,
        playbackBytes: prepared.playback.length,
        posterBytes: prepared.poster.length,
      };
      await this.db.query('SELECT public.catalog_video_finish($1,$2,$3,$4::jsonb,NULL) AS saved', [
        job.id,
        token,
        randomUUID(),
        JSON.stringify(data),
      ]);
    } catch (e) {
      if (!lost) {
        const status =
          e && typeof e === 'object' && 'getStatus' in e
            ? (e as { getStatus: () => number }).getStatus()
            : 0;
        try {
          await this.db.query('SELECT public.catalog_video_finish($1,$2,$3,NULL,$4) AS saved', [
            job.id,
            token,
            randomUUID(),
            status === 422 && !abort.signal.aborted
              ? 'invalid_video'
              : status === 503
                ? 'tools_unavailable'
                : 'processing_failed',
          ]);
        } catch {
          /* Lease recovery handles an uncertain database result. */
        }
      }
    } finally {
      clearInterval(heartbeat);
      signal?.removeEventListener('abort', cancel);
      if (created) {
        try {
          const [r] = await this.db.query(
            'SELECT EXISTS(SELECT 1 FROM public.catalog_video_storage_refs() WHERE artifact_id=$1) AS referenced',
            [token],
          );
          if (!r.referenced) {
            if (!contained(root, dir)) throw Error('Unsafe artifact cleanup');
            await rm(dir, { recursive: true, force: true });
          }
        } catch {
          /* Preserve uncertain artifacts for reference-aware reconciliation. */
        }
      }
    }
    return true;
  }
  async reconcile() {
    const refs = await this.db.query('SELECT * FROM public.catalog_video_storage_refs()'),
      sourceIds = new Set<string>(refs.map((r: { id: string }) => r.id)),
      artifactIds = new Set(
        refs.map((r: { artifact_id: string | null }) => r.artifact_id).filter(Boolean),
      );
    const source = await new VideoIntakeStore(this.env.VIDEO_QUARANTINE_DIR!).ids(),
      root = await privateVideoRoot(readVideoTools(this.env).artifactRoot),
      artifacts = (await readdir(root, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && /^[a-f0-9-]{36}$/.test(d.name))
        .map((d) => d.name);
    return {
      mode: 'report_only',
      referencedSources: sourceIds.size,
      referencedArtifacts: artifactIds.size,
      missingSources: [...sourceIds].filter((id) => !source.includes(id)).length,
      missingArtifacts: [...artifactIds].filter((id) => !artifacts.includes(id as string)).length,
      unreferencedSources: source.filter((id) => !sourceIds.has(id)).length,
      unreferencedArtifacts: artifacts.filter((id) => !artifactIds.has(id)).length,
    };
  }
}
