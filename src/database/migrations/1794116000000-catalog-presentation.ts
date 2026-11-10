import type { MigrationInterface, QueryRunner } from 'typeorm';
import { presentationV1 } from '../catalog-presentation-v1.js';
export class CatalogPresentation1794116000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    if ((await r.query('SELECT version FROM app_schema_version'))[0]?.version !== 17)
      throw Error('Schema 17 required');
    const name = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw Error('Unsupported schema');
    const [check] = await r.query(
      `WITH RECURSIVE walk AS(SELECT id,parent_id,is_active AS origin_active,ARRAY[id] AS path,false AS cycle,1 AS depth,false AS inactive_parent FROM catalog_categories UNION ALL SELECT w.id,c.parent_id,w.origin_active,w.path||c.id,c.id=ANY(w.path),w.depth+1,w.inactive_parent OR(w.origin_active AND NOT c.is_active) FROM walk w JOIN catalog_categories c ON c.id=w.parent_id WHERE NOT w.cycle AND w.depth<=12) SELECT count(*) FILTER(WHERE cycle OR depth>12 OR inactive_parent)::int AS invalid FROM walk`,
    );
    if (check.invalid)
      throw Error('Existing category graph requires inspection; no automatic mapping');
    await r.query(presentationV1('"' + name + '"'));
  }
  async down(r: QueryRunner) {
    for (const table of [
      'catalog_category_events',
      'catalog_product_seo',
      'catalog_presentation_requests',
    ])
      if ((await r.query('SELECT 1 FROM ' + table + ' LIMIT 1')).length)
        throw Error('Cannot discard category/SEO history');
    await r.query(
      `DROP TRIGGER catalog_category_graph ON catalog_categories;DROP FUNCTION catalog_category_active(uuid),catalog_category_guard(),catalog_category_snapshot(uuid),catalog_category_post(uuid,uuid,uuid,jsonb),catalog_content_post(uuid,uuid,uuid,jsonb),catalog_content_snapshot(uuid);ALTER FUNCTION catalog_content_post_v17(uuid,uuid,uuid,jsonb) RENAME TO catalog_content_post;ALTER FUNCTION catalog_content_snapshot_v17(uuid) RENAME TO catalog_content_snapshot;DROP TABLE catalog_category_presentation,catalog_category_routes,catalog_category_events,catalog_product_seo,catalog_presentation_requests;DELETE FROM role_permissions WHERE permission_code='catalog.taxonomy.manage';DELETE FROM permissions WHERE code='catalog.taxonomy.manage';UPDATE app_schema_version SET version=17 WHERE singleton;`,
    );
  }
}
