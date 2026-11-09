// Immutable SQL for migration 17. Future semantic changes require a new migration.
export function merchandisingV1(s: string) {
  return `
CREATE TABLE ${s}.catalog_merch_items(
 id uuid PRIMARY KEY,kind text NOT NULL CHECK(kind IN('size_guide','collection')),slug text NOT NULL CHECK(length(slug) BETWEEN 1 AND 120 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),UNIQUE(kind,slug),UNIQUE(id,kind));
CREATE FUNCTION ${s}.catalog_merch_valid(kind text,d jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
DECLARE x jsonb;v jsonb;labels text[]:='{}';names text[]:='{}';n integer;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR jsonb_typeof(d->'title') IS DISTINCT FROM 'string' OR length(btrim(d->>'title')) NOT BETWEEN 1 AND 120 OR (d->>'title') ~ '[[:cntrl:]]' OR jsonb_typeof(d->'active') IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;
 IF kind='collection' THEN RETURN NOT EXISTS(SELECT 1 FROM jsonb_object_keys(d) k WHERE k NOT IN('title','active','description')) AND jsonb_typeof(d->'description')='string' AND length(d->>'description')<=1000;END IF;
 IF kind<>'size_guide' OR EXISTS(SELECT 1 FROM jsonb_object_keys(d) k WHERE k NOT IN('title','active','unit','basis','instructions','columns','rows')) OR coalesce(d->>'unit','') NOT IN('cm','in') OR coalesce(d->>'basis','') NOT IN('garment','body') OR jsonb_typeof(d->'instructions') IS DISTINCT FROM 'string' OR length(d->>'instructions')>1000 OR jsonb_typeof(d->'columns') IS DISTINCT FROM 'array' OR jsonb_typeof(d->'rows') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
 n:=jsonb_array_length(d->'columns');IF n NOT BETWEEN 1 AND 8 OR jsonb_array_length(d->'rows') NOT BETWEEN 1 AND 30 THEN RETURN false;END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(d->'columns') LOOP IF jsonb_typeof(x)<>'string' OR length(btrim(x#>>'{}')) NOT BETWEEN 1 AND 40 OR (x#>>'{}') ~ '[[:cntrl:]]' OR lower(btrim(x#>>'{}'))=ANY(labels) THEN RETURN false;END IF;labels:=array_append(labels,lower(btrim(x#>>'{}')));END LOOP;
 FOR x IN SELECT * FROM jsonb_array_elements(d->'rows') LOOP
  IF jsonb_typeof(x)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN('size','values')) OR jsonb_typeof(x->'size') IS DISTINCT FROM 'string' OR length(btrim(x->>'size')) NOT BETWEEN 1 AND 30 OR (x->>'size') ~ '[[:cntrl:]]' OR lower(btrim(x->>'size'))=ANY(names) OR jsonb_typeof(x->'values') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
  names:=array_append(names,lower(btrim(x->>'size')));IF jsonb_array_length(x->'values')<>n THEN RETURN false;END IF;
  FOR v IN SELECT * FROM jsonb_array_elements(x->'values') LOOP IF jsonb_typeof(v)<>'string' OR (v#>>'{}')!~'^(0|[1-9][0-9]{0,3})(\\.[0-9]{1,2})?$' THEN RETURN false;END IF;IF (v#>>'{}')::numeric<=0 THEN RETURN false;END IF;END LOOP;
 END LOOP;RETURN true;
END;$f$;
CREATE TABLE ${s}.catalog_merch_versions(item_id uuid NOT NULL REFERENCES ${s}.catalog_merch_items(id),version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),kind text NOT NULL,definition jsonb NOT NULL CHECK(${s}.catalog_merch_valid(kind,definition) IS TRUE),actor_id uuid NOT NULL REFERENCES ${s}.staff_users(id),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(item_id,version),FOREIGN KEY(item_id,kind) REFERENCES ${s}.catalog_merch_items(id,kind));
ALTER TABLE ${s}.catalog_merch_items ADD CONSTRAINT merch_current_version FOREIGN KEY(id,version) REFERENCES ${s}.catalog_merch_versions(item_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE ${s}.catalog_merch_links(product_id uuid NOT NULL REFERENCES ${s}.catalog_products(id),item_id uuid NOT NULL,item_version integer NOT NULL,kind text NOT NULL,PRIMARY KEY(product_id,item_id),FOREIGN KEY(item_id,item_version) REFERENCES ${s}.catalog_merch_versions(item_id,version),FOREIGN KEY(item_id,kind) REFERENCES ${s}.catalog_merch_items(id,kind));
CREATE UNIQUE INDEX merch_one_guide ON ${s}.catalog_merch_links(product_id) WHERE kind='size_guide';
CREATE INDEX merch_link_item ON ${s}.catalog_merch_links(item_id,product_id);
CREATE TABLE ${s}.catalog_merch_requests(key uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES ${s}.staff_users(id),namespace text NOT NULL CHECK(namespace IN('library','content')),request_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION ${s}.catalog_merch_post(save_key uuid,actor uuid,request_id uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE cached ${s}.catalog_merch_requests%ROWTYPE;prior ${s}.catalog_merch_items%ROWTYPE;item uuid;revision integer;hash text;result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ${s}.staff_users u JOIN ${s}.staff_role_assignments a ON a.staff_id=u.id JOIN ${s}.role_permissions rp ON rp.role_id=a.role_id WHERE u.id=actor AND u.is_active AND NOT u.must_change_password AND a.location_id IS NULL AND rp.permission_code='catalog.merch.manage') OR NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions rp ON rp.role_id=a.role_id WHERE a.staff_id=actor AND a.location_id IS NULL AND rp.permission_code='catalog.read') THEN RAISE EXCEPTION 'CONTENT_PERMISSION';END IF;
 IF save_key IS NULL OR request_id IS NULL OR jsonb_typeof(payload) IS DISTINCT FROM 'object' OR octet_length(payload::text)>13000 OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN('id','kind','slug','expectedVersion','definition','reason')) OR coalesce(payload->>'expectedVersion','')!~'^(0|[1-9][0-9]{0,9})$' OR jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string' OR length(btrim(payload->>'reason')) NOT BETWEEN 1 AND 500 OR ${s}.catalog_merch_valid(payload->>'kind',payload->'definition') IS DISTINCT FROM true THEN RAISE EXCEPTION 'MERCH_INVALID';END IF;
 item:=(payload->>'id')::uuid;hash:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');PERFORM pg_advisory_xact_lock(hashtextextended('catalog-merch:'||save_key::text,17));
 SELECT * INTO cached FROM ${s}.catalog_merch_requests WHERE key=save_key;IF FOUND THEN IF cached.actor_id<>actor OR cached.namespace<>'library' OR cached.request_hash<>hash THEN RAISE EXCEPTION 'CONTENT_IDEMPOTENCY';END IF;RETURN cached.response;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('catalog-merch-item:'||item::text,17));SELECT * INTO prior FROM ${s}.catalog_merch_items WHERE id=item FOR UPDATE;
 IF coalesce(prior.version,0)<>(payload->>'expectedVersion')::integer THEN RAISE EXCEPTION 'CONTENT_STALE';END IF;
 revision:=coalesce(prior.version,0)+1;
 IF prior.id IS NULL THEN INSERT INTO ${s}.catalog_merch_items VALUES(item,payload->>'kind',payload->>'slug',revision);
 ELSE IF prior.kind IS DISTINCT FROM payload->>'kind' OR prior.slug IS DISTINCT FROM payload->>'slug' THEN RAISE EXCEPTION 'MERCH_INVALID';END IF;END IF;
 INSERT INTO ${s}.catalog_merch_versions VALUES(item,revision,payload->>'kind',payload->'definition',actor,btrim(payload->>'reason'),now());UPDATE ${s}.catalog_merch_items SET version=revision WHERE id=item;
 INSERT INTO ${s}.audit_events(actor_id,action,request_id,metadata) VALUES(actor,'catalog.merch_saved',request_id,jsonb_build_object('entityId',item,'version',revision,'kind',payload->>'kind'));
 result:=jsonb_build_object('id',item,'version',revision);INSERT INTO ${s}.catalog_merch_requests(key,actor_id,namespace,request_hash,response) VALUES(save_key,actor,'library',hash,result);RETURN result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation OR not_null_violation THEN RAISE EXCEPTION 'MERCH_INVALID';END;$f$;
ALTER FUNCTION ${s}.catalog_content_snapshot(uuid) RENAME TO catalog_content_snapshot_v14;
CREATE FUNCTION ${s}.catalog_merch_projection(product_uuid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT CASE WHEN count(*)=0 THEN NULL ELSE jsonb_build_object('sizeGuide',max(x.data::text) FILTER(WHERE l.kind='size_guide')::jsonb,'collections',coalesce(jsonb_agg(x.data ORDER BY h.slug,h.id) FILTER(WHERE l.kind='collection'),'[]'::jsonb)) END FROM ${s}.catalog_merch_links l JOIN ${s}.catalog_merch_items h ON h.id=l.item_id JOIN ${s}.catalog_merch_versions v ON v.item_id=l.item_id AND v.version=l.item_version JOIN ${s}.catalog_merch_versions current ON current.item_id=h.id AND current.version=h.version CROSS JOIN LATERAL(SELECT jsonb_build_object('id',h.id,'kind',h.kind,'slug',h.slug,'version',v.version,'active',(current.definition->>'active')::boolean,'definition',v.definition) AS data) x WHERE l.product_id=product_uuid;
$f$;
CREATE FUNCTION ${s}.catalog_content_snapshot(product_uuid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT ${s}.catalog_content_snapshot_v14(product_uuid)||CASE WHEN ${s}.catalog_merch_projection(product_uuid) IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('merchandising',${s}.catalog_merch_projection(product_uuid)) END;
$f$;
ALTER FUNCTION ${s}.catalog_content_issues(uuid) RENAME TO catalog_content_issues_v14;
CREATE FUNCTION ${s}.catalog_content_issues(product_uuid uuid) RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE issues text[];projection jsonb;guide jsonb;
BEGIN issues:=${s}.catalog_content_issues_v14(product_uuid);projection:=${s}.catalog_merch_projection(product_uuid);IF projection IS NULL THEN RETURN issues;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(projection->'collections') x WHERE (x->>'active')::boolean=false) OR (projection->'sizeGuide' IS DISTINCT FROM 'null'::jsonb AND(projection->'sizeGuide'->>'active')::boolean=false) THEN issues:=array_append(issues,'Replace or remove retired guides and collections');END IF;
 guide:=projection->'sizeGuide';IF guide IS DISTINCT FROM 'null'::jsonb AND EXISTS(SELECT 1 FROM ${s}.catalog_variants v WHERE v.product_id=product_uuid AND v.is_active AND btrim(coalesce(v.attributes->>'size',''))<>'' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(guide->'definition'->'rows') r WHERE lower(btrim(r->>'size'))=lower(btrim(v.attributes->>'size')))) THEN issues:=array_append(issues,'Include every active SKU size in the size guide');END IF;RETURN issues;
END;$f$;
ALTER FUNCTION ${s}.catalog_content_post(uuid,uuid,uuid,jsonb) RENAME TO catalog_content_post_v14;
CREATE FUNCTION ${s}.catalog_content_post(save_key uuid,actor uuid,request_id uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE cached ${s}.catalog_merch_requests%ROWTYPE;hash text;result jsonb;links jsonb;entry jsonb;item uuid;v integer;kind text;head ${s}.catalog_merch_items%ROWTYPE;current ${s}.catalog_merch_versions%ROWTYPE;product_uuid uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ${s}.staff_users u JOIN ${s}.staff_role_assignments a ON a.staff_id=u.id JOIN ${s}.role_permissions rp ON rp.role_id=a.role_id WHERE u.id=actor AND u.is_active AND NOT u.must_change_password AND a.location_id IS NULL AND rp.permission_code='catalog.read') OR NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions rp ON rp.role_id=a.role_id WHERE a.staff_id=actor AND a.location_id IS NULL AND rp.permission_code=CASE WHEN payload->>'action' IN('approve','request_changes') THEN 'catalog.content.review' ELSE 'catalog.content.manage' END) THEN RAISE EXCEPTION 'CONTENT_PERMISSION';END IF;
 IF NOT(payload?'merchandising') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('catalog-content:'||save_key::text,14));product_uuid:=(payload->>'productId')::uuid;
  PERFORM 1 FROM ${s}.catalog_products WHERE id=product_uuid FOR UPDATE;
  PERFORM 1 FROM ${s}.catalog_merch_items WHERE id IN(SELECT item_id FROM ${s}.catalog_merch_links WHERE product_id=product_uuid) ORDER BY id FOR SHARE;
  RETURN ${s}.catalog_content_post_v14(save_key,actor,request_id,payload);
 END IF;
 IF payload->>'action' IS DISTINCT FROM 'save' OR jsonb_typeof(payload->'merchandising') IS DISTINCT FROM 'object' OR octet_length(payload::text)>15500 OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload->'merchandising') k WHERE k NOT IN('sizeGuide','collections')) THEN RAISE EXCEPTION 'CONTENT_INVALID';END IF;
 IF NOT EXISTS(SELECT 1 FROM ${s}.staff_users u JOIN ${s}.staff_role_assignments a ON a.staff_id=u.id JOIN ${s}.role_permissions rp ON rp.role_id=a.role_id WHERE u.id=actor AND u.is_active AND NOT u.must_change_password AND a.location_id IS NULL AND rp.permission_code='catalog.content.manage') OR NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions rp ON rp.role_id=a.role_id WHERE a.staff_id=actor AND a.location_id IS NULL AND rp.permission_code='catalog.read') THEN RAISE EXCEPTION 'CONTENT_PERMISSION';END IF;
 IF save_key IS NULL OR request_id IS NULL THEN RAISE EXCEPTION 'CONTENT_INVALID';END IF;hash:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');PERFORM pg_advisory_xact_lock(hashtextextended('catalog-content:'||save_key::text,14));PERFORM pg_advisory_xact_lock(hashtextextended('catalog-merch:'||save_key::text,17));
 SELECT * INTO cached FROM ${s}.catalog_merch_requests WHERE key=save_key;IF FOUND THEN IF cached.actor_id<>actor OR cached.namespace<>'content' OR cached.request_hash<>hash THEN RAISE EXCEPTION 'CONTENT_IDEMPOTENCY';END IF;RETURN cached.response;END IF;
 IF EXISTS(SELECT 1 FROM ${s}.catalog_content_requests WHERE key=save_key) THEN RAISE EXCEPTION 'CONTENT_IDEMPOTENCY';END IF;
 product_uuid:=(payload->>'productId')::uuid;PERFORM 1 FROM ${s}.catalog_products WHERE id=product_uuid FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND';END IF;
 IF EXISTS(SELECT 1 FROM ${s}.catalog_product_content WHERE product_id=product_uuid AND state='in_review') THEN RAISE EXCEPTION 'CONTENT_STATE';END IF;
 links:=payload->'merchandising';IF jsonb_typeof(links->'collections') IS DISTINCT FROM 'array' OR jsonb_array_length(links->'collections')>20 OR NOT(links?'sizeGuide') THEN RAISE EXCEPTION 'MERCH_INVALID';END IF;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(links->'collections'))<>jsonb_array_length(links->'collections') THEN RAISE EXCEPTION 'MERCH_INVALID';END IF;
 DELETE FROM ${s}.catalog_merch_links WHERE product_id=product_uuid;
 FOR entry IN SELECT jsonb_build_object('ref',value,'kind','collection') FROM jsonb_array_elements(links->'collections') UNION ALL SELECT jsonb_build_object('ref',links->'sizeGuide','kind','size_guide') WHERE links->'sizeGuide'<>'null'::jsonb ORDER BY 1 LOOP
  kind:=entry->>'kind';IF jsonb_typeof(entry->'ref') IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(entry->'ref') k WHERE k NOT IN('id','version')) OR coalesce(entry->'ref'->>'version','')!~'^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'MERCH_INVALID';END IF;
  item:=(entry->'ref'->>'id')::uuid;v:=(entry->'ref'->>'version')::integer;
  SELECT * INTO head FROM ${s}.catalog_merch_items WHERE id=item FOR SHARE;IF NOT FOUND OR head.kind<>kind THEN RAISE EXCEPTION 'MERCH_INVALID';END IF;
  SELECT * INTO current FROM ${s}.catalog_merch_versions WHERE item_id=item AND version=head.version;IF(current.definition->>'active')::boolean=false OR NOT EXISTS(SELECT 1 FROM ${s}.catalog_merch_versions WHERE item_id=item AND version=v) THEN RAISE EXCEPTION 'MERCH_INVALID';END IF;
  INSERT INTO ${s}.catalog_merch_links VALUES(product_uuid,item,v,kind);
 END LOOP;
 result:=${s}.catalog_content_post_v14(save_key,actor,request_id,payload-'merchandising');INSERT INTO ${s}.catalog_merch_requests(key,actor_id,namespace,request_hash,response) VALUES(save_key,actor,'content',hash,result);RETURN result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation OR not_null_violation OR foreign_key_violation THEN RAISE EXCEPTION 'CONTENT_INVALID';END;$f$;
REVOKE ALL ON FUNCTION ${s}.catalog_merch_valid(text,jsonb),${s}.catalog_merch_post(uuid,uuid,uuid,jsonb),${s}.catalog_merch_projection(uuid),${s}.catalog_content_snapshot(uuid),${s}.catalog_content_issues(uuid),${s}.catalog_content_post(uuid,uuid,uuid,jsonb) FROM PUBLIC;
INSERT INTO ${s}.permissions(code) VALUES('catalog.merch.manage');
INSERT INTO ${s}.role_permissions(role_id,permission_code) SELECT id,'catalog.merch.manage' FROM ${s}.roles WHERE code='owner';
CREATE TRIGGER staff_live_change AFTER INSERT OR UPDATE OR DELETE ON ${s}.catalog_merch_items FOR EACH ROW EXECUTE FUNCTION ${s}.notify_staff_change('catalog');
CREATE TRIGGER staff_live_change AFTER INSERT OR UPDATE OR DELETE ON ${s}.catalog_merch_links FOR EACH ROW EXECUTE FUNCTION ${s}.notify_staff_change('catalog');
UPDATE ${s}.app_schema_version SET version=17 WHERE singleton;
`;
}
