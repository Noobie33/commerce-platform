import type { MigrationInterface, QueryRunner } from 'typeorm';
export class SalesReservations1794110000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    const name = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw Error('Unsupported reservation schema');
    const s = '"' + name + '"';
    await r.query(`
 CREATE TABLE sales_reservation_state(order_id uuid PRIMARY KEY REFERENCES sales_orders(id),version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646));
 CREATE TABLE sales_reservations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES sales_orders(id),order_version integer NOT NULL,location_id uuid NOT NULL REFERENCES locations(id),actor_id uuid NOT NULL REFERENCES staff_users(id),reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,closed_at timestamptz,closed_by uuid REFERENCES staff_users(id),close_kind text CHECK(close_kind IN('release','expiry')),close_reason text NOT NULL DEFAULT '' CHECK(length(close_reason)<=500),CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours'),CHECK((closed_at IS NULL AND closed_by IS NULL AND close_kind IS NULL AND close_reason='') OR(closed_at IS NOT NULL AND closed_by IS NOT NULL AND close_kind IS NOT NULL AND length(close_reason)>0)));
 CREATE UNIQUE INDEX sales_reservations_open_order_idx ON sales_reservations(order_id) WHERE closed_at IS NULL;
 CREATE INDEX sales_reservations_location_idx ON sales_reservations(location_id,expires_at) WHERE closed_at IS NULL;
 CREATE TABLE sales_reservation_lines(reservation_id uuid NOT NULL REFERENCES sales_reservations(id),variant_id uuid NOT NULL REFERENCES catalog_variants(id),sku text NOT NULL,product_name text NOT NULL,quantity bigint NOT NULL CHECK(quantity BETWEEN 1 AND 999999999),PRIMARY KEY(reservation_id,variant_id));
 CREATE INDEX sales_reservation_lines_variant_idx ON sales_reservation_lines(variant_id,reservation_id);
 CREATE TABLE sales_reservation_requests(key uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES staff_users(id),request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),reservation_id uuid NOT NULL REFERENCES sales_reservations(id),response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE VIEW inventory_availability AS SELECT b.location_id,b.variant_id,b.quantity AS on_hand,coalesce(h.held,0)::bigint AS reserved,(b.quantity-coalesce(h.held,0))::bigint AS available FROM inventory_balances b LEFT JOIN LATERAL(SELECT sum(l.quantity) AS held FROM sales_reservation_lines l JOIN sales_reservations h ON h.id=l.reservation_id WHERE h.location_id=b.location_id AND l.variant_id=b.variant_id AND h.closed_at IS NULL AND h.expires_at>CURRENT_TIMESTAMP) h ON true;
 INSERT INTO permissions(code) VALUES('sales.reserve');INSERT INTO role_permissions(role_id,permission_code) SELECT id,'sales.reserve' FROM roles WHERE code='owner';
 CREATE FUNCTION ${s}.protect_reserved_balance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
 DECLARE held bigint;
 BEGIN SELECT coalesce(sum(l.quantity),0) INTO held FROM ${s}.sales_reservation_lines l JOIN ${s}.sales_reservations h ON h.id=l.reservation_id WHERE h.location_id=OLD.location_id AND l.variant_id=OLD.variant_id AND h.closed_at IS NULL AND h.expires_at>CURRENT_TIMESTAMP;
 IF held>0 AND(TG_OP='DELETE') THEN RAISE EXCEPTION 'INVENTORY_RESERVED';END IF;
 IF TG_OP='UPDATE' AND held>0 AND(NEW.quantity<held OR NEW.location_id<>OLD.location_id OR NEW.variant_id<>OLD.variant_id) THEN RAISE EXCEPTION 'INVENTORY_RESERVED';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END;$f$;
 REVOKE ALL ON FUNCTION ${s}.protect_reserved_balance() FROM PUBLIC;
 CREATE TRIGGER protect_reserved_balance BEFORE UPDATE OR DELETE ON inventory_balances FOR EACH ROW EXECUTE FUNCTION ${s}.protect_reserved_balance();
 CREATE FUNCTION ${s}.protect_reserved_sales_draft() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
 BEGIN IF EXISTS(SELECT 1 FROM ${s}.sales_reservations WHERE order_id=OLD.id AND closed_at IS NULL AND expires_at>CURRENT_TIMESTAMP) THEN RAISE EXCEPTION 'SALES_RESERVED';END IF;RETURN NEW;END;$f$;
 REVOKE ALL ON FUNCTION ${s}.protect_reserved_sales_draft() FROM PUBLIC;
 CREATE TRIGGER protect_reserved_sales_draft BEFORE UPDATE ON sales_orders FOR EACH ROW EXECUTE FUNCTION ${s}.protect_reserved_sales_draft();
 CREATE FUNCTION ${s}.sales_reservation_post(save_key uuid,actor uuid,request_id uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
 DECLARE operation text;po ${s}.sales_orders%ROWTYPE;prior ${s}.sales_reservations%ROWTYPE;cached ${s}.sales_reservation_requests%ROWTYPE;loc uuid;hash text;revision integer;minutes integer;item record;balance bigint;held bigint;reservation_uuid uuid;happened timestamptz;reason_text text;response jsonb;
 BEGIN
 IF save_key IS NULL OR actor IS NULL OR request_id IS NULL OR coalesce(jsonb_typeof(payload),'')<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN('kind','orderId','reservationId','expectedVersion','expectedRevision','holdMinutes','reason')) THEN RAISE EXCEPTION 'RESERVATION_INVALID';END IF;
 operation:=payload->>'kind';reason_text:=btrim(payload->>'reason');IF operation IS NULL OR operation NOT IN('hold','release') OR jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string' OR coalesce(length(reason_text),0) NOT BETWEEN 1 AND 500 OR coalesce(payload->>'expectedVersion','')!~'^[1-9][0-9]{0,9}$' OR coalesce(payload->>'expectedRevision','')!~'^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'RESERVATION_INVALID';END IF;
 IF NOT EXISTS(SELECT 1 FROM ${s}.staff_users u JOIN ${s}.staff_role_assignments a ON a.staff_id=u.id JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE u.id=actor AND u.is_active AND NOT u.must_change_password AND a.location_id IS NULL AND p.permission_code='sales.read') THEN RAISE EXCEPTION 'RESERVATION_PERMISSION';END IF;
 SELECT * INTO po FROM ${s}.sales_orders WHERE id=(payload->>'orderId')::uuid;IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND';END IF;loc:=po.location_id;
 IF operation='release' THEN SELECT * INTO prior FROM ${s}.sales_reservations WHERE id=(payload->>'reservationId')::uuid AND order_id=po.id;IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND';END IF;loc:=prior.location_id;END IF;
 IF NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE a.staff_id=actor AND(a.location_id IS NULL OR a.location_id=loc) AND p.permission_code='inventory.read') OR NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE a.staff_id=actor AND(a.location_id IS NULL OR a.location_id=loc) AND p.permission_code='sales.reserve') THEN RAISE EXCEPTION 'RESERVATION_PERMISSION';END IF;
 hash:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');PERFORM pg_advisory_xact_lock(hashtextextended('sales-reservation:'||save_key::text,12));SELECT * INTO cached FROM ${s}.sales_reservation_requests WHERE key=save_key;
 IF FOUND THEN IF cached.actor_id<>actor OR cached.request_hash<>hash THEN RAISE EXCEPTION 'RESERVATION_IDEMPOTENCY';END IF;RETURN cached.response;END IF;
 SELECT * INTO po FROM ${s}.sales_orders WHERE id=po.id FOR UPDATE;
 IF po.version<>(payload->>'expectedVersion')::integer THEN RAISE EXCEPTION 'RESERVATION_STALE';END IF;
 SELECT coalesce((SELECT version FROM ${s}.sales_reservation_state WHERE order_id=po.id),1) INTO revision;IF revision<>(payload->>'expectedRevision')::integer THEN RAISE EXCEPTION 'RESERVATION_STALE';END IF;
 IF operation='hold' THEN
 IF po.status<>'draft' OR po.location_id<>loc THEN RAISE EXCEPTION 'RESERVATION_STALE';END IF;
 IF payload?'reservationId' OR coalesce(payload->>'holdMinutes','')!~'^[1-9][0-9]{1,3}$' THEN RAISE EXCEPTION 'RESERVATION_INVALID';END IF;minutes:=(payload->>'holdMinutes')::integer;IF minutes NOT BETWEEN 15 AND 1440 THEN RAISE EXCEPTION 'RESERVATION_INVALID';END IF;
 PERFORM 1 FROM ${s}.locations WHERE id=loc AND is_active FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_UNAVAILABLE';END IF;
 PERFORM 1 FROM ${s}.customers WHERE id=po.customer_id AND is_active AND segment IN(po.channel,'both') FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_UNAVAILABLE';END IF;
 SELECT * INTO prior FROM ${s}.sales_reservations WHERE order_id=po.id AND closed_at IS NULL;
 IF FOUND AND prior.expires_at>CURRENT_TIMESTAMP THEN RAISE EXCEPTION 'RESERVATION_EXISTS';END IF;
 FOR item IN SELECT l.variant_id,l.quantity FROM ${s}.sales_order_lines l WHERE l.order_id=po.id ORDER BY l.variant_id LOOP
 PERFORM 1 FROM ${s}.catalog_variants v JOIN ${s}.catalog_products p ON p.id=v.product_id WHERE v.id=item.variant_id AND v.is_active AND p.status='active' FOR SHARE OF v,p;IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_UNAVAILABLE';END IF;
 SELECT quantity INTO balance FROM ${s}.inventory_balances WHERE location_id=loc AND variant_id=item.variant_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_INSUFFICIENT';END IF;
 SELECT coalesce(sum(l.quantity),0) INTO held FROM ${s}.sales_reservation_lines l JOIN ${s}.sales_reservations h ON h.id=l.reservation_id WHERE h.location_id=loc AND l.variant_id=item.variant_id AND h.closed_at IS NULL AND h.expires_at>CURRENT_TIMESTAMP;
 IF balance-held<item.quantity THEN RAISE EXCEPTION 'RESERVATION_INSUFFICIENT';END IF;
 UPDATE ${s}.inventory_balances SET quantity=quantity WHERE location_id=loc AND variant_id=item.variant_id;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM ${s}.sales_order_lines WHERE order_id=po.id) THEN RAISE EXCEPTION 'RESERVATION_INVALID';END IF;
 happened:=clock_timestamp();IF prior.id IS NOT NULL THEN UPDATE ${s}.sales_reservations SET closed_at=happened,closed_by=actor,close_kind='expiry',close_reason='Expired before replacement hold' WHERE id=prior.id;END IF;
 UPDATE ${s}.sales_orders SET version=version+1,updated_by=actor,updated_at=clock_timestamp() WHERE id=po.id RETURNING version INTO po.version;
 INSERT INTO ${s}.sales_reservations(order_id,order_version,location_id,actor_id,reason,created_at,expires_at) VALUES(po.id,po.version,loc,actor,reason_text,happened,happened+make_interval(mins=>minutes)) RETURNING id INTO reservation_uuid;
 INSERT INTO ${s}.sales_reservation_lines(reservation_id,variant_id,sku,product_name,quantity) SELECT reservation_uuid,variant_id,sku,product_name,quantity FROM ${s}.sales_order_lines WHERE order_id=po.id;
 ELSE
 IF payload?'holdMinutes' THEN RAISE EXCEPTION 'RESERVATION_INVALID';END IF;
 SELECT * INTO prior FROM ${s}.sales_reservations WHERE id=prior.id FOR UPDATE;IF prior.closed_at IS NOT NULL THEN RAISE EXCEPTION 'RESERVATION_CLOSED';END IF;
 FOR item IN SELECT variant_id FROM ${s}.sales_reservation_lines WHERE reservation_id=prior.id ORDER BY variant_id LOOP PERFORM 1 FROM ${s}.inventory_balances WHERE location_id=loc AND variant_id=item.variant_id FOR UPDATE;END LOOP;
 UPDATE ${s}.sales_reservations SET closed_at=clock_timestamp(),closed_by=actor,close_kind=CASE WHEN expires_at<=CURRENT_TIMESTAMP THEN 'expiry' ELSE 'release' END,close_reason=reason_text WHERE id=prior.id;reservation_uuid:=prior.id;
 UPDATE ${s}.sales_orders SET version=version+1,updated_by=actor,updated_at=clock_timestamp() WHERE id=po.id RETURNING version INTO po.version;
 END IF;
 revision:=revision+1;INSERT INTO ${s}.sales_reservation_state(order_id,version) VALUES(po.id,revision) ON CONFLICT(order_id) DO UPDATE SET version=excluded.version;
 response:=jsonb_build_object('id',reservation_uuid,'orderId',po.id,'revision',revision,'orderVersion',po.version,'kind',operation);
 INSERT INTO ${s}.audit_events(actor_id,action,request_id,metadata) VALUES(actor,CASE operation WHEN 'hold' THEN 'sales.stock_held' ELSE 'sales.stock_released' END,request_id,jsonb_build_object('entityId',reservation_uuid,'orderId',po.id,'revision',revision));
 INSERT INTO ${s}.sales_reservation_requests(key,actor_id,request_hash,reservation_id,response) VALUES(save_key,actor,hash,reservation_uuid,response);RETURN response;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation OR invalid_parameter_value THEN RAISE EXCEPTION 'RESERVATION_INVALID';END;$f$;
 REVOKE ALL ON FUNCTION ${s}.sales_reservation_post(uuid,uuid,uuid,jsonb) FROM PUBLIC;
 UPDATE app_schema_version SET version=12 WHERE singleton;`);
  }
  async down(r: QueryRunner) {
    if ((await r.query('SELECT 1 FROM sales_reservations LIMIT 1')).length)
      throw Error('Cannot discard stock reservation history; restore the complete backup instead');
    const name = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw Error('Unsupported reservation schema');
    const s = '"' + name + '"';
    await r.query(
      `DROP FUNCTION ${s}.sales_reservation_post(uuid,uuid,uuid,jsonb);DROP TRIGGER protect_reserved_sales_draft ON sales_orders;DROP FUNCTION ${s}.protect_reserved_sales_draft();DROP TRIGGER protect_reserved_balance ON inventory_balances;DROP FUNCTION ${s}.protect_reserved_balance();DROP VIEW inventory_availability;DROP TABLE sales_reservation_requests,sales_reservation_lines,sales_reservations,sales_reservation_state;DELETE FROM role_permissions WHERE permission_code='sales.reserve';DELETE FROM permissions WHERE code='sales.reserve';UPDATE app_schema_version SET version=11 WHERE singleton;`,
    );
  }
}
