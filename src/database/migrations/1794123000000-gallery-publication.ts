import type { MigrationInterface, QueryRunner } from 'typeorm';
import { galleryReleaseV1 } from '../catalog-gallery-release-v1.js';
export class GalleryPublication1794123000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    if ((await r.query('SELECT version FROM app_schema_version'))[0]?.version !== 24)
      throw Error('Schema 24 required');
    const s = (await r.query('SELECT current_schema() AS s'))[0].s as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(s)) throw Error('Unsupported schema');
    await r.query(galleryReleaseV1('"' + s + '"'));
  }
  async down(r: QueryRunner) {
    for (const table of [
      'catalog_gallery_reviews',
      'catalog_gallery_review_events',
      'catalog_gallery_review_requests',
    ])
      if ((await r.query('SELECT 1 FROM ' + table + ' LIMIT 1')).length)
        throw Error('Cannot discard gallery approval history');
    if ((await r.query("SELECT 1 FROM catalog_releases WHERE snapshot?'gallery' LIMIT 1")).length)
      throw Error('Cannot discard mixed-media releases');
    await r.query(
      'DROP FUNCTION catalog_publication_post(uuid,uuid,uuid,jsonb),catalog_release_eligible(uuid);ALTER FUNCTION catalog_publication_post_v24(uuid,uuid,uuid,jsonb) RENAME TO catalog_publication_post;ALTER FUNCTION catalog_release_eligible_v24(uuid) RENAME TO catalog_release_eligible;DROP FUNCTION catalog_gallery_review_post(uuid,uuid,uuid,jsonb),catalog_gallery_selection(uuid,jsonb);DROP TABLE catalog_gallery_review_requests,catalog_gallery_review_events,catalog_gallery_reviews;UPDATE app_schema_version SET version=24 WHERE singleton;',
    );
  }
}
