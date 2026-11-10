import type { MigrationInterface, QueryRunner } from 'typeorm';
import { catalogGalleryV1 } from '../catalog-gallery-v1.js';
export class CatalogGalleryDrafts1794122000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    if ((await r.query('SELECT version FROM app_schema_version'))[0]?.version !== 23)
      throw Error('Schema 23 required');
    const s = (await r.query('SELECT current_schema() AS s'))[0].s as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(s)) throw Error('Unsupported schema');
    await r.query(catalogGalleryV1('"' + s + '"'));
  }
  async down(r: QueryRunner) {
    for (const t of [
      'catalog_gallery_drafts',
      'catalog_gallery_events',
      'catalog_gallery_requests',
    ])
      if ((await r.query('SELECT 1 FROM ' + t + ' LIMIT 1')).length)
        throw Error('Cannot discard gallery drafts or retained history');
    await r.query(
      'DROP FUNCTION catalog_gallery_post(uuid,uuid,uuid,jsonb),catalog_gallery_basis(uuid);DROP TABLE catalog_gallery_requests,catalog_gallery_events,catalog_gallery_drafts;UPDATE app_schema_version SET version=23 WHERE singleton;',
    );
  }
}
