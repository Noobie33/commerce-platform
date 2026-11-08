import type { MigrationInterface, QueryRunner } from 'typeorm';
export class PurchasingFoundation1794104000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    const schema = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw Error('Unsupported purchasing schema');
    const s = '"' + schema + '"';
    await r.query(`
 CREATE TABLE purchasing_suppliers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE CHECK(code ~ '^[A-Z0-9][A-Z0-9._-]{1,31}$'),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 140),contact_name text NOT NULL DEFAULT '' CHECK(length(contact_name)<=120),
 phone text NOT NULL DEFAULT '' CHECK(length(phone)<=50),email text NOT NULL DEFAULT '' CHECK(length(email)<=160),
 address text NOT NULL DEFAULT '' CHECK(length(address)<=1000),tax_reference text NOT NULL DEFAULT '' CHECK(length(tax_reference)<=80),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=1000),is_active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
 CREATE SEQUENCE purchasing_order_number;
 CREATE TABLE purchase_orders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),number text NOT NULL UNIQUE DEFAULT ('PO-'||lpad(nextval('purchasing_order_number')::text,10,'0')),
 supplier_id uuid NOT NULL REFERENCES purchasing_suppliers(id),location_id uuid NOT NULL REFERENCES locations(id),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','cancelled')),currency text NOT NULL DEFAULT 'BDT' CHECK(currency='BDT'),
 expected_on date,reference text NOT NULL DEFAULT '' CHECK(length(reference)<=100),notes text NOT NULL DEFAULT '' CHECK(length(notes)<=1000),
 total_minor bigint NOT NULL DEFAULT 0 CHECK(total_minor BETWEEN 0 AND 99999999999999),supplier_snapshot jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(supplier_snapshot)='object'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_by uuid NOT NULL REFERENCES staff_users(id),
 issued_at timestamptz,cancelled_at timestamptz,cancellation_reason text NOT NULL DEFAULT '' CHECK(length(cancellation_reason)<=500),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((status='draft' AND issued_at IS NULL AND cancelled_at IS NULL) OR (status='issued' AND issued_at IS NOT NULL AND cancelled_at IS NULL) OR (status='cancelled' AND cancelled_at IS NOT NULL AND length(cancellation_reason)>0)));
 CREATE TABLE purchase_order_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES purchase_orders(id),variant_id uuid NOT NULL REFERENCES catalog_variants(id),
 sku text NOT NULL,product_name text NOT NULL,attributes jsonb NOT NULL CHECK(jsonb_typeof(attributes)='object'),
 quantity bigint NOT NULL CHECK(quantity BETWEEN 1 AND 999999999),unit_cost_minor bigint NOT NULL CHECK(unit_cost_minor BETWEEN 0 AND 999999999999),
 line_total_minor bigint GENERATED ALWAYS AS(quantity*unit_cost_minor) STORED CHECK(line_total_minor BETWEEN 0 AND 99999999999999),
 UNIQUE(order_id,variant_id));
 CREATE INDEX purchase_orders_time_idx ON purchase_orders(created_at DESC,id DESC);
 CREATE INDEX purchase_orders_supplier_idx ON purchase_orders(supplier_id);
 CREATE TABLE purchasing_requests(
 key uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES staff_users(id),request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 supplier_id uuid REFERENCES purchasing_suppliers(id),order_id uuid REFERENCES purchase_orders(id),response jsonb NOT NULL,
 CHECK((supplier_id IS NULL)<>(order_id IS NULL)),created_at timestamptz NOT NULL DEFAULT now());
 INSERT INTO permissions(code) VALUES('purchasing.read'),('purchasing.manage');
 INSERT INTO role_permissions(role_id,permission_code) SELECT r.id,p.code FROM roles r CROSS JOIN permissions p WHERE r.code='owner' AND p.code IN ('purchasing.read','purchasing.manage');
 UPDATE app_schema_version SET version=6 WHERE singleton;
 `);
    await r.query(`
 CREATE FUNCTION ${s}.protect_purchase_order() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
 BEGIN
 IF OLD.status<>'draft' THEN
  IF NOT(OLD.status='issued' AND NEW.status='cancelled' AND NEW.version=OLD.version+1 AND
   (to_jsonb(NEW)-ARRAY['status','version','cancellation_reason','cancelled_at','updated_at'])=(to_jsonb(OLD)-ARRAY['status','version','cancellation_reason','cancelled_at','updated_at']))
  THEN RAISE EXCEPTION 'PURCHASING_ORDER_IMMUTABLE';END IF;
 END IF;
 IF NEW.status='issued' THEN
  IF NOT EXISTS(SELECT 1 FROM ${s}.purchase_order_lines WHERE order_id=NEW.id) OR NEW.supplier_snapshot='{}'::jsonb OR NEW.total_minor<>(SELECT coalesce(sum(line_total_minor),0) FROM ${s}.purchase_order_lines WHERE order_id=NEW.id)
  THEN RAISE EXCEPTION 'PURCHASING_ORDER_INVALID';END IF;
 END IF;
 RETURN NEW;
 END;$f$;
 REVOKE ALL ON FUNCTION ${s}.protect_purchase_order() FROM PUBLIC;
 CREATE TRIGGER protect_purchase_order BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION ${s}.protect_purchase_order();
 CREATE FUNCTION ${s}.protect_purchase_line() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
 DECLARE target uuid; state text;
 BEGIN
 IF TG_OP='DELETE' AND current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='${s}.purchase_order_lines'::regclass) THEN RETURN OLD;END IF;
 IF TG_OP='UPDATE' AND (NEW.order_id<>OLD.order_id OR NEW.id<>OLD.id) THEN RAISE EXCEPTION 'PURCHASING_ORDER_IMMUTABLE';END IF;
 target:=CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END;
 SELECT status INTO state FROM ${s}.purchase_orders WHERE id=target FOR SHARE;
 IF state IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'PURCHASING_ORDER_IMMUTABLE';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
 END;$f$;
 REVOKE ALL ON FUNCTION ${s}.protect_purchase_line() FROM PUBLIC;
 CREATE TRIGGER protect_purchase_line BEFORE INSERT OR UPDATE OR DELETE ON purchase_order_lines FOR EACH ROW EXECUTE FUNCTION ${s}.protect_purchase_line();
 `);
  }
  async down(r: QueryRunner) {
    if (
      (await r.query('SELECT 1 FROM purchase_orders LIMIT 1')).length ||
      (await r.query('SELECT 1 FROM purchasing_suppliers LIMIT 1')).length
    )
      throw Error('Cannot discard purchasing records; restore the complete backup instead');
    const schema = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw Error('Unsupported purchasing schema');
    await r.query(
      'DROP TABLE purchasing_requests,purchase_order_lines,purchase_orders,purchasing_suppliers;DROP SEQUENCE purchasing_order_number;DROP FUNCTION "' +
        schema +
        '".protect_purchase_line();DROP FUNCTION "' +
        schema +
        '".protect_purchase_order();',
    );
    await r.query(
      "DELETE FROM role_permissions WHERE permission_code IN ('purchasing.read','purchasing.manage');DELETE FROM permissions WHERE code IN ('purchasing.read','purchasing.manage');UPDATE app_schema_version SET version=5 WHERE singleton",
    );
  }
}
