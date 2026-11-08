import type { MigrationInterface, QueryRunner } from 'typeorm';
export class OriginalMedia1794102000000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`
 ALTER TABLE catalog_product_photos
  DROP CONSTRAINT catalog_product_photos_width_check,
  DROP CONSTRAINT catalog_product_photos_height_check,
  DROP CONSTRAINT catalog_product_photos_byte_size_check,
  ADD CHECK(width BETWEEN 1 AND 2560),
  ADD CHECK(height BETWEEN 1 AND 2560),
  ADD CHECK(byte_size BETWEEN 1 AND 52428800),
  ADD COLUMN original_type text,
  ADD COLUMN original_width integer,
  ADD COLUMN original_height integer,
  ADD COLUMN original_bytes integer,
  ADD COLUMN original_hash text,
  ADD CONSTRAINT catalog_photo_original_fields CHECK(
   (original_type IS NULL AND original_width IS NULL AND original_height IS NULL AND original_bytes IS NULL AND original_hash IS NULL)
   OR (original_type IS NOT NULL AND original_type IN ('image/jpeg','image/png','image/webp') AND original_width IS NOT NULL AND original_width>0 AND original_height IS NOT NULL AND original_height>0 AND original_width::bigint*original_height<=100000000 AND original_bytes IS NOT NULL AND original_bytes BETWEEN 1 AND 52428800 AND original_hash IS NOT NULL AND original_hash ~ '^[a-f0-9]{64}$'));
 UPDATE app_schema_version SET version=4 WHERE singleton;
 `);
  }
  async down(r: QueryRunner): Promise<void> {
    // Do not discard original references on rollback; operators must retain/restore the complete media backup.
    const rows = await r.query(
      'SELECT 1 FROM catalog_product_photos WHERE original_type IS NOT NULL OR width>1600 OR height>1600 OR byte_size>5242880 LIMIT 1',
    );
    if (rows.length)
      throw Error('Cannot revert original-media schema while newer media records exist');
    await r.query(`ALTER TABLE catalog_product_photos DROP CONSTRAINT catalog_photo_original_fields,
 DROP COLUMN original_type,DROP COLUMN original_width,DROP COLUMN original_height,DROP COLUMN original_bytes,DROP COLUMN original_hash,
 DROP CONSTRAINT catalog_product_photos_width_check,DROP CONSTRAINT catalog_product_photos_height_check,DROP CONSTRAINT catalog_product_photos_byte_size_check,
 ADD CHECK(width BETWEEN 1 AND 1600),ADD CHECK(height BETWEEN 1 AND 1600),ADD CHECK(byte_size BETWEEN 1 AND 5242880);
 UPDATE app_schema_version SET version=3 WHERE singleton;`);
  }
}
