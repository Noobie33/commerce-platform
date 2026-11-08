import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CatalogFoundation1794100000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE catalog_categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
        name_key text NOT NULL CHECK (length(name_key) BETWEEN 1 AND 120),
        parent_id uuid REFERENCES catalog_categories(id),
        is_active boolean NOT NULL DEFAULT true,
        CHECK (id <> parent_id),
        UNIQUE NULLS NOT DISTINCT (parent_id, name_key)
      );
      CREATE TABLE catalog_products (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        style_code text NOT NULL UNIQUE CHECK (style_code ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),
        name text NOT NULL CHECK (length(name) BETWEEN 1 AND 140),
        description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
        category_id uuid REFERENCES catalog_categories(id),
        status text NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
        currency text NOT NULL DEFAULT 'BDT' CHECK (currency = 'BDT'),
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX catalog_products_category_idx ON catalog_products(category_id);
      CREATE INDEX catalog_products_created_idx ON catalog_products(created_at DESC, id DESC);
      CREATE TABLE catalog_variants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id uuid NOT NULL REFERENCES catalog_products(id),
        sku text NOT NULL UNIQUE CHECK (sku ~ '^[A-Z0-9][A-Z0-9._-]{2,63}$'),
        attributes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(attributes) = 'object'),
        options_key text NOT NULL CHECK (options_key ~ '^[a-f0-9]{64}$'),
        barcode text CHECK (barcode ~ '^[!-~]{1,64}$'),
        price_minor bigint NOT NULL CHECK (price_minor BETWEEN 0 AND 999999999999),
        is_active boolean NOT NULL DEFAULT true
      );
      CREATE INDEX catalog_variants_product_idx ON catalog_variants(product_id);
      CREATE UNIQUE INDEX catalog_variant_options_active_ux ON catalog_variants(product_id, options_key) WHERE is_active;
      CREATE UNIQUE INDEX catalog_variant_barcode_ux ON catalog_variants(barcode) WHERE barcode IS NOT NULL;
      CREATE TABLE catalog_requests (
        key uuid PRIMARY KEY,
        actor_id uuid NOT NULL REFERENCES staff_users(id),
        resource_id uuid NOT NULL REFERENCES catalog_products(id),
        request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        response jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO permissions(code) VALUES ('catalog.read'), ('catalog.manage');
      INSERT INTO role_permissions(role_id,permission_code)
        SELECT id,p.code FROM roles CROSS JOIN (VALUES ('catalog.read'),('catalog.manage')) AS p(code) WHERE roles.code='owner';
      UPDATE app_schema_version SET version=2 WHERE singleton;
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DROP TABLE catalog_requests, catalog_variants, catalog_products, catalog_categories;
      DELETE FROM role_permissions WHERE permission_code IN ('catalog.read','catalog.manage');
      DELETE FROM permissions WHERE code IN ('catalog.read','catalog.manage');
      UPDATE app_schema_version SET version=1 WHERE singleton;
    `);
  }
}
