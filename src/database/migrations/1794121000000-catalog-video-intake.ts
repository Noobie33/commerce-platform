import type { MigrationInterface, QueryRunner } from 'typeorm';
import { catalogVideoV1 } from '../catalog-video-v1.js';
export class CatalogVideoIntake1794121000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    if ((await r.query('SELECT version FROM app_schema_version'))[0]?.version !== 22)
      throw Error('Schema 22 required');
    const s = (await r.query('SELECT current_schema() AS s'))[0].s as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(s)) throw Error('Unsupported schema');
    await r.query(catalogVideoV1('"' + s + '"'));
  }
  async down(r: QueryRunner) {
    for (const t of ['catalog_product_videos', 'catalog_video_events', 'catalog_video_requests'])
      if ((await r.query('SELECT 1 FROM ' + t + ' LIMIT 1')).length)
        throw Error('Cannot discard video sources, jobs or retained history');
    await r.query(
      'DROP FUNCTION catalog_video_storage_refs(),catalog_video_finish(uuid,uuid,uuid,jsonb,text),catalog_video_heartbeat(uuid,uuid),catalog_video_claim(uuid,uuid),catalog_video_post(uuid,uuid,uuid,jsonb),catalog_video_log(uuid,uuid,uuid,text,text);DROP TABLE catalog_video_requests,catalog_video_events,catalog_product_videos,catalog_video_policy;UPDATE app_schema_version SET version=22 WHERE singleton;',
    );
  }
}
