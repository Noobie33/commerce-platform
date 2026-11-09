import type { MigrationInterface, QueryRunner } from 'typeorm';
export class ContentIntegrity1794113000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    if (
      (await r.query('SELECT version FROM app_schema_version WHERE singleton'))[0]?.version !== 14
    )
      throw Error('Schema 14 is required for content integrity');
    // SQL CHECK accepts UNKNOWN. Explicit null pairing prevents a partial review
    // snapshot from passing a regex/equality check through three-valued logic.
    await r.query(
      `ALTER TABLE catalog_product_content ADD CONSTRAINT content_snapshot_pair CHECK((submitted_snapshot IS NULL)=(fingerprint IS NULL)),ADD CONSTRAINT content_submitted_actor CHECK(state NOT IN('in_review','approved') OR submitted_by IS NOT NULL);UPDATE app_schema_version SET version=15 WHERE singleton;`,
    );
  }
  async down(r: QueryRunner) {
    if ((await r.query('SELECT 1 FROM catalog_content_events LIMIT 1')).length)
      throw Error('Cannot weaken review integrity with content history');
    await r.query(
      'ALTER TABLE catalog_product_content DROP CONSTRAINT content_snapshot_pair,DROP CONSTRAINT content_submitted_actor;UPDATE app_schema_version SET version=14 WHERE singleton',
    );
  }
}
