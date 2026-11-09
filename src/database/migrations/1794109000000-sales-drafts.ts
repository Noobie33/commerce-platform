import type { MigrationInterface, QueryRunner } from 'typeorm';
export class SalesDrafts1794109000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    const name = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw Error('Unsupported sales schema');
    const s = '"' + name + '"';
    await r.query(`
 CREATE SEQUENCE sales_order_number;
 CREATE TABLE sales_orders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),number text NOT NULL UNIQUE,customer_id uuid NOT NULL REFERENCES customers(id),location_id uuid NOT NULL REFERENCES locations(id),
 channel text NOT NULL CHECK(channel IN('retail','wholesale')),status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','cancelled')),currency text NOT NULL DEFAULT 'BDT' CHECK(currency='BDT'),
 fulfill_on date,reference text NOT NULL DEFAULT '' CHECK(length(reference)<=100),notes text NOT NULL DEFAULT '' CHECK(length(notes)<=1000),price_reason text NOT NULL DEFAULT '' CHECK(length(price_reason)<=500),
 customer_snapshot jsonb NOT NULL CHECK(jsonb_typeof(customer_snapshot)='object'),total_minor bigint NOT NULL CHECK(total_minor BETWEEN 0 AND 99999999999999),
 version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 2147483646),created_by uuid NOT NULL REFERENCES staff_users(id),updated_by uuid NOT NULL REFERENCES staff_users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 cancelled_at timestamptz,cancellation_reason text NOT NULL DEFAULT '' CHECK(length(cancellation_reason)<=500),CHECK((status='draft' AND cancelled_at IS NULL AND cancellation_reason='') OR(status='cancelled' AND cancelled_at IS NOT NULL AND length(cancellation_reason)>0)));
 CREATE TABLE sales_order_lines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES sales_orders(id),variant_id uuid NOT NULL REFERENCES catalog_variants(id),sku text NOT NULL,product_name text NOT NULL,attributes jsonb NOT NULL CHECK(jsonb_typeof(attributes)='object'),
 quantity bigint NOT NULL CHECK(quantity BETWEEN 1 AND 999999999),catalog_price_minor bigint NOT NULL CHECK(catalog_price_minor BETWEEN 0 AND 999999999999),unit_price_minor bigint NOT NULL CHECK(unit_price_minor BETWEEN 0 AND 999999999999),price_mode text NOT NULL CHECK(price_mode IN('catalog','override')),
 line_total_minor bigint GENERATED ALWAYS AS(quantity*unit_price_minor) STORED CHECK(line_total_minor BETWEEN 0 AND 99999999999999),UNIQUE(order_id,variant_id),CHECK(price_mode='override' OR unit_price_minor=catalog_price_minor));
 CREATE INDEX sales_orders_created_idx ON sales_orders(created_at DESC,id DESC);CREATE INDEX sales_orders_customer_idx ON sales_orders(customer_id);
 CREATE TABLE sales_requests(key uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES staff_users(id),request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),order_id uuid NOT NULL REFERENCES sales_orders(id),response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 INSERT INTO permissions(code) VALUES('sales.read'),('sales.manage'),('sales.price_override');
 INSERT INTO role_permissions(role_id,permission_code) SELECT r.id,p.code FROM roles r CROSS JOIN permissions p WHERE r.code='owner' AND p.code IN('sales.read','sales.manage','sales.price_override');
 CREATE FUNCTION ${s}.sales_draft_save(save_key uuid,actor uuid,request_id uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
 DECLARE operation text;order_uuid uuid;previous ${s}.sales_orders%ROWTYPE;customer ${s}.customers%ROWTYPE;cached ${s}.sales_requests%ROWTYPE;entry record;item jsonb;variant_row record;hash text;revision integer;sequence_number text;order_number text;total numeric:=0;quantity bigint;price bigint;price_mode text;work jsonb:='[]';snapshot jsonb;response jsonb;has_override boolean:=false;date_value date;
 BEGIN
 IF save_key IS NULL OR actor IS NULL OR request_id IS NULL OR coalesce(jsonb_typeof(payload),'')<>'object' THEN RAISE EXCEPTION 'SALES_INVALID';END IF;
 operation:=payload->>'kind';IF operation IS NULL OR operation NOT IN('create','update','cancel') THEN RAISE EXCEPTION 'SALES_INVALID';END IF;
 IF NOT EXISTS(SELECT 1 FROM ${s}.staff_users u JOIN ${s}.staff_role_assignments a ON a.staff_id=u.id JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE u.id=actor AND u.is_active AND NOT u.must_change_password AND a.location_id IS NULL AND p.permission_code='sales.read') OR NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE a.staff_id=actor AND a.location_id IS NULL AND p.permission_code='sales.manage') THEN RAISE EXCEPTION 'SALES_PERMISSION';END IF;
 IF coalesce(jsonb_typeof(payload->'lines'),'')='array' AND EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'lines') x WHERE x->>'priceMode'='override') AND NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE a.staff_id=actor AND a.location_id IS NULL AND p.permission_code='sales.price_override') THEN RAISE EXCEPTION 'SALES_PRICE_PERMISSION';END IF;
 hash:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');PERFORM pg_advisory_xact_lock(hashtextextended('sales-request:'||save_key::text,11));SELECT * INTO cached FROM ${s}.sales_requests WHERE key=save_key;
 IF FOUND THEN IF cached.actor_id<>actor OR cached.request_hash<>hash THEN RAISE EXCEPTION 'SALES_IDEMPOTENCY';END IF;RETURN cached.response;END IF;
 IF operation<>'create' THEN
 IF coalesce(payload->>'expectedVersion','')!~'^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'SALES_INVALID';END IF;order_uuid:=(payload->>'id')::uuid;SELECT * INTO previous FROM ${s}.sales_orders WHERE id=order_uuid FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'SALES_NOT_FOUND';END IF;IF previous.version<>(payload->>'expectedVersion')::integer THEN RAISE EXCEPTION 'SALES_STALE';END IF;IF previous.status<>'draft' THEN RAISE EXCEPTION 'SALES_STATE';END IF;
 END IF;
 IF operation='cancel' THEN
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN('kind','id','expectedVersion','reason')) OR jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string' OR coalesce(length(btrim(payload->>'reason')),0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'SALES_INVALID';END IF;
 UPDATE ${s}.sales_orders SET status='cancelled',cancelled_at=now(),cancellation_reason=btrim(payload->>'reason'),version=version+1,updated_by=actor,updated_at=now() WHERE id=order_uuid RETURNING version INTO revision;
 ELSE
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN('kind','id','expectedVersion','customerId','customerVersion','locationId','channel','fulfillOn','reference','notes','priceReason','lines')) OR(operation='create' AND(payload?'id' OR payload?'expectedVersion')) THEN RAISE EXCEPTION 'SALES_INVALID';END IF;
 IF coalesce(payload->>'channel','') NOT IN('retail','wholesale') OR coalesce(payload->>'customerVersion','')!~'^[1-9][0-9]{0,9}$' OR jsonb_typeof(payload->'reference') IS DISTINCT FROM 'string' OR length(payload->>'reference')>100 OR jsonb_typeof(payload->'notes') IS DISTINCT FROM 'string' OR length(payload->>'notes')>1000 OR jsonb_typeof(payload->'priceReason') IS DISTINCT FROM 'string' OR length(payload->>'priceReason')>500 OR jsonb_typeof(payload->'lines') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'SALES_INVALID';END IF;
 IF jsonb_array_length(payload->'lines') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'SALES_INVALID';END IF;
 IF payload->'fulfillOn' IS NULL THEN RAISE EXCEPTION 'SALES_INVALID';END IF;
 IF payload->'fulfillOn'<>'null'::jsonb THEN IF jsonb_typeof(payload->'fulfillOn')<>'string' OR(payload->>'fulfillOn')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'SALES_INVALID';END IF;date_value:=(payload->>'fulfillOn')::date;IF date_value<'2000-01-01'::date OR date_value>'2100-12-31'::date THEN RAISE EXCEPTION 'SALES_INVALID';END IF;END IF;
 SELECT * INTO customer FROM ${s}.customers WHERE id=(payload->>'customerId')::uuid FOR SHARE;IF NOT FOUND OR NOT customer.is_active THEN RAISE EXCEPTION 'SALES_CUSTOMER_UNAVAILABLE';END IF;
 IF customer.version<>(payload->>'customerVersion')::integer THEN RAISE EXCEPTION 'SALES_CUSTOMER_STALE';END IF;IF customer.segment NOT IN(payload->>'channel','both') THEN RAISE EXCEPTION 'SALES_CUSTOMER_SEGMENT';END IF;
 PERFORM 1 FROM ${s}.locations WHERE id=(payload->>'locationId')::uuid AND is_active FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'SALES_LOCATION_UNAVAILABLE';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(payload->'lines') ORDER BY value->>'variantId' LOOP
 IF coalesce(jsonb_typeof(item),'')<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN('variantId','quantity','unitPrice','priceMode')) OR coalesce(item->>'quantity','')!~'^[1-9][0-9]{0,8}$' OR coalesce(item->>'unitPrice','')!~'^(0|[1-9][0-9]{0,11})$' OR coalesce(item->>'priceMode','') NOT IN('catalog','override') THEN RAISE EXCEPTION 'SALES_INVALID';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(work) x WHERE x->>'variantId'=item->>'variantId') THEN RAISE EXCEPTION 'SALES_INVALID';END IF;
 SELECT v.id,v.sku,v.price_minor,v.attributes,p.name FROM ${s}.catalog_variants v JOIN ${s}.catalog_products p ON p.id=v.product_id WHERE v.id=(item->>'variantId')::uuid AND v.is_active AND p.status='active' FOR SHARE OF v,p INTO variant_row;IF NOT FOUND THEN RAISE EXCEPTION 'SALES_VARIANT_UNAVAILABLE';END IF;
 quantity:=(item->>'quantity')::bigint;price:=(item->>'unitPrice')::bigint;price_mode:=item->>'priceMode';IF price_mode='catalog' AND price<>variant_row.price_minor THEN RAISE EXCEPTION 'SALES_PRICE_CHANGED';END IF;has_override:=has_override OR price_mode='override';total:=total+quantity::numeric*price;IF total>99999999999999 THEN RAISE EXCEPTION 'SALES_TOTAL_LIMIT';END IF;
 work:=work||jsonb_build_array(jsonb_build_object('variantId',variant_row.id,'sku',variant_row.sku,'productName',variant_row.name,'attributes',variant_row.attributes,'quantity',quantity::text,'unitPrice',price::text,'catalogPrice',variant_row.price_minor::text,'priceMode',price_mode));
 END LOOP;
 IF has_override AND length(btrim(payload->>'priceReason'))=0 THEN RAISE EXCEPTION 'SALES_INVALID';END IF;
 snapshot:=jsonb_build_object('id',customer.id,'code',customer.code,'name',customer.name,'version',customer.version,'customerKind',customer.kind,'segment',customer.segment,'contactName',customer.contact_name,'phone',customer.phone,'email',customer.email,'billingAddress',customer.billing_address,'deliveryAddress',customer.delivery_address);
 IF operation='create' THEN
 sequence_number:=nextval('${s}.sales_order_number'::regclass)::text;order_number:='SO-'||repeat('0',greatest(0,10-length(sequence_number)))||sequence_number;
 INSERT INTO ${s}.sales_orders(number,customer_id,location_id,channel,fulfill_on,reference,notes,price_reason,customer_snapshot,total_minor,created_by,updated_by) VALUES(order_number,customer.id,(payload->>'locationId')::uuid,payload->>'channel',date_value,payload->>'reference',payload->>'notes',CASE WHEN has_override THEN btrim(payload->>'priceReason') ELSE '' END,snapshot,total::bigint,actor,actor) RETURNING id,version INTO order_uuid,revision;
 ELSE
 UPDATE ${s}.sales_orders SET customer_id=customer.id,location_id=(payload->>'locationId')::uuid,channel=payload->>'channel',fulfill_on=date_value,reference=payload->>'reference',notes=payload->>'notes',price_reason=CASE WHEN has_override THEN btrim(payload->>'priceReason') ELSE '' END,customer_snapshot=snapshot,total_minor=total::bigint,version=version+1,updated_by=actor,updated_at=now() WHERE id=order_uuid RETURNING version INTO revision;
 DELETE FROM ${s}.sales_order_lines WHERE order_id=order_uuid;
 END IF;
 INSERT INTO ${s}.sales_order_lines(order_id,variant_id,sku,product_name,attributes,quantity,catalog_price_minor,unit_price_minor,price_mode) SELECT order_uuid,(x->>'variantId')::uuid,x->>'sku',x->>'productName',x->'attributes',(x->>'quantity')::bigint,(x->>'catalogPrice')::bigint,(x->>'unitPrice')::bigint,x->>'priceMode' FROM jsonb_array_elements(work) x;
 END IF;
 response:=jsonb_build_object('id',order_uuid,'version',revision,'kind',operation);
 INSERT INTO ${s}.audit_events(actor_id,action,request_id,metadata) VALUES(actor,CASE operation WHEN 'create' THEN 'sales.draft_created' WHEN 'update' THEN 'sales.draft_updated' ELSE 'sales.draft_cancelled' END,request_id,jsonb_build_object('entityId',order_uuid,'version',revision));
 INSERT INTO ${s}.sales_requests(key,actor_id,request_hash,order_id,response) VALUES(save_key,actor,hash,order_uuid,response);RETURN response;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation OR datetime_field_overflow OR invalid_datetime_format OR invalid_parameter_value THEN RAISE EXCEPTION 'SALES_INVALID';END;$f$;
 REVOKE ALL ON FUNCTION ${s}.sales_draft_save(uuid,uuid,uuid,jsonb) FROM PUBLIC;
 UPDATE app_schema_version SET version=11 WHERE singleton;`);
  }
  async down(r: QueryRunner) {
    if ((await r.query('SELECT 1 FROM sales_orders LIMIT 1')).length)
      throw Error('Cannot discard sales order history; restore the complete backup instead');
    const name = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw Error('Unsupported sales schema');
    await r.query(
      'DROP FUNCTION "' +
        name +
        "\".sales_draft_save(uuid,uuid,uuid,jsonb);DROP TABLE sales_requests,sales_order_lines,sales_orders;DROP SEQUENCE sales_order_number;DELETE FROM role_permissions WHERE permission_code IN('sales.read','sales.manage','sales.price_override');DELETE FROM permissions WHERE code IN('sales.read','sales.manage','sales.price_override');UPDATE app_schema_version SET version=10 WHERE singleton;",
    );
  }
}
