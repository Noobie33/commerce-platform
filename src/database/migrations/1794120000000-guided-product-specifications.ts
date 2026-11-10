import type { MigrationInterface, QueryRunner } from 'typeorm';
import { guidedContentProfilesV1 } from '../catalog-vocabularies-v1.js';
export class GuidedProductSpecifications1794120000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    if ((await r.query('SELECT version FROM app_schema_version'))[0]?.version !== 21)
      throw Error('Schema 21 required');
    for (const p of guidedContentProfilesV1)
      await r.query(
        'INSERT INTO catalog_content_profiles(code,label,fields) VALUES($1,$2,$3::jsonb)',
        [p.code, p.label, JSON.stringify(p.fields)],
      );
    await r.query('UPDATE app_schema_version SET version=22 WHERE singleton');
  }
  async down(r: QueryRunner) {
    const codes = guidedContentProfilesV1.map((p) => p.code);
    if ((await r.query('SELECT version FROM app_schema_version'))[0]?.version !== 22)
      throw Error('Schema 22 required');
    if (
      (
        await r.query(
          "SELECT 1 FROM catalog_product_content WHERE profile_code=ANY($1::text[]) UNION ALL SELECT 1 FROM catalog_content_events WHERE snapshot->>'profile'=ANY($1::text[]) LIMIT 1",
          [codes],
        )
      ).length
    )
      throw Error('Cannot remove guided profiles referenced by current content or review history');
    await r.query('DELETE FROM catalog_content_profiles WHERE code=ANY($1::text[])', [codes]);
    await r.query('UPDATE app_schema_version SET version=21 WHERE singleton');
  }
}
