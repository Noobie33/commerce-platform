import type { MigrationInterface, QueryRunner } from 'typeorm';
import { merchandisingV1 } from '../catalog-merchandising-v1.js';
export class CatalogMerchandising1794115000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    if ((await r.query('SELECT version FROM app_schema_version'))[0]?.version !== 16)
      throw Error('Schema 16 required');
    const name = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw Error('Unsupported schema');
    await r.query(merchandisingV1('"' + name + '"'));
  }
  async down(r: QueryRunner) {
    if (
      (await r.query('SELECT 1 FROM catalog_merch_items LIMIT 1')).length ||
      (await r.query('SELECT 1 FROM catalog_merch_requests LIMIT 1')).length
    )
      throw Error('Cannot discard merchandising history');
    await r.query(
      `DROP FUNCTION catalog_content_post(uuid,uuid,uuid,jsonb),catalog_content_issues(uuid),catalog_content_snapshot(uuid),catalog_merch_projection(uuid),catalog_merch_post(uuid,uuid,uuid,jsonb);ALTER FUNCTION catalog_content_post_v14(uuid,uuid,uuid,jsonb) RENAME TO catalog_content_post;ALTER FUNCTION catalog_content_issues_v14(uuid) RENAME TO catalog_content_issues;ALTER FUNCTION catalog_content_snapshot_v14(uuid) RENAME TO catalog_content_snapshot;ALTER TABLE catalog_merch_items DROP CONSTRAINT merch_current_version;DROP TABLE catalog_merch_links,catalog_merch_requests,catalog_merch_versions,catalog_merch_items;DROP FUNCTION catalog_merch_valid(text,jsonb);DELETE FROM role_permissions WHERE permission_code='catalog.merch.manage';DELETE FROM permissions WHERE code='catalog.merch.manage';UPDATE app_schema_version SET version=16 WHERE singleton;`,
    );
  }
}
