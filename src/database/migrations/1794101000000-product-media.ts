import type { MigrationInterface, QueryRunner } from 'typeorm';
export class ProductMedia1794101000000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`
 CREATE TABLE catalog_product_photos(
 id uuid PRIMARY KEY,product_id uuid NOT NULL REFERENCES catalog_products(id),
 width integer NOT NULL CHECK(width BETWEEN 1 AND 1600),height integer NOT NULL CHECK(height BETWEEN 1 AND 1600),
 byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880),
 content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 is_primary boolean NOT NULL DEFAULT false,is_active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(is_active OR NOT is_primary));
 CREATE INDEX catalog_photos_product_idx ON catalog_product_photos(product_id,created_at,id);
 CREATE UNIQUE INDEX catalog_photos_primary_ux ON catalog_product_photos(product_id) WHERE is_active AND is_primary;
 CREATE TABLE catalog_media_requests(
 key uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES staff_users(id),product_id uuid NOT NULL REFERENCES catalog_products(id),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 UPDATE app_schema_version SET version=3 WHERE singleton;
 `);
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query(
      'DROP TABLE catalog_media_requests,catalog_product_photos; UPDATE app_schema_version SET version=2 WHERE singleton',
    );
  }
}
