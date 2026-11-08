import type { MigrationInterface, QueryRunner } from 'typeorm';
export class SupplierPayments1794107000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    const schema = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw Error('Unsupported payment schema');
    const s = '"' + schema + '"';
    await r.query(`
 CREATE TABLE supplier_payment_state(supplier_id uuid PRIMARY KEY REFERENCES purchasing_suppliers(id),version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646));
 CREATE TABLE supplier_payments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),supplier_id uuid NOT NULL REFERENCES purchasing_suppliers(id),supplier_name text NOT NULL CHECK(length(supplier_name) BETWEEN 1 AND 140),
 paid_on date NOT NULL CHECK(paid_on BETWEEN DATE '2000-01-01' AND DATE '2199-12-31'),method text NOT NULL CHECK(method IN('cash','bank','mobile')),
 source text NOT NULL CHECK(length(source) BETWEEN 1 AND 100),reference text NOT NULL CHECK(length(reference) BETWEEN 1 AND 100 AND reference=btrim(reference)),
 currency text NOT NULL DEFAULT 'BDT' CHECK(currency='BDT'),amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 99999999999999),reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
 actor_id uuid NOT NULL REFERENCES staff_users(id),created_at timestamptz NOT NULL DEFAULT now(),reversed_at timestamptz,reversed_by uuid REFERENCES staff_users(id),reversal_reason text NOT NULL DEFAULT '' CHECK(length(reversal_reason)<=500),
 CHECK((reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason='') OR(reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND length(reversal_reason)>0)));
 CREATE UNIQUE INDEX supplier_payment_reference_active_ux ON supplier_payments(lower(reference)) WHERE reversed_at IS NULL;
 CREATE INDEX supplier_payments_supplier_idx ON supplier_payments(supplier_id,created_at DESC,id DESC);
 CREATE TABLE supplier_payment_allocations(payment_id uuid NOT NULL REFERENCES supplier_payments(id),invoice_id uuid NOT NULL REFERENCES supplier_invoices(id),amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 99999999999999),PRIMARY KEY(payment_id,invoice_id));
 CREATE INDEX supplier_payment_invoice_idx ON supplier_payment_allocations(invoice_id,payment_id);
 CREATE VIEW supplier_invoice_balances WITH(security_invoker=true) AS
 SELECT i.id AS invoice_id,coalesce(a.paid,0)::bigint AS paid_minor,CASE WHEN i.reversed_at IS NULL THEN i.total_minor-coalesce(a.paid,0) ELSE 0 END::bigint AS remaining_minor
 FROM supplier_invoices i LEFT JOIN(SELECT a.invoice_id,sum(a.amount_minor) AS paid FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id=a.payment_id WHERE p.reversed_at IS NULL GROUP BY a.invoice_id) a ON a.invoice_id=i.id;
 INSERT INTO permissions(code) VALUES('payables.pay'),('payables.reverse_payment');
 INSERT INTO role_permissions(role_id,permission_code) SELECT r.id,p.code FROM roles r CROSS JOIN permissions p WHERE r.code='owner' AND p.code IN('payables.pay','payables.reverse_payment');
 CREATE FUNCTION ${s}.protect_paid_invoice() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
 BEGIN
 IF OLD.reversed_at IS NULL AND NEW.reversed_at IS NOT NULL AND EXISTS(SELECT 1 FROM ${s}.supplier_payment_allocations a JOIN ${s}.supplier_payments p ON p.id=a.payment_id WHERE a.invoice_id=OLD.id AND p.reversed_at IS NULL) THEN RAISE EXCEPTION 'INVOICE_HAS_PAYMENTS';END IF;
 RETURN NEW;END;$f$;
 REVOKE ALL ON FUNCTION ${s}.protect_paid_invoice() FROM PUBLIC;
 CREATE TRIGGER protect_paid_invoice BEFORE UPDATE OF reversed_at ON supplier_invoices FOR EACH ROW EXECUTE FUNCTION ${s}.protect_paid_invoice();
 CREATE FUNCTION ${s}.supplier_payment_post(save_key uuid,actor uuid,request_id uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
 DECLARE operation text;supplier_uuid uuid;payment_uuid uuid;original ${s}.supplier_payments%ROWTYPE;cached ${s}.purchasing_requests%ROWTYPE;revision integer;expected integer;hash text;reason_text text;reference_text text;source_text text;method_text text;payment_date date;amount bigint;allocated numeric:=0;entry jsonb;invoice_uuid uuid;part bigint;remaining bigint;invoice ${s}.supplier_invoices%ROWTYPE;order_uuid uuid;supplier_name_text text;response jsonb;
 BEGIN
 IF save_key IS NULL OR actor IS NULL OR request_id IS NULL OR coalesce(jsonb_typeof(payload),'')<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN('kind','supplierId','paymentId','expectedRevision','paidOn','method','source','reference','amount','reason','allocations')) THEN RAISE EXCEPTION 'PAYMENT_INVALID';END IF;
 operation:=payload->>'kind';reason_text:=btrim(payload->>'reason');
 IF operation IS NULL OR operation NOT IN('payment','reversePayment') OR reason_text IS NULL OR length(reason_text) NOT BETWEEN 1 AND 500 OR coalesce(payload->>'expectedRevision','')!~'^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'PAYMENT_INVALID';END IF;
 expected:=(payload->>'expectedRevision')::integer;
 IF NOT EXISTS(SELECT 1 FROM ${s}.staff_users u JOIN ${s}.staff_role_assignments a ON a.staff_id=u.id JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE u.id=actor AND u.is_active AND NOT u.must_change_password AND a.location_id IS NULL AND p.permission_code='payables.read')
 OR NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE a.staff_id=actor AND a.location_id IS NULL AND p.permission_code='purchasing.read')
 OR NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE a.staff_id=actor AND a.location_id IS NULL AND p.permission_code=CASE WHEN operation='payment' THEN 'payables.pay' ELSE 'payables.reverse_payment' END)
 THEN RAISE EXCEPTION 'PAYMENT_PERMISSION';END IF;
 hash:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('purchasing-request:'||save_key::text,6));
 SELECT * INTO cached FROM ${s}.purchasing_requests WHERE key=save_key;
 IF FOUND THEN IF cached.actor_id<>actor OR cached.request_hash<>hash THEN RAISE EXCEPTION 'INVENTORY_IDEMPOTENCY_MISMATCH';END IF;RETURN cached.response;END IF;
 IF operation='reversePayment' THEN
 payment_uuid:=(payload->>'paymentId')::uuid;SELECT * INTO original FROM ${s}.supplier_payments WHERE id=payment_uuid;IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_NOT_FOUND';END IF;supplier_uuid:=original.supplier_id;
 ELSE supplier_uuid:=(payload->>'supplierId')::uuid;END IF;
 SELECT name INTO supplier_name_text FROM ${s}.purchasing_suppliers WHERE id=supplier_uuid;IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_NOT_FOUND';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier-payments:'||supplier_uuid::text,9));
 INSERT INTO ${s}.supplier_payment_state(supplier_id,version) VALUES(supplier_uuid,1) ON CONFLICT DO NOTHING;
 SELECT version INTO revision FROM ${s}.supplier_payment_state WHERE supplier_id=supplier_uuid FOR UPDATE;
 IF revision<>expected THEN RAISE EXCEPTION 'PAYMENT_STALE';END IF;
 IF operation='payment' THEN
 reference_text:=btrim(payload->>'reference');source_text:=btrim(payload->>'source');method_text:=payload->>'method';
 IF reference_text IS NULL OR length(reference_text) NOT BETWEEN 1 AND 100 OR source_text IS NULL OR length(source_text) NOT BETWEEN 1 AND 100 OR method_text IS NULL OR method_text NOT IN('cash','bank','mobile') OR coalesce(payload->>'paidOn','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR coalesce(payload->>'amount','')!~'^[1-9][0-9]{0,13}$' THEN RAISE EXCEPTION 'PAYMENT_INVALID';END IF;
 payment_date:=(payload->>'paidOn')::date;amount:=(payload->>'amount')::bigint;
 IF payment_date<DATE '2000-01-01' OR payment_date>(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date THEN RAISE EXCEPTION 'PAYMENT_DATE';END IF;
 IF coalesce(jsonb_typeof(payload->'allocations'),'')<>'array' OR jsonb_array_length(payload->'allocations') NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'PAYMENT_INVALID';END IF;
 IF (SELECT count(DISTINCT(value->>'invoiceId')::uuid) FROM jsonb_array_elements(payload->'allocations'))<>jsonb_array_length(payload->'allocations') THEN RAISE EXCEPTION 'PAYMENT_INVALID';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(payload->'allocations') LOOP
 IF jsonb_typeof(entry)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(entry) k WHERE k NOT IN('invoiceId','amount')) OR coalesce(entry->>'amount','')!~'^[1-9][0-9]{0,13}$' THEN RAISE EXCEPTION 'PAYMENT_INVALID';END IF;
 END LOOP;
 -- Stable PO order matches the invoice posting/reversal boundary across consolidated payments.
 FOR order_uuid IN SELECT DISTINCT i.order_id FROM ${s}.supplier_invoices i JOIN jsonb_array_elements(payload->'allocations') a ON i.id=(a.value->>'invoiceId')::uuid ORDER BY i.order_id LOOP
 PERFORM 1 FROM ${s}.purchase_orders WHERE id=order_uuid FOR UPDATE;
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(payload->'allocations') ORDER BY value->>'invoiceId' LOOP
 invoice_uuid:=(entry->>'invoiceId')::uuid;part:=(entry->>'amount')::bigint;
 SELECT * INTO invoice FROM ${s}.supplier_invoices WHERE id=invoice_uuid FOR UPDATE;
 IF NOT FOUND OR invoice.supplier_id<>supplier_uuid OR invoice.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'PAYMENT_INVOICE_UNAVAILABLE';END IF;
 IF payment_date<invoice.invoice_on THEN RAISE EXCEPTION 'PAYMENT_DATE';END IF;
 SELECT invoice.total_minor-coalesce(sum(a.amount_minor),0) INTO remaining FROM ${s}.supplier_payment_allocations a JOIN ${s}.supplier_payments p ON p.id=a.payment_id WHERE a.invoice_id=invoice_uuid AND p.reversed_at IS NULL;
 IF part>remaining THEN RAISE EXCEPTION 'PAYMENT_EXCEEDS_DUE';END IF;allocated:=allocated+part;
 END LOOP;
 IF allocated<>amount THEN RAISE EXCEPTION 'PAYMENT_ALLOCATION_TOTAL';END IF;
 INSERT INTO ${s}.supplier_payments(supplier_id,supplier_name,paid_on,method,source,reference,amount_minor,reason,actor_id) VALUES(supplier_uuid,supplier_name_text,payment_date,method_text,source_text,reference_text,amount,reason_text,actor) RETURNING id INTO payment_uuid;
 FOR entry IN SELECT value FROM jsonb_array_elements(payload->'allocations') LOOP
 INSERT INTO ${s}.supplier_payment_allocations(payment_id,invoice_id,amount_minor) VALUES(payment_uuid,(entry->>'invoiceId')::uuid,(entry->>'amount')::bigint);
 END LOOP;
 ELSE
 SELECT * INTO original FROM ${s}.supplier_payments WHERE id=payment_uuid FOR UPDATE;
 IF original.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'PAYMENT_REVERSED';END IF;
 FOR order_uuid IN SELECT DISTINCT i.order_id FROM ${s}.supplier_payment_allocations a JOIN ${s}.supplier_invoices i ON i.id=a.invoice_id WHERE a.payment_id=payment_uuid ORDER BY i.order_id LOOP
 PERFORM 1 FROM ${s}.purchase_orders WHERE id=order_uuid FOR UPDATE;
 END LOOP;
 UPDATE ${s}.supplier_payments SET reversed_at=now(),reversed_by=actor,reversal_reason=reason_text WHERE id=payment_uuid;
 END IF;
 UPDATE ${s}.supplier_payment_state SET version=version+1 WHERE supplier_id=supplier_uuid RETURNING version INTO revision;
 response:=jsonb_build_object('paymentId',payment_uuid,'supplierId',supplier_uuid,'paymentRevision',revision,'kind',operation);
 INSERT INTO ${s}.audit_events(actor_id,action,request_id,metadata) VALUES(actor,CASE WHEN operation='payment' THEN 'payables.payment_recorded' ELSE 'payables.payment_reversed' END,request_id,jsonb_build_object('entityId',payment_uuid,'supplierId',supplier_uuid,'version',revision));
 INSERT INTO ${s}.purchasing_requests(key,actor_id,request_hash,supplier_id,response) VALUES(save_key,actor,hash,supplier_uuid,response);
 RETURN response;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'PAYMENT_INVALID';
 WHEN unique_violation THEN RAISE EXCEPTION 'PAYMENT_REFERENCE_EXISTS';
 END;$f$;
 REVOKE ALL ON FUNCTION ${s}.supplier_payment_post(uuid,uuid,uuid,jsonb) FROM PUBLIC;
 UPDATE app_schema_version SET version=9 WHERE singleton;
 `);
  }
  async down(r: QueryRunner) {
    if ((await r.query('SELECT 1 FROM supplier_payments LIMIT 1')).length)
      throw Error('Cannot discard supplier payment history; restore the complete backup instead');
    const schema = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw Error('Unsupported payment schema');
    const s = '"' + schema + '"';
    await r.query(
      `DROP TRIGGER protect_paid_invoice ON supplier_invoices;DROP FUNCTION ${s}.protect_paid_invoice();DROP FUNCTION ${s}.supplier_payment_post(uuid,uuid,uuid,jsonb);DROP VIEW supplier_invoice_balances;DROP TABLE supplier_payment_allocations,supplier_payments,supplier_payment_state;DELETE FROM role_permissions WHERE permission_code IN('payables.pay','payables.reverse_payment');DELETE FROM permissions WHERE code IN('payables.pay','payables.reverse_payment');UPDATE app_schema_version SET version=8 WHERE singleton;`,
    );
  }
}
