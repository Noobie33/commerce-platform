import type { MigrationInterface, QueryRunner } from 'typeorm';
import { publicationV1 } from '../catalog-publication-v1.js';
export class CatalogPublication1794117000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    if ((await r.query('SELECT version FROM app_schema_version'))[0]?.version !== 18)
      throw Error('Schema 18 required');
    const name = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw Error('Unsupported schema');
    await r.query(publicationV1('"' + name + '"'));
  }
  async down(r: QueryRunner) {
    for (const table of [
      'catalog_publication_events',
      'catalog_publication_requests',
      'catalog_media_reviews',
      'catalog_releases',
    ])
      if ((await r.query('SELECT 1 FROM ' + table + ' LIMIT 1')).length)
        throw Error('Cannot discard publication history');
    await r.query(
      `DROP FUNCTION catalog_publication_post(uuid,uuid,uuid,jsonb),catalog_release_eligible(uuid),catalog_release_basis(uuid);DROP TABLE catalog_publication_requests,catalog_publication_events,catalog_releases,catalog_media_reviews;DELETE FROM role_permissions WHERE permission_code IN('catalog.media.review','catalog.publish');DELETE FROM permissions WHERE code IN('catalog.media.review','catalog.publish');UPDATE app_schema_version SET version=18 WHERE singleton;`,
    );
  }
}
