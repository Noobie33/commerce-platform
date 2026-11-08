import type { MigrationInterface, QueryRunner } from 'typeorm';
export class PurchaseReceipts1794105000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    const schema = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw Error('Unsupported receipt schema');
    const s = '"' + schema + '"';
    const grants: { name: string; grantable: boolean }[] = await r.query(
      "SELECT roles.rolname AS name,bool_or(a.is_grantable) AS grantable FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles roles ON roles.oid=a.grantee WHERE p.oid=to_regprocedure($1) AND a.privilege_type='EXECUTE' AND a.grantee<>p.proowner GROUP BY roles.rolname",
      [s + '.inventory_post(uuid,uuid,uuid,jsonb)'],
    );
    await r.query(`
 CREATE TABLE purchase_receipt_function_grants(role_name text PRIMARY KEY,grantable boolean NOT NULL);
 ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_line_order_id_ux UNIQUE(order_id,id);
 CREATE TABLE purchase_receipt_state(order_id uuid PRIMARY KEY REFERENCES purchase_orders(id),version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646));
 CREATE TABLE purchase_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES purchase_orders(id),location_id uuid NOT NULL REFERENCES locations(id),
 inventory_posting_id uuid NOT NULL UNIQUE REFERENCES inventory_postings(id),actor_id uuid NOT NULL REFERENCES staff_users(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),reference text NOT NULL DEFAULT '' CHECK(length(reference)<=100),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(order_id,id));
 CREATE INDEX purchase_receipts_order_idx ON purchase_receipts(order_id,created_at DESC,id DESC);
 CREATE TABLE purchase_receipt_lines(order_id uuid NOT NULL,receipt_id uuid NOT NULL,order_line_id uuid NOT NULL,quantity bigint NOT NULL CHECK(quantity BETWEEN 1 AND 999999999),PRIMARY KEY(receipt_id,order_line_id),
 FOREIGN KEY(order_id,receipt_id) REFERENCES purchase_receipts(order_id,id),FOREIGN KEY(order_id,order_line_id) REFERENCES purchase_order_lines(order_id,id));
 CREATE INDEX purchase_receipt_line_order_idx ON purchase_receipt_lines(order_id,order_line_id);
 CREATE TABLE purchase_receipt_reversals(receipt_id uuid PRIMARY KEY REFERENCES purchase_receipts(id),inventory_posting_id uuid NOT NULL UNIQUE REFERENCES inventory_postings(id),actor_id uuid NOT NULL REFERENCES staff_users(id),reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),reference text NOT NULL DEFAULT '' CHECK(length(reference)<=100),created_at timestamptz NOT NULL DEFAULT now());
 INSERT INTO permissions(code) VALUES('purchasing.receive'),('purchasing.reverse_receipt');
 INSERT INTO role_permissions(role_id,permission_code) SELECT r.id,p.code FROM roles r CROSS JOIN permissions p WHERE r.code='owner' AND p.code IN('purchasing.receive','purchasing.reverse_receipt');
 ALTER FUNCTION ${s}.inventory_post(uuid,uuid,uuid,jsonb) RENAME TO inventory_post_core;
 REVOKE ALL ON FUNCTION ${s}.inventory_post_core(uuid,uuid,uuid,jsonb) FROM PUBLIC;
 UPDATE app_schema_version SET version=7 WHERE singleton;
 `);
    for (const g of grants) {
      await r.query('INSERT INTO purchase_receipt_function_grants VALUES($1,$2)', [
        g.name,
        g.grantable,
      ]);
      await r.query(
        'REVOKE ALL ON FUNCTION ' +
          s +
          '.inventory_post_core(uuid,uuid,uuid,jsonb) FROM "' +
          g.name.replaceAll('"', '""') +
          '"',
      );
    }
    await r.query(`
 CREATE FUNCTION ${s}.inventory_post(save_key uuid,actor uuid,request_id uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
 DECLARE loc uuid;
 BEGIN
 IF payload->>'kind'='reversal' THEN
  SELECT location_id INTO loc FROM ${s}.inventory_postings WHERE id=(payload->>'reversalOf')::uuid;
  IF EXISTS(SELECT 1 FROM ${s}.purchase_receipts WHERE inventory_posting_id=(payload->>'reversalOf')::uuid) THEN
   IF NOT ${s}.inventory_permitted(actor,'inventory.read',loc) OR NOT ${s}.inventory_permitted(actor,'inventory.adjust',loc) THEN RAISE EXCEPTION 'INVENTORY_PERMISSION';END IF;
   RAISE EXCEPTION 'PURCHASE_RECEIPT_MANAGED';
  END IF;
 END IF;
 RETURN ${s}.inventory_post_core(save_key,actor,request_id,payload);
 EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVENTORY_INVALID_INPUT';
 END;$f$;
 REVOKE ALL ON FUNCTION ${s}.inventory_post(uuid,uuid,uuid,jsonb) FROM PUBLIC;
 CREATE FUNCTION ${s}.protect_received_order_cancellation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
 BEGIN
 IF NEW.status='cancelled' AND OLD.status='issued' AND EXISTS(SELECT 1 FROM ${s}.purchase_receipts r WHERE r.order_id=OLD.id AND NOT EXISTS(SELECT 1 FROM ${s}.purchase_receipt_reversals x WHERE x.receipt_id=r.id)) THEN RAISE EXCEPTION 'PURCHASE_RECEIPTS_EXIST';END IF;
 RETURN NEW;END;$f$;
 REVOKE ALL ON FUNCTION ${s}.protect_received_order_cancellation() FROM PUBLIC;
 CREATE TRIGGER protect_received_order_cancellation BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION ${s}.protect_received_order_cancellation();
 CREATE FUNCTION ${s}.purchase_receipt_post(save_key uuid,actor uuid,request_id uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
 DECLARE operation text; order_uuid uuid;receipt_uuid uuid;revision integer;expected integer; po ${s}.purchase_orders%ROWTYPE;original ${s}.purchase_receipts%ROWTYPE;cached ${s}.purchasing_requests%ROWTYPE;
 reason_text text;reference_text text;hash text;stock_payload jsonb;stock_result jsonb;response jsonb;item jsonb;ordered bigint;received bigint;qty bigint;line_id uuid;variant uuid;work jsonb:='[]';line_count integer;new_revision integer;
 BEGIN
 IF save_key IS NULL OR actor IS NULL OR request_id IS NULL OR coalesce(jsonb_typeof(payload),'')<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN('kind','orderId','receiptId','expectedRevision','reason','reference','lines')) THEN RAISE EXCEPTION 'RECEIPT_INVALID_INPUT';END IF;
 operation:=payload->>'kind';reason_text:=btrim(payload->>'reason');reference_text:=coalesce(payload->>'reference','');
 IF operation IS NULL OR operation NOT IN('receive','reverse') OR reason_text IS NULL OR length(reason_text) NOT BETWEEN 1 AND 500 OR length(reference_text)>100 OR coalesce(payload->>'expectedRevision','')!~'^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'RECEIPT_INVALID_INPUT';END IF;
 expected:=(payload->>'expectedRevision')::integer;
 IF operation='reverse' THEN
  receipt_uuid:=(payload->>'receiptId')::uuid;SELECT * INTO original FROM ${s}.purchase_receipts WHERE id=receipt_uuid;IF NOT FOUND THEN RAISE EXCEPTION 'RECEIPT_NOT_FOUND';END IF;order_uuid:=original.order_id;
 ELSE order_uuid:=(payload->>'orderId')::uuid;END IF;
 SELECT * INTO po FROM ${s}.purchase_orders WHERE id=order_uuid;IF NOT FOUND THEN RAISE EXCEPTION 'RECEIPT_NOT_FOUND';END IF;
 IF NOT EXISTS(SELECT 1 FROM ${s}.staff_users u JOIN ${s}.staff_role_assignments a ON a.staff_id=u.id JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE u.id=actor AND u.is_active AND NOT u.must_change_password AND p.permission_code='purchasing.read' AND a.location_id IS NULL)
 OR NOT ${s}.inventory_permitted(actor,'inventory.read',po.location_id)
 OR NOT ${s}.inventory_permitted(actor,CASE WHEN operation='receive' THEN 'purchasing.receive' ELSE 'purchasing.reverse_receipt' END,po.location_id)
 OR NOT ${s}.inventory_permitted(actor,CASE WHEN operation='receive' THEN 'inventory.receive' ELSE 'inventory.adjust' END,po.location_id)
 THEN RAISE EXCEPTION 'RECEIPT_PERMISSION';END IF;
 hash:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('purchasing-request:'||save_key::text,6));
 SELECT * INTO cached FROM ${s}.purchasing_requests WHERE key=save_key;
 IF FOUND THEN IF cached.actor_id<>actor OR cached.request_hash<>hash THEN RAISE EXCEPTION 'INVENTORY_IDEMPOTENCY_MISMATCH';END IF;RETURN cached.response;END IF;
 SELECT * INTO po FROM ${s}.purchase_orders WHERE id=order_uuid FOR UPDATE;
 IF po.status<>'issued' THEN RAISE EXCEPTION 'RECEIPT_ORDER_STATE';END IF;
 INSERT INTO ${s}.purchase_receipt_state(order_id,version) VALUES(order_uuid,1) ON CONFLICT DO NOTHING;
 SELECT version INTO revision FROM ${s}.purchase_receipt_state WHERE order_id=order_uuid FOR UPDATE;
 IF revision<>expected THEN RAISE EXCEPTION 'RECEIPT_STALE';END IF;
 IF operation='receive' THEN
  IF coalesce(jsonb_typeof(payload->'lines'),'')<>'array' THEN RAISE EXCEPTION 'RECEIPT_INVALID_INPUT';END IF;
  line_count:=jsonb_array_length(payload->'lines');IF line_count NOT BETWEEN 1 AND 25 OR (SELECT count(DISTINCT value->>'orderLineId') FROM jsonb_array_elements(payload->'lines'))<>line_count THEN RAISE EXCEPTION 'RECEIPT_INVALID_INPUT';END IF;
  IF reference_text<>'' AND EXISTS(SELECT 1 FROM ${s}.purchase_receipts r WHERE r.order_id=order_uuid AND lower(r.reference)=lower(reference_text) AND NOT EXISTS(SELECT 1 FROM ${s}.purchase_receipt_reversals x WHERE x.receipt_id=r.id)) THEN RAISE EXCEPTION 'RECEIPT_REFERENCE_EXISTS';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(payload->'lines') ORDER BY value->>'orderLineId' LOOP
   IF jsonb_typeof(item)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN('orderLineId','quantity')) OR coalesce(item->>'quantity','')!~'^[1-9][0-9]{0,8}$' THEN RAISE EXCEPTION 'RECEIPT_INVALID_INPUT';END IF;
   line_id:=(item->>'orderLineId')::uuid;qty:=(item->>'quantity')::bigint;
   SELECT quantity,variant_id INTO ordered,variant FROM ${s}.purchase_order_lines WHERE id=line_id AND order_id=order_uuid;IF NOT FOUND THEN RAISE EXCEPTION 'RECEIPT_INVALID_INPUT';END IF;
   SELECT coalesce(sum(l.quantity),0) INTO received FROM ${s}.purchase_receipt_lines l WHERE l.order_line_id=line_id AND NOT EXISTS(SELECT 1 FROM ${s}.purchase_receipt_reversals x WHERE x.receipt_id=l.receipt_id);
   IF received+qty>ordered THEN RAISE EXCEPTION 'RECEIPT_OVER_QUANTITY';END IF;
   work:=work||jsonb_build_array(jsonb_build_object('variantId',variant,'quantity',qty::text));
  END LOOP;
  stock_payload:=jsonb_build_object('kind','receipt','locationId',po.location_id,'destinationId',NULL,'reason',reason_text,'reference',reference_text,'lines',work);
 ELSE
  IF EXISTS(SELECT 1 FROM ${s}.purchase_receipt_reversals WHERE receipt_id=receipt_uuid) THEN RAISE EXCEPTION 'RECEIPT_ALREADY_REVERSED';END IF;
  stock_payload:=jsonb_build_object('kind','reversal','reversalOf',original.inventory_posting_id,'reason',reason_text,'reference',reference_text);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('inventory-request:'||save_key::text,4));
 IF EXISTS(SELECT 1 FROM ${s}.inventory_requests WHERE key=save_key) THEN RAISE EXCEPTION 'INVENTORY_IDEMPOTENCY_MISMATCH';END IF;
 stock_result:=${s}.inventory_post_core(save_key,actor,request_id,stock_payload);
 IF operation='receive' THEN
  INSERT INTO ${s}.purchase_receipts(order_id,location_id,inventory_posting_id,actor_id,reason,reference) VALUES(order_uuid,po.location_id,(stock_result->>'id')::uuid,actor,reason_text,reference_text) RETURNING id INTO receipt_uuid;
  FOR item IN SELECT value FROM jsonb_array_elements(payload->'lines') LOOP
   INSERT INTO ${s}.purchase_receipt_lines(order_id,receipt_id,order_line_id,quantity) VALUES(order_uuid,receipt_uuid,(item->>'orderLineId')::uuid,(item->>'quantity')::bigint);
  END LOOP;
 ELSE
  INSERT INTO ${s}.purchase_receipt_reversals(receipt_id,inventory_posting_id,actor_id,reason,reference) VALUES(receipt_uuid,(stock_result->>'id')::uuid,actor,reason_text,reference_text);
 END IF;
 UPDATE ${s}.purchase_receipt_state SET version=version+1 WHERE order_id=order_uuid RETURNING version INTO new_revision;
 response:=jsonb_build_object('receiptId',receipt_uuid,'orderId',order_uuid,'inventoryPostingId',stock_result->>'id','receiptRevision',new_revision,'kind',operation);
 INSERT INTO ${s}.audit_events(actor_id,action,request_id,metadata) VALUES(actor,CASE WHEN operation='receive' THEN 'purchasing.receipt_created' ELSE 'purchasing.receipt_reversed' END,request_id,jsonb_build_object('entityId',receipt_uuid,'orderId',order_uuid,'inventoryPostingId',stock_result->>'id','version',new_revision));
 INSERT INTO ${s}.purchasing_requests(key,actor_id,request_hash,order_id,response) VALUES(save_key,actor,hash,order_uuid,response);
 RETURN response;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'RECEIPT_INVALID_INPUT';
 END;$f$;
 REVOKE ALL ON FUNCTION ${s}.purchase_receipt_post(uuid,uuid,uuid,jsonb) FROM PUBLIC;
 `);
  }
  async down(r: QueryRunner) {
    if ((await r.query('SELECT 1 FROM purchase_receipts LIMIT 1')).length)
      throw Error('Cannot discard posted purchase receipts; restore the complete backup instead');
    const schema = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw Error('Unsupported receipt schema');
    const s = '"' + schema + '"';
    const grants: { name: string; grantable: boolean }[] = await r.query(
      'SELECT g.role_name AS name,g.grantable FROM purchase_receipt_function_grants g JOIN pg_roles r ON r.rolname=g.role_name',
    );
    await r.query(
      `DROP FUNCTION ${s}.purchase_receipt_post(uuid,uuid,uuid,jsonb);DROP TRIGGER protect_received_order_cancellation ON purchase_orders;DROP FUNCTION ${s}.protect_received_order_cancellation();DROP FUNCTION ${s}.inventory_post(uuid,uuid,uuid,jsonb);ALTER FUNCTION ${s}.inventory_post_core(uuid,uuid,uuid,jsonb) RENAME TO inventory_post;DROP TABLE purchase_receipt_reversals,purchase_receipt_lines,purchase_receipts,purchase_receipt_state,purchase_receipt_function_grants;ALTER TABLE purchase_order_lines DROP CONSTRAINT purchase_line_order_id_ux;DELETE FROM role_permissions WHERE permission_code IN('purchasing.receive','purchasing.reverse_receipt');DELETE FROM permissions WHERE code IN('purchasing.receive','purchasing.reverse_receipt');UPDATE app_schema_version SET version=6 WHERE singleton;`,
    );
    for (const g of grants)
      await r.query(
        'GRANT EXECUTE ON FUNCTION ' +
          s +
          '.inventory_post(uuid,uuid,uuid,jsonb) TO "' +
          g.name.replaceAll('"', '""') +
          '"' +
          (g.grantable ? ' WITH GRANT OPTION' : ''),
      );
  }
}
