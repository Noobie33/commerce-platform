// Migration 18 definitions are immutable once released.
export function presentationV1(s: string) {
  return `
CREATE FUNCTION ${s}.catalog_category_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE bad boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('catalog-taxonomy',18));
 WITH RECURSIVE nodes AS(SELECT id,parent_id,is_active FROM ${s}.catalog_categories WHERE id<>NEW.id UNION ALL SELECT NEW.id,NEW.parent_id,NEW.is_active),
 walk AS(SELECT id,parent_id,is_active AS origin_active,ARRAY[id] AS path,false AS cycle,1 AS depth,false AS inactive_parent FROM nodes UNION ALL SELECT w.id,n.parent_id,w.origin_active,w.path||n.id,n.id=ANY(w.path),w.depth+1,w.inactive_parent OR(w.origin_active AND NOT n.is_active) FROM walk w JOIN nodes n ON n.id=w.parent_id WHERE NOT w.cycle AND w.depth<=12)
 SELECT coalesce(bool_or(cycle OR depth>12 OR inactive_parent),false) INTO bad FROM walk;
 IF bad THEN RAISE EXCEPTION 'TAXONOMY_GRAPH';END IF;
 IF TG_OP='UPDATE' THEN IF OLD.is_active AND NOT NEW.is_active AND EXISTS(SELECT 1 FROM ${s}.catalog_products WHERE category_id=NEW.id AND status='active') THEN RAISE EXCEPTION 'TAXONOMY_IN_USE';END IF;END IF;
 RETURN NEW;
END;$f$;
CREATE TRIGGER catalog_category_graph BEFORE INSERT OR UPDATE OF parent_id,is_active ON ${s}.catalog_categories FOR EACH ROW EXECUTE FUNCTION ${s}.catalog_category_guard();
CREATE FUNCTION ${s}.catalog_category_active(category_uuid uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$ BEGIN PERFORM 1 FROM ${s}.catalog_categories WHERE id=category_uuid AND is_active FOR SHARE;RETURN FOUND;END;$f$;
CREATE TABLE ${s}.catalog_category_routes(slug text PRIMARY KEY CHECK(length(slug) BETWEEN 1 AND 120 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),category_id uuid NOT NULL REFERENCES ${s}.catalog_categories(id),UNIQUE(category_id,slug));
CREATE TABLE ${s}.catalog_category_presentation(category_id uuid PRIMARY KEY REFERENCES ${s}.catalog_categories(id),version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),slug text,seo_title text NOT NULL CHECK(length(seo_title)<=80 AND seo_title!~'[[:cntrl:]]'),seo_description text NOT NULL CHECK(length(seo_description)<=320 AND seo_description!~'[[:cntrl:]]'),FOREIGN KEY(category_id,slug) REFERENCES ${s}.catalog_category_routes(category_id,slug));
CREATE TABLE ${s}.catalog_category_events(category_id uuid NOT NULL REFERENCES ${s}.catalog_categories(id),version integer NOT NULL,actor_id uuid NOT NULL REFERENCES ${s}.staff_users(id),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),before_snapshot jsonb,snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(category_id,version));
CREATE TABLE ${s}.catalog_product_seo(product_id uuid PRIMARY KEY REFERENCES ${s}.catalog_products(id),title text NOT NULL CHECK(length(title)<=80 AND title!~'[[:cntrl:]]'),description text NOT NULL CHECK(length(description)<=320 AND description!~'[[:cntrl:]]'));
CREATE TABLE ${s}.catalog_presentation_requests(key uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES ${s}.staff_users(id),namespace text NOT NULL CHECK(namespace IN('category','content')),request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION ${s}.catalog_category_snapshot(category_uuid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',c.id,'name',c.name,'parentId',c.parent_id,'active',c.is_active,'version',coalesce(p.version,0),'slug',p.slug,'seo',jsonb_build_object('title',coalesce(p.seo_title,''),'description',coalesce(p.seo_description,''))) FROM ${s}.catalog_categories c LEFT JOIN ${s}.catalog_category_presentation p ON p.category_id=c.id WHERE c.id=category_uuid;
$f$;
CREATE FUNCTION ${s}.catalog_category_post(save_key uuid,actor uuid,request_id uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE cached ${s}.catalog_presentation_requests%ROWTYPE;prior ${s}.catalog_category_presentation%ROWTYPE;category_uuid uuid;parent_uuid uuid;prior_snapshot jsonb;snapshot jsonb;revision integer;hash text;result jsonb;route_owner uuid;slug_text text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ${s}.staff_users u JOIN ${s}.staff_role_assignments a ON a.staff_id=u.id JOIN ${s}.role_permissions rp ON rp.role_id=a.role_id WHERE u.id=actor AND u.is_active AND NOT u.must_change_password AND a.location_id IS NULL AND rp.permission_code='catalog.taxonomy.manage') OR NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions rp ON rp.role_id=a.role_id WHERE a.staff_id=actor AND a.location_id IS NULL AND rp.permission_code='catalog.read') THEN RAISE EXCEPTION 'CONTENT_PERMISSION';END IF;
 IF save_key IS NULL OR request_id IS NULL OR jsonb_typeof(payload) IS DISTINCT FROM 'object' OR octet_length(payload::text)>5500 OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN('id','expectedVersion','name','parentId','active','slug','seo','reason')) OR coalesce(payload->>'expectedVersion','')!~'^(0|[1-9][0-9]{0,9})$' OR jsonb_typeof(payload->'name') IS DISTINCT FROM 'string' OR length(btrim(payload->>'name')) NOT BETWEEN 1 AND 80 OR (payload->>'name') ~ '[[:cntrl:]]' OR jsonb_typeof(payload->'active') IS DISTINCT FROM 'boolean' OR NOT(payload?'parentId') OR jsonb_typeof(payload->'slug') IS DISTINCT FROM 'string' OR length(payload->>'slug')>120 OR(payload->>'slug'<>'' AND(payload->>'slug')!~'^[a-z0-9]+(-[a-z0-9]+)*$') OR jsonb_typeof(payload->'seo') IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload->'seo') k WHERE k NOT IN('title','description')) OR jsonb_typeof(payload->'seo'->'title') IS DISTINCT FROM 'string' OR length(payload->'seo'->>'title')>80 OR jsonb_typeof(payload->'seo'->'description') IS DISTINCT FROM 'string' OR length(payload->'seo'->>'description')>320 OR jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string' OR length(btrim(payload->>'reason')) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'TAXONOMY_INVALID';END IF;
 category_uuid:=(payload->>'id')::uuid;parent_uuid:=(payload->>'parentId')::uuid;hash:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('presentation:'||save_key::text,18));
 SELECT * INTO cached FROM ${s}.catalog_presentation_requests WHERE key=save_key;IF FOUND THEN IF cached.actor_id<>actor OR cached.namespace<>'category' OR cached.request_hash<>hash THEN RAISE EXCEPTION 'CONTENT_IDEMPOTENCY';END IF;RETURN cached.response;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('catalog-taxonomy',18));PERFORM 1 FROM ${s}.catalog_categories WHERE id=category_uuid FOR UPDATE;
 prior_snapshot:=${s}.catalog_category_snapshot(category_uuid);SELECT * INTO prior FROM ${s}.catalog_category_presentation WHERE category_id=category_uuid;
 IF coalesce(prior.version,0)<>(payload->>'expectedVersion')::integer THEN RAISE EXCEPTION 'CONTENT_STALE';END IF;revision:=coalesce(prior.version,0)+1;
 IF parent_uuid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ${s}.catalog_categories WHERE id=parent_uuid) THEN RAISE EXCEPTION 'TAXONOMY_PARENT';END IF;
 slug_text:=nullif(payload->>'slug','');IF prior.slug IS NOT NULL AND slug_text IS NULL THEN RAISE EXCEPTION 'TAXONOMY_URL_REQUIRED';END IF;
 INSERT INTO ${s}.catalog_categories(id,name,name_key,parent_id,is_active) VALUES(category_uuid,btrim(payload->>'name'),lower(regexp_replace(btrim(normalize(payload->>'name',NFKC)),'[[:space:]]+',' ','g')),parent_uuid,(payload->>'active')::boolean) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,name_key=EXCLUDED.name_key,parent_id=EXCLUDED.parent_id,is_active=EXCLUDED.is_active;
 IF slug_text IS NOT NULL THEN INSERT INTO ${s}.catalog_category_routes(slug,category_id) VALUES(slug_text,category_uuid) ON CONFLICT(slug) DO NOTHING;SELECT category_id INTO route_owner FROM ${s}.catalog_category_routes WHERE slug=slug_text;IF route_owner<>category_uuid THEN RAISE EXCEPTION 'TAXONOMY_SLUG_EXISTS';END IF;END IF;
 INSERT INTO ${s}.catalog_category_presentation VALUES(category_uuid,revision,slug_text,payload->'seo'->>'title',payload->'seo'->>'description') ON CONFLICT(category_id) DO UPDATE SET version=EXCLUDED.version,slug=EXCLUDED.slug,seo_title=EXCLUDED.seo_title,seo_description=EXCLUDED.seo_description;
 snapshot:=${s}.catalog_category_snapshot(category_uuid);
 INSERT INTO ${s}.catalog_category_events(category_id,version,actor_id,reason,before_snapshot,snapshot) VALUES(category_uuid,revision,actor,btrim(payload->>'reason'),prior_snapshot,snapshot);
 INSERT INTO ${s}.audit_events(actor_id,action,request_id,metadata) VALUES(actor,'catalog.category_saved',request_id,jsonb_build_object('entityId',category_uuid,'version',revision));result:=jsonb_build_object('id',category_uuid,'version',revision);
 INSERT INTO ${s}.catalog_presentation_requests(key,actor_id,namespace,request_hash,response) VALUES(save_key,actor,'category',hash,result);RETURN result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation OR not_null_violation OR foreign_key_violation THEN RAISE EXCEPTION 'TAXONOMY_INVALID';END;$f$;
ALTER FUNCTION ${s}.catalog_content_snapshot(uuid) RENAME TO catalog_content_snapshot_v17;
CREATE FUNCTION ${s}.catalog_content_snapshot(product_uuid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT ${s}.catalog_content_snapshot_v17(product_uuid)||coalesce((SELECT jsonb_build_object('seo',jsonb_build_object('title',title,'description',description)) FROM ${s}.catalog_product_seo WHERE product_id=product_uuid AND(title<>'' OR description<>'')),'{}'::jsonb);
$f$;
ALTER FUNCTION ${s}.catalog_content_post(uuid,uuid,uuid,jsonb) RENAME TO catalog_content_post_v17;
CREATE FUNCTION ${s}.catalog_content_post(save_key uuid,actor uuid,request_id uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE cached ${s}.catalog_presentation_requests%ROWTYPE;hash text;product_uuid uuid;result jsonb;seo jsonb;
BEGIN
 IF NOT(payload?'seo') THEN RETURN ${s}.catalog_content_post_v17(save_key,actor,request_id,payload);END IF;
 IF NOT EXISTS(SELECT 1 FROM ${s}.staff_users u JOIN ${s}.staff_role_assignments a ON a.staff_id=u.id JOIN ${s}.role_permissions rp ON rp.role_id=a.role_id WHERE u.id=actor AND u.is_active AND NOT u.must_change_password AND a.location_id IS NULL AND rp.permission_code='catalog.content.manage') OR NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions rp ON rp.role_id=a.role_id WHERE a.staff_id=actor AND a.location_id IS NULL AND rp.permission_code='catalog.read') THEN RAISE EXCEPTION 'CONTENT_PERMISSION';END IF;
 seo:=payload->'seo';IF save_key IS NULL OR request_id IS NULL OR payload->>'action' IS DISTINCT FROM 'save' OR jsonb_typeof(seo) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(seo) k WHERE k NOT IN('title','description')) OR jsonb_typeof(seo->'title') IS DISTINCT FROM 'string' OR length(seo->>'title')>80 OR jsonb_typeof(seo->'description') IS DISTINCT FROM 'string' OR length(seo->>'description')>320 OR octet_length(payload::text)>15500 THEN RAISE EXCEPTION 'CONTENT_INVALID';END IF;
 hash:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');PERFORM pg_advisory_xact_lock(hashtextextended('catalog-content:'||save_key::text,14));PERFORM pg_advisory_xact_lock(hashtextextended('presentation:'||save_key::text,18));
 SELECT * INTO cached FROM ${s}.catalog_presentation_requests WHERE key=save_key;IF FOUND THEN IF cached.actor_id<>actor OR cached.namespace<>'content' OR cached.request_hash<>hash THEN RAISE EXCEPTION 'CONTENT_IDEMPOTENCY';END IF;RETURN cached.response;END IF;
 IF EXISTS(SELECT 1 FROM ${s}.catalog_content_requests WHERE key=save_key) OR EXISTS(SELECT 1 FROM ${s}.catalog_merch_requests WHERE key=save_key) THEN RAISE EXCEPTION 'CONTENT_IDEMPOTENCY';END IF;
 product_uuid:=(payload->>'productId')::uuid;PERFORM 1 FROM ${s}.catalog_products WHERE id=product_uuid FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND';END IF;
 IF EXISTS(SELECT 1 FROM ${s}.catalog_product_content WHERE product_id=product_uuid AND state='in_review') THEN RAISE EXCEPTION 'CONTENT_STATE';END IF;
 INSERT INTO ${s}.catalog_product_seo VALUES(product_uuid,seo->>'title',seo->>'description') ON CONFLICT(product_id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description;
 result:=${s}.catalog_content_post_v17(save_key,actor,request_id,payload-'seo');INSERT INTO ${s}.catalog_presentation_requests(key,actor_id,namespace,request_hash,response) VALUES(save_key,actor,'content',hash,result);RETURN result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation OR not_null_violation THEN RAISE EXCEPTION 'CONTENT_INVALID';END;$f$;
REVOKE ALL ON FUNCTION ${s}.catalog_category_active(uuid),${s}.catalog_category_guard(),${s}.catalog_category_snapshot(uuid),${s}.catalog_category_post(uuid,uuid,uuid,jsonb),${s}.catalog_content_snapshot(uuid),${s}.catalog_content_post(uuid,uuid,uuid,jsonb) FROM PUBLIC;
INSERT INTO ${s}.permissions(code) VALUES('catalog.taxonomy.manage');INSERT INTO ${s}.role_permissions(role_id,permission_code) SELECT id,'catalog.taxonomy.manage' FROM ${s}.roles WHERE code='owner';
CREATE TRIGGER staff_live_change AFTER INSERT OR UPDATE OR DELETE ON ${s}.catalog_category_presentation FOR EACH ROW EXECUTE FUNCTION ${s}.notify_staff_change('catalog');
CREATE TRIGGER staff_live_change AFTER INSERT OR UPDATE OR DELETE ON ${s}.catalog_product_seo FOR EACH ROW EXECUTE FUNCTION ${s}.notify_staff_change('catalog');
UPDATE ${s}.app_schema_version SET version=18 WHERE singleton;
`;
}
