import type { MigrationInterface, QueryRunner } from 'typeorm';
export class InventoryFoundation1794103000000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    const name = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw Error('Unsupported inventory schema');
    const schema = '"' + name + '"';
    await r.query(`
 ALTER TABLE locations ADD COLUMN kind text NOT NULL DEFAULT 'warehouse' CHECK(kind IN ('warehouse','store'));
 CREATE TABLE inventory_postings(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN ('opening','receipt','adjustment','transfer','reversal')),
  location_id uuid NOT NULL REFERENCES locations(id),destination_id uuid REFERENCES locations(id),
  reversal_of uuid UNIQUE REFERENCES inventory_postings(id),actor_id uuid NOT NULL REFERENCES staff_users(id),
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),reference text NOT NULL DEFAULT '' CHECK(length(reference)<=100),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(destination_id IS NULL OR destination_id<>location_id),
  CHECK((kind='transfer' AND destination_id IS NOT NULL AND reversal_of IS NULL) OR (kind='reversal' AND reversal_of IS NOT NULL) OR (kind IN ('opening','receipt','adjustment') AND destination_id IS NULL AND reversal_of IS NULL))
 );
 CREATE TABLE inventory_balances(
  location_id uuid NOT NULL REFERENCES locations(id),variant_id uuid NOT NULL REFERENCES catalog_variants(id),
  quantity bigint NOT NULL CHECK(quantity BETWEEN 0 AND 1000000000000),
  PRIMARY KEY(location_id,variant_id)
 );
 CREATE TABLE inventory_entries(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),posting_id uuid NOT NULL REFERENCES inventory_postings(id),
  location_id uuid NOT NULL REFERENCES locations(id),variant_id uuid NOT NULL REFERENCES catalog_variants(id),
  sku text NOT NULL,product_name text NOT NULL,
  delta bigint NOT NULL CHECK(delta<>0 AND delta BETWEEN -999999999 AND 999999999),
  quantity_before bigint NOT NULL CHECK(quantity_before BETWEEN 0 AND 1000000000000),
  quantity_after bigint NOT NULL CHECK(quantity_after BETWEEN 0 AND 1000000000000),
  CHECK(quantity_after=quantity_before+delta),UNIQUE(posting_id,location_id,variant_id)
 );
 CREATE INDEX inventory_entries_location_variant_idx ON inventory_entries(location_id,variant_id);
 CREATE INDEX inventory_postings_time_idx ON inventory_postings(created_at DESC,id DESC);
 CREATE TABLE inventory_requests(
  key uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES staff_users(id),request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  posting_id uuid NOT NULL REFERENCES inventory_postings(id),response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
 );
 INSERT INTO permissions(code) VALUES('locations.manage'),('inventory.read'),('inventory.receive'),('inventory.adjust'),('inventory.transfer');
 INSERT INTO role_permissions(role_id,permission_code) SELECT r.id,p.code FROM roles r CROSS JOIN permissions p WHERE r.code='owner' AND p.code IN ('locations.manage','inventory.read','inventory.receive','inventory.adjust','inventory.transfer');
 UPDATE app_schema_version SET version=5 WHERE singleton;
 `);
    const functions = `
 CREATE FUNCTION __S__.inventory_permitted(actor uuid,action text,location uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $permission$
 SELECT EXISTS(SELECT 1 FROM __S__.staff_users u JOIN __S__.staff_role_assignments a ON a.staff_id=u.id JOIN __S__.role_permissions rp ON rp.role_id=a.role_id
 JOIN __S__.locations l ON l.id=location AND l.is_active
 WHERE u.id=actor AND u.is_active AND NOT u.must_change_password AND rp.permission_code=action AND (a.location_id IS NULL OR a.location_id=location));
 $permission$;
 REVOKE ALL ON FUNCTION __S__.inventory_permitted(uuid,text,uuid) FROM PUBLIC;
 CREATE FUNCTION __S__.inventory_post(save_key uuid,actor uuid,request_id uuid,payload jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $posting$
 DECLARE
  operation text; permission_code text; source_id uuid; destination uuid; reversal_id uuid;
  original __S__.inventory_postings%ROWTYPE;
  cached __S__.inventory_requests%ROWTYPE;
  hash text; reason_text text; reference_text text; work jsonb:='[]'; item jsonb;
  product_record record; loc uuid; variant uuid; amount bigint; before_qty bigint; after_qty bigint;
  posting uuid; response jsonb; happened timestamptz; location_count integer;
 BEGIN
  IF save_key IS NULL OR actor IS NULL OR request_id IS NULL OR jsonb_typeof(payload)<>'object' THEN RAISE EXCEPTION 'INVENTORY_INVALID_INPUT'; END IF;
  operation:=payload->>'kind';reason_text:=btrim(payload->>'reason');reference_text:=coalesce(payload->>'reference','');
  IF operation IS NULL OR operation NOT IN ('opening','receipt','adjustment','transfer','reversal') OR reason_text IS NULL OR length(reason_text) NOT BETWEEN 1 AND 500 OR length(reference_text)>100 THEN RAISE EXCEPTION 'INVENTORY_INVALID_INPUT'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN ('kind','locationId','destinationId','reversalOf','reason','reference','lines')) THEN RAISE EXCEPTION 'INVENTORY_INVALID_INPUT'; END IF;
  IF operation='reversal' THEN
   reversal_id:=(payload->>'reversalOf')::uuid;
   SELECT * INTO original FROM __S__.inventory_postings WHERE id=reversal_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_POSTING_NOT_FOUND'; END IF;
   IF original.kind='reversal' THEN RAISE EXCEPTION 'INVENTORY_REVERSE_REVERSAL'; END IF;
   source_id:=coalesce(original.destination_id,original.location_id);
   IF original.destination_id IS NOT NULL THEN destination:=original.location_id; END IF;
   permission_code:=CASE WHEN original.kind='transfer' THEN 'inventory.transfer' ELSE 'inventory.adjust' END;
   SELECT jsonb_agg(jsonb_build_object('locationId',e.location_id,'variantId',e.variant_id,'delta',(-e.delta)::text)) INTO work FROM __S__.inventory_entries e WHERE e.posting_id=reversal_id;
  ELSE
   source_id:=(payload->>'locationId')::uuid;
   destination:=nullif(payload->>'destinationId','')::uuid;
   IF source_id IS NULL OR (operation='transfer' AND (destination IS NULL OR source_id=destination)) OR (operation<>'transfer' AND destination IS NOT NULL) OR payload ? 'reversalOf' THEN RAISE EXCEPTION 'INVENTORY_INVALID_INPUT'; END IF;
   permission_code:=CASE WHEN operation IN ('opening','receipt') THEN 'inventory.receive' WHEN operation='adjustment' THEN 'inventory.adjust' ELSE 'inventory.transfer' END;
   IF coalesce(jsonb_typeof(payload->'lines'),'')<>'array' THEN RAISE EXCEPTION 'INVENTORY_INVALID_INPUT'; END IF;
   IF jsonb_array_length(payload->'lines') NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'INVENTORY_INVALID_INPUT'; END IF;
   IF (SELECT count(DISTINCT value->>'variantId') FROM jsonb_array_elements(payload->'lines'))<>jsonb_array_length(payload->'lines') THEN RAISE EXCEPTION 'INVENTORY_INVALID_INPUT'; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(payload->'lines') LOOP
    IF jsonb_typeof(item)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('variantId','quantity')) OR coalesce(item->>'quantity','') !~ '^-?[1-9][0-9]{0,8}$' THEN RAISE EXCEPTION 'INVENTORY_INVALID_INPUT'; END IF;
    variant:=(item->>'variantId')::uuid;amount:=(item->>'quantity')::bigint;
    IF variant IS NULL OR (operation<>'adjustment' AND amount<=0) THEN RAISE EXCEPTION 'INVENTORY_INVALID_INPUT'; END IF;
    work:=work||jsonb_build_array(jsonb_build_object('locationId',source_id,'variantId',variant,'delta',(CASE WHEN operation='transfer' THEN -amount ELSE amount END)::text));
    IF operation='transfer' THEN work:=work||jsonb_build_array(jsonb_build_object('locationId',destination,'variantId',variant,'delta',amount::text)); END IF;
   END LOOP;
  END IF;
  IF work IS NULL OR jsonb_array_length(work) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVENTORY_INVALID_INPUT'; END IF;
  IF NOT __S__.inventory_permitted(actor,'inventory.read',source_id) OR NOT __S__.inventory_permitted(actor,permission_code,source_id)
   OR (destination IS NOT NULL AND (NOT __S__.inventory_permitted(actor,'inventory.read',destination) OR NOT __S__.inventory_permitted(actor,permission_code,destination))) THEN RAISE EXCEPTION 'INVENTORY_PERMISSION'; END IF;
  hash:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('inventory-request:'||save_key::text,4));
  SELECT * INTO cached FROM __S__.inventory_requests WHERE key=save_key;
  IF FOUND THEN IF cached.actor_id<>actor OR cached.request_hash<>hash THEN RAISE EXCEPTION 'INVENTORY_IDEMPOTENCY_MISMATCH'; END IF; RETURN cached.response; END IF;
  IF operation='reversal' THEN
   PERFORM 1 FROM __S__.inventory_postings WHERE id=reversal_id FOR UPDATE;
   IF EXISTS(SELECT 1 FROM __S__.inventory_postings WHERE reversal_of=reversal_id) THEN RAISE EXCEPTION 'INVENTORY_ALREADY_REVERSED'; END IF;
  END IF;
  PERFORM 1 FROM __S__.locations WHERE id=source_id AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_LOCATION_INACTIVE'; END IF;
  IF destination IS NOT NULL THEN PERFORM 1 FROM __S__.locations WHERE id=destination AND is_active FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_LOCATION_INACTIVE'; END IF; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(work) ORDER BY value->>'locationId',value->>'variantId' LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('inventory-balance:'||(item->>'locationId')||':'||(item->>'variantId'),4));
  END LOOP;
  INSERT INTO __S__.inventory_postings(kind,location_id,destination_id,reversal_of,actor_id,reason,reference)
   VALUES(operation,source_id,destination,reversal_id,actor,reason_text,reference_text) RETURNING id,created_at INTO posting,happened;
  FOR item IN SELECT value FROM jsonb_array_elements(work) ORDER BY value->>'locationId',value->>'variantId' LOOP
   loc:=(item->>'locationId')::uuid;variant:=(item->>'variantId')::uuid;amount:=(item->>'delta')::bigint;
   SELECT v.sku,v.is_active,p.name,p.status INTO product_record FROM __S__.catalog_variants v JOIN __S__.catalog_products p ON p.id=v.product_id WHERE v.id=variant;
   IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_VARIANT_NOT_FOUND'; END IF;
   IF operation IN ('opening','receipt') AND (NOT product_record.is_active OR product_record.status='archived') THEN RAISE EXCEPTION 'INVENTORY_VARIANT_INACTIVE'; END IF;
   IF operation='opening' AND EXISTS(SELECT 1 FROM __S__.inventory_entries WHERE location_id=loc AND variant_id=variant) THEN RAISE EXCEPTION 'INVENTORY_OPENING_EXISTS'; END IF;
   INSERT INTO __S__.inventory_balances(location_id,variant_id,quantity) VALUES(loc,variant,0) ON CONFLICT DO NOTHING;
   SELECT quantity INTO before_qty FROM __S__.inventory_balances WHERE location_id=loc AND variant_id=variant FOR UPDATE;
   after_qty:=before_qty+amount;
   IF after_qty<0 THEN RAISE EXCEPTION 'INVENTORY_INSUFFICIENT'; END IF;
   IF after_qty>1000000000000 THEN RAISE EXCEPTION 'INVENTORY_QUANTITY_LIMIT'; END IF;
   UPDATE __S__.inventory_balances SET quantity=after_qty WHERE location_id=loc AND variant_id=variant;
   INSERT INTO __S__.inventory_entries(posting_id,location_id,variant_id,sku,product_name,delta,quantity_before,quantity_after)
    VALUES(posting,loc,variant,product_record.sku,product_record.name,amount,before_qty,after_qty);
  END LOOP;
  SELECT jsonb_build_object('id',posting,'kind',operation,'locationId',source_id,'destinationId',destination,'reversalOf',reversal_id,'reason',reason_text,'reference',reference_text,'createdAt',happened,
   'lines',(SELECT jsonb_agg(jsonb_build_object('variantId',e.variant_id,'locationId',e.location_id,'sku',e.sku,'productName',e.product_name,'delta',e.delta::text,'quantityBefore',e.quantity_before::text,'quantityAfter',e.quantity_after::text) ORDER BY e.location_id,e.sku) FROM __S__.inventory_entries e WHERE e.posting_id=posting)) INTO response;
  INSERT INTO __S__.audit_events(actor_id,action,request_id,metadata) VALUES(actor,'inventory.posted',request_id,jsonb_build_object('postingId',posting,'kind',operation,'locationId',source_id,'destinationId',destination,'reversalOf',reversal_id,'lineCount',jsonb_array_length(work)));
  INSERT INTO __S__.inventory_requests(key,actor_id,request_hash,posting_id,response) VALUES(save_key,actor,hash,posting,response);
  RETURN response;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'INVENTORY_INVALID_INPUT';
 END;
 $posting$;
 REVOKE ALL ON FUNCTION __S__.inventory_post(uuid,uuid,uuid,jsonb) FROM PUBLIC;
 `;
    await r.query(functions.replaceAll('__S__', schema));
  }
  async down(r: QueryRunner): Promise<void> {
    if ((await r.query('SELECT 1 FROM inventory_postings LIMIT 1')).length)
      throw Error('Cannot drop posted inventory history; restore the complete backup instead');
    const name = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw Error('Unsupported inventory schema');
    const s = '"' + name + '"';
    await r.query(
      'DROP FUNCTION ' +
        s +
        '.inventory_post(uuid,uuid,uuid,jsonb); DROP FUNCTION ' +
        s +
        '.inventory_permitted(uuid,text,uuid)',
    );
    await r.query(
      "DROP TABLE inventory_requests,inventory_entries,inventory_balances,inventory_postings; ALTER TABLE locations DROP COLUMN kind; DELETE FROM role_permissions WHERE permission_code IN ('locations.manage','inventory.read','inventory.receive','inventory.adjust','inventory.transfer'); DELETE FROM permissions WHERE code IN ('locations.manage','inventory.read','inventory.receive','inventory.adjust','inventory.transfer'); UPDATE app_schema_version SET version=4 WHERE singleton",
    );
  }
}
