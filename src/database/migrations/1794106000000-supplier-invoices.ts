import type { MigrationInterface, QueryRunner } from 'typeorm';
export class SupplierInvoices1794106000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    const schema = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw Error('Unsupported invoice schema');
    const s = '"' + schema + '"';
    await r.query(`
 CREATE TABLE supplier_invoice_state(order_id uuid PRIMARY KEY REFERENCES purchase_orders(id),version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646));
 CREATE TABLE supplier_invoices(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES purchase_orders(id),supplier_id uuid NOT NULL REFERENCES purchasing_suppliers(id),
 supplier_snapshot jsonb NOT NULL CHECK(jsonb_typeof(supplier_snapshot)='object'),number text NOT NULL CHECK(length(number) BETWEEN 1 AND 100 AND number=btrim(number)),
 invoice_on date NOT NULL CHECK(invoice_on BETWEEN DATE '2000-01-01' AND DATE '2199-12-31'),due_on date NOT NULL CHECK(due_on>=invoice_on AND due_on<=DATE '2199-12-31'),
 currency text NOT NULL DEFAULT 'BDT' CHECK(currency='BDT'),goods_minor bigint NOT NULL CHECK(goods_minor BETWEEN 0 AND 99999999999999),
 tax_minor bigint NOT NULL CHECK(tax_minor BETWEEN 0 AND 999999999999),delivery_minor bigint NOT NULL CHECK(delivery_minor BETWEEN 0 AND 999999999999),discount_minor bigint NOT NULL CHECK(discount_minor BETWEEN 0 AND goods_minor),
 total_minor bigint GENERATED ALWAYS AS(goods_minor+tax_minor+delivery_minor-discount_minor) STORED CHECK(total_minor BETWEEN 1 AND 99999999999999),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),actor_id uuid NOT NULL REFERENCES staff_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 reversed_at timestamptz,reversed_by uuid REFERENCES staff_users(id),reversal_reason text NOT NULL DEFAULT '' CHECK(length(reversal_reason)<=500),
 CHECK((reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason='') OR(reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND length(reversal_reason)>0)));
 CREATE UNIQUE INDEX supplier_invoice_number_active_ux ON supplier_invoices(supplier_id,lower(number)) WHERE reversed_at IS NULL;
 CREATE INDEX supplier_invoice_order_idx ON supplier_invoices(order_id,created_at DESC,id DESC);
 CREATE INDEX supplier_invoice_supplier_idx ON supplier_invoices(supplier_id,due_on) WHERE reversed_at IS NULL;
 CREATE TABLE supplier_invoice_lines(
 invoice_id uuid NOT NULL REFERENCES supplier_invoices(id),receipt_id uuid NOT NULL,order_line_id uuid NOT NULL,
 quantity bigint NOT NULL CHECK(quantity BETWEEN 1 AND 999999999),unit_cost_minor bigint NOT NULL CHECK(unit_cost_minor BETWEEN 0 AND 999999999999),
 line_total_minor bigint GENERATED ALWAYS AS(quantity*unit_cost_minor) STORED CHECK(line_total_minor BETWEEN 0 AND 99999999999999),
 PRIMARY KEY(invoice_id,receipt_id,order_line_id),FOREIGN KEY(receipt_id,order_line_id) REFERENCES purchase_receipt_lines(receipt_id,order_line_id));
 CREATE INDEX supplier_invoice_receipt_idx ON supplier_invoice_lines(receipt_id,order_line_id);
 INSERT INTO permissions(code) VALUES('payables.read'),('payables.manage'),('payables.reverse');
 INSERT INTO role_permissions(role_id,permission_code) SELECT r.id,p.code FROM roles r CROSS JOIN permissions p WHERE r.code='owner' AND p.code IN('payables.read','payables.manage','payables.reverse');
 CREATE FUNCTION ${s}.protect_invoiced_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
 BEGIN
 IF EXISTS(SELECT 1 FROM ${s}.supplier_invoice_lines l JOIN ${s}.supplier_invoices i ON i.id=l.invoice_id WHERE l.receipt_id=NEW.receipt_id AND i.reversed_at IS NULL) THEN RAISE EXCEPTION 'RECEIPT_INVOICED';END IF;
 RETURN NEW;END;$f$;
 REVOKE ALL ON FUNCTION ${s}.protect_invoiced_receipt() FROM PUBLIC;
 CREATE TRIGGER protect_invoiced_receipt BEFORE INSERT ON purchase_receipt_reversals FOR EACH ROW EXECUTE FUNCTION ${s}.protect_invoiced_receipt();
 CREATE FUNCTION ${s}.supplier_invoice_post(save_key uuid,actor uuid,request_id uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
 DECLARE operation text; order_uuid uuid;invoice_uuid uuid;po ${s}.purchase_orders%ROWTYPE;bill ${s}.supplier_invoices%ROWTYPE;cached ${s}.purchasing_requests%ROWTYPE;
 revision integer;expected integer;hash text;reason_text text;doc text;invoice_date date;due_date date;tax bigint;delivery bigint;discount bigint;goods numeric:=0;qty bigint;cost bigint;available bigint;invoiced bigint;receipt_uuid uuid;line_uuid uuid;item jsonb;response jsonb;
 BEGIN
 IF save_key IS NULL OR actor IS NULL OR request_id IS NULL OR coalesce(jsonb_typeof(payload),'')<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN('kind','orderId','invoiceId','expectedRevision','number','invoiceOn','dueOn','tax','delivery','discount','reason','lines')) THEN RAISE EXCEPTION 'INVOICE_INVALID';END IF;
 operation:=payload->>'kind';reason_text:=btrim(payload->>'reason');
 IF operation IS NULL OR operation NOT IN('post','reverse') OR reason_text IS NULL OR length(reason_text) NOT BETWEEN 1 AND 500 OR coalesce(payload->>'expectedRevision','')!~'^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'INVOICE_INVALID';END IF;
 expected:=(payload->>'expectedRevision')::integer;
 IF NOT EXISTS(SELECT 1 FROM ${s}.staff_users u JOIN ${s}.staff_role_assignments a ON a.staff_id=u.id JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE u.id=actor AND u.is_active AND NOT u.must_change_password AND a.location_id IS NULL AND p.permission_code='payables.read')
 OR NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE a.staff_id=actor AND a.location_id IS NULL AND p.permission_code=CASE WHEN operation='post' THEN 'payables.manage' ELSE 'payables.reverse' END)
 OR NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE a.staff_id=actor AND a.location_id IS NULL AND p.permission_code='purchasing.read')
 THEN RAISE EXCEPTION 'INVOICE_PERMISSION';END IF;
 hash:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('purchasing-request:'||save_key::text,6));
 SELECT * INTO cached FROM ${s}.purchasing_requests WHERE key=save_key;
 IF FOUND THEN IF cached.actor_id<>actor OR cached.request_hash<>hash THEN RAISE EXCEPTION 'INVENTORY_IDEMPOTENCY_MISMATCH';END IF;RETURN cached.response;END IF;
 IF operation='reverse' THEN
 invoice_uuid:=(payload->>'invoiceId')::uuid;SELECT * INTO bill FROM ${s}.supplier_invoices WHERE id=invoice_uuid;IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND';END IF;order_uuid:=bill.order_id;
 ELSE order_uuid:=(payload->>'orderId')::uuid;END IF;
 SELECT * INTO po FROM ${s}.purchase_orders WHERE id=order_uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND';END IF;
 IF po.status<>'issued' THEN RAISE EXCEPTION 'INVOICE_ORDER_STATE';END IF;
 INSERT INTO ${s}.supplier_invoice_state(order_id,version) VALUES(order_uuid,1) ON CONFLICT DO NOTHING;
 SELECT version INTO revision FROM ${s}.supplier_invoice_state WHERE order_id=order_uuid FOR UPDATE;
 IF revision<>expected THEN RAISE EXCEPTION 'INVOICE_STALE';END IF;
 IF operation='reverse' THEN
 SELECT * INTO bill FROM ${s}.supplier_invoices WHERE id=invoice_uuid FOR UPDATE;
 IF bill.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'INVOICE_REVERSED';END IF;
 UPDATE ${s}.supplier_invoices SET reversed_at=now(),reversed_by=actor,reversal_reason=reason_text WHERE id=invoice_uuid;
 ELSE
 doc:=btrim(payload->>'number');
 IF doc IS NULL OR length(doc) NOT BETWEEN 1 AND 100 OR coalesce(payload->>'invoiceOn','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR coalesce(payload->>'dueOn','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'INVOICE_INVALID';END IF;
 invoice_date:=(payload->>'invoiceOn')::date;due_date:=(payload->>'dueOn')::date;
 IF invoice_date<DATE '2000-01-01' OR invoice_date>DATE '2199-12-31' OR due_date<invoice_date OR due_date>DATE '2199-12-31' THEN RAISE EXCEPTION 'INVOICE_INVALID';END IF;
 IF coalesce(payload->>'tax','')!~'^(0|[1-9][0-9]{0,11})$' OR coalesce(payload->>'delivery','')!~'^(0|[1-9][0-9]{0,11})$' OR coalesce(payload->>'discount','')!~'^(0|[1-9][0-9]{0,11})$' THEN RAISE EXCEPTION 'INVOICE_INVALID';END IF;
 tax:=(payload->>'tax')::bigint;delivery:=(payload->>'delivery')::bigint;discount:=(payload->>'discount')::bigint;
 IF coalesce(jsonb_typeof(payload->'lines'),'')<>'array' OR jsonb_array_length(payload->'lines') NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'INVOICE_INVALID';END IF;
 IF (SELECT count(DISTINCT((value->>'receiptId')::uuid,(value->>'orderLineId')::uuid)) FROM jsonb_array_elements(payload->'lines'))<>jsonb_array_length(payload->'lines') THEN RAISE EXCEPTION 'INVOICE_INVALID';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(payload->'lines') LOOP
 IF jsonb_typeof(item)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN('receiptId','orderLineId','quantity','unitCost')) OR coalesce(item->>'quantity','')!~'^[1-9][0-9]{0,8}$' OR coalesce(item->>'unitCost','')!~'^(0|[1-9][0-9]{0,11})$' THEN RAISE EXCEPTION 'INVOICE_INVALID';END IF;
 receipt_uuid:=(item->>'receiptId')::uuid;line_uuid:=(item->>'orderLineId')::uuid;qty:=(item->>'quantity')::bigint;cost:=(item->>'unitCost')::bigint;
 SELECT l.quantity INTO available FROM ${s}.purchase_receipt_lines l JOIN ${s}.purchase_receipts r ON r.id=l.receipt_id WHERE l.receipt_id=receipt_uuid AND l.order_line_id=line_uuid AND r.order_id=order_uuid AND NOT EXISTS(SELECT 1 FROM ${s}.purchase_receipt_reversals x WHERE x.receipt_id=r.id);
 IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_RECEIPT_UNAVAILABLE';END IF;
 SELECT coalesce(sum(l.quantity),0) INTO invoiced FROM ${s}.supplier_invoice_lines l JOIN ${s}.supplier_invoices i ON i.id=l.invoice_id WHERE l.receipt_id=receipt_uuid AND l.order_line_id=line_uuid AND i.reversed_at IS NULL;
 IF qty+invoiced>available THEN RAISE EXCEPTION 'INVOICE_OVER_QUANTITY';END IF;
 goods:=goods+qty::numeric*cost;
 END LOOP;
 IF goods>99999999999999 OR discount>goods OR goods+tax+delivery-discount NOT BETWEEN 1 AND 99999999999999 THEN RAISE EXCEPTION 'INVOICE_INVALID';END IF;
 INSERT INTO ${s}.supplier_invoices(order_id,supplier_id,supplier_snapshot,number,invoice_on,due_on,goods_minor,tax_minor,delivery_minor,discount_minor,reason,actor_id)
 VALUES(order_uuid,po.supplier_id,po.supplier_snapshot,doc,invoice_date,due_date,goods,tax,delivery,discount,reason_text,actor) RETURNING id INTO invoice_uuid;
 FOR item IN SELECT value FROM jsonb_array_elements(payload->'lines') LOOP
 INSERT INTO ${s}.supplier_invoice_lines(invoice_id,receipt_id,order_line_id,quantity,unit_cost_minor) VALUES(invoice_uuid,(item->>'receiptId')::uuid,(item->>'orderLineId')::uuid,(item->>'quantity')::bigint,(item->>'unitCost')::bigint);
 END LOOP;
 END IF;
 UPDATE ${s}.supplier_invoice_state SET version=version+1 WHERE order_id=order_uuid RETURNING version INTO revision;
 response:=jsonb_build_object('invoiceId',invoice_uuid,'orderId',order_uuid,'invoiceRevision',revision,'kind',operation);
 INSERT INTO ${s}.audit_events(actor_id,action,request_id,metadata) VALUES(actor,CASE WHEN operation='post' THEN 'payables.invoice_posted' ELSE 'payables.invoice_reversed' END,request_id,jsonb_build_object('entityId',invoice_uuid,'orderId',order_uuid,'version',revision));
 INSERT INTO ${s}.purchasing_requests(key,actor_id,request_hash,order_id,response) VALUES(save_key,actor,hash,order_uuid,response);
 RETURN response;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'INVOICE_INVALID';
 WHEN unique_violation THEN RAISE EXCEPTION 'INVOICE_NUMBER_EXISTS';
 END;$f$;
 REVOKE ALL ON FUNCTION ${s}.supplier_invoice_post(uuid,uuid,uuid,jsonb) FROM PUBLIC;
 UPDATE app_schema_version SET version=8 WHERE singleton;
 `);
  }
  async down(r: QueryRunner) {
    if ((await r.query('SELECT 1 FROM supplier_invoices LIMIT 1')).length)
      throw Error('Cannot discard supplier invoice history; restore the complete backup instead');
    const schema = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw Error('Unsupported invoice schema');
    const s = '"' + schema + '"';
    await r.query(
      `DROP TRIGGER protect_invoiced_receipt ON purchase_receipt_reversals;DROP FUNCTION ${s}.protect_invoiced_receipt();DROP FUNCTION ${s}.supplier_invoice_post(uuid,uuid,uuid,jsonb);DROP TABLE supplier_invoice_lines,supplier_invoices,supplier_invoice_state;DELETE FROM role_permissions WHERE permission_code IN('payables.read','payables.manage','payables.reverse');DELETE FROM permissions WHERE code IN('payables.read','payables.manage','payables.reverse');UPDATE app_schema_version SET version=7 WHERE singleton;`,
    );
  }
}
