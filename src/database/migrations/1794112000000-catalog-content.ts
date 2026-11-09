import type { MigrationInterface, QueryRunner } from 'typeorm';
import { contentProfilesV1 } from './content-profiles-v1.js';
export class CatalogContent1794112000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    if (
      (await r.query('SELECT version FROM app_schema_version WHERE singleton'))[0]?.version !== 13
    )
      throw Error('Schema 13 is required for product content');
    const name = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw Error('Unsupported content schema');
    const s = '"' + name + '"';
    await r.query(`
 CREATE TABLE catalog_content_profiles(code text PRIMARY KEY,label text NOT NULL,fields jsonb NOT NULL CHECK(jsonb_typeof(fields)='object'));
 CREATE TABLE catalog_product_content(product_id uuid PRIMARY KEY REFERENCES catalog_products(id),profile_code text NOT NULL REFERENCES catalog_content_profiles(code),slug text NOT NULL DEFAULT '' CHECK(slug='' OR(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug)<=120)),description text NOT NULL DEFAULT '' CHECK(length(description)<=2000),specifications jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(specifications)='object'),state text NOT NULL CHECK(state IN('draft','in_review','approved','changes_requested')),version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),edited_by uuid NOT NULL REFERENCES staff_users(id),submitted_by uuid REFERENCES staff_users(id),submitted_snapshot jsonb,fingerprint text,updated_at timestamptz NOT NULL DEFAULT now(),CHECK((submitted_snapshot IS NULL AND fingerprint IS NULL) OR(jsonb_typeof(submitted_snapshot)='object' AND fingerprint ~ '^[a-f0-9]{64}$')),CHECK(state NOT IN('in_review','approved') OR submitted_snapshot IS NOT NULL));
 CREATE UNIQUE INDEX catalog_content_slug_ux ON catalog_product_content(slug) WHERE slug<>'';
 CREATE TABLE catalog_content_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_id uuid NOT NULL REFERENCES catalog_products(id),version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),state text NOT NULL CHECK(state IN('draft','in_review','approved','changes_requested')),action text NOT NULL CHECK(action IN('save','submit','approve','request_changes','withdraw')),actor_id uuid NOT NULL REFERENCES staff_users(id),reason text NOT NULL DEFAULT '' CHECK(length(reason)<=500),snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(product_id,version));
 CREATE TABLE catalog_content_requests(key uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES staff_users(id),product_id uuid NOT NULL REFERENCES catalog_products(id),request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'),created_at timestamptz NOT NULL DEFAULT now());
 INSERT INTO permissions(code) VALUES('catalog.content.manage'),('catalog.content.review');
 INSERT INTO role_permissions(role_id,permission_code) SELECT r.id,p.code FROM roles r CROSS JOIN permissions p WHERE r.code='owner' AND p.code IN('catalog.content.manage','catalog.content.review');
 CREATE FUNCTION ${s}.catalog_content_snapshot(product_uuid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('productId',p.id,'productVersion',p.version,'styleCode',p.style_code,'name',p.name,'status',p.status,'category',CASE WHEN cat.id IS NULL THEN NULL ELSE jsonb_build_object('id',cat.id,'name',cat.name,'active',cat.is_active) END,'currency',p.currency,'profile',c.profile_code,'slug',c.slug,'description',c.description,'specifications',c.specifications,'variants',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'sku',v.sku,'attributes',v.attributes,'priceMinor',v.price_minor::text) ORDER BY v.sku,v.id) FROM ${s}.catalog_variants v WHERE v.product_id=p.id AND v.is_active),'[]'::jsonb),'photos',coalesce((SELECT jsonb_agg(jsonb_build_object('id',ph.id,'width',ph.width,'height',ph.height,'primary',ph.is_primary,'hash',ph.content_hash) ORDER BY ph.is_primary DESC,ph.created_at,ph.id) FROM ${s}.catalog_product_photos ph WHERE ph.product_id=p.id AND ph.is_active),'[]'::jsonb)) FROM ${s}.catalog_products p LEFT JOIN ${s}.catalog_categories cat ON cat.id=p.category_id LEFT JOIN ${s}.catalog_product_content c ON c.product_id=p.id WHERE p.id=product_uuid;
 $f$;
 CREATE FUNCTION ${s}.catalog_content_issues(product_uuid uuid) RETURNS text[] LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
 DECLARE snapshot jsonb;fields jsonb;entry record;issues text[]:='{}';
 BEGIN snapshot:=${s}.catalog_content_snapshot(product_uuid);IF snapshot IS NULL THEN RETURN ARRAY['Product not found'];END IF;
 IF snapshot->>'profile' IS NULL THEN RETURN ARRAY['Save product content first'];END IF;
 IF snapshot->>'status'<>'active' THEN issues:=array_append(issues,'Activate the catalog product');END IF;
 IF snapshot->'category'='null'::jsonb OR coalesce((snapshot->'category'->>'active')::boolean,false)=false THEN issues:=array_append(issues,'Choose an active category');END IF;
 IF snapshot->>'slug'='' THEN issues:=array_append(issues,'Add a product URL name');END IF;
 IF btrim(snapshot->>'description')='' THEN issues:=array_append(issues,'Add the customer-facing description');END IF;
 IF jsonb_array_length(snapshot->'variants')=0 THEN issues:=array_append(issues,'Add an active SKU');END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'photos') x WHERE (x->>'primary')::boolean) THEN issues:=array_append(issues,'Add a primary product photo');END IF;
 SELECT p.fields INTO fields FROM ${s}.catalog_content_profiles p WHERE p.code=snapshot->>'profile';
 FOR entry IN SELECT * FROM jsonb_each(fields) LOOP IF coalesce((entry.value->>'required')::boolean,false) AND coalesce(btrim(snapshot->'specifications'->>entry.key),'')='' THEN issues:=array_append(issues,'Add '||(entry.value->>'label'));END IF;END LOOP;
 RETURN issues;END;$f$;
 CREATE FUNCTION ${s}.catalog_content_post(save_key uuid,actor uuid,request_id uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
 DECLARE operation text;product_uuid uuid;p ${s}.catalog_products%ROWTYPE;prior ${s}.catalog_product_content%ROWTYPE;cached ${s}.catalog_content_requests%ROWTYPE;profile jsonb;entry record;rule jsonb;value_text text;hash text;revision integer;next_state text;snapshot jsonb;fingerprint_text text;reason_text text:='';response jsonb;self_review boolean:=false;
 BEGIN
 IF save_key IS NULL OR actor IS NULL OR request_id IS NULL OR coalesce(jsonb_typeof(payload),'')<>'object' OR octet_length(payload::text)>14000 THEN RAISE EXCEPTION 'CONTENT_INVALID';END IF;
 operation:=payload->>'action';IF operation IS NULL OR operation NOT IN('save','submit','approve','request_changes','withdraw') THEN RAISE EXCEPTION 'CONTENT_INVALID';END IF;
 IF NOT EXISTS(SELECT 1 FROM ${s}.staff_users u JOIN ${s}.staff_role_assignments a ON a.staff_id=u.id JOIN ${s}.role_permissions rp ON rp.role_id=a.role_id WHERE u.id=actor AND u.is_active AND NOT u.must_change_password AND a.location_id IS NULL AND rp.permission_code='catalog.read') OR NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions rp ON rp.role_id=a.role_id WHERE a.staff_id=actor AND a.location_id IS NULL AND rp.permission_code=CASE WHEN operation IN('approve','request_changes') THEN 'catalog.content.review' ELSE 'catalog.content.manage' END) THEN RAISE EXCEPTION 'CONTENT_PERMISSION';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN('action','productId','expectedVersion','expectedProductVersion','profile','slug','description','specifications','reason')) OR coalesce(payload->>'expectedVersion','')!~'^(0|[1-9][0-9]{0,9})$' OR coalesce(payload->>'expectedProductVersion','')!~'^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'CONTENT_INVALID';END IF;
 IF operation<>'save' AND(payload?'profile' OR payload?'slug' OR payload?'description' OR payload?'specifications') THEN RAISE EXCEPTION 'CONTENT_INVALID';END IF;
 product_uuid:=(payload->>'productId')::uuid;hash:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('catalog-content:'||save_key::text,14));SELECT * INTO cached FROM ${s}.catalog_content_requests WHERE key=save_key;
 IF FOUND THEN IF cached.actor_id<>actor OR cached.request_hash<>hash THEN RAISE EXCEPTION 'CONTENT_IDEMPOTENCY';END IF;RETURN cached.response;END IF;
 SELECT * INTO p FROM ${s}.catalog_products WHERE id=product_uuid FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND';END IF;
 IF p.version<>(payload->>'expectedProductVersion')::integer THEN RAISE EXCEPTION 'CONTENT_STALE';END IF;
 SELECT * INTO prior FROM ${s}.catalog_product_content WHERE product_id=product_uuid FOR UPDATE;
 IF coalesce(prior.version,0)<>(payload->>'expectedVersion')::integer THEN RAISE EXCEPTION 'CONTENT_STALE';END IF;revision:=coalesce(prior.version,0)+1;
 IF operation='save' THEN
 IF prior.state='in_review' THEN RAISE EXCEPTION 'CONTENT_STATE';END IF;
 IF payload?'reason' OR jsonb_typeof(payload->'profile') IS DISTINCT FROM 'string' OR jsonb_typeof(payload->'slug') IS DISTINCT FROM 'string' OR jsonb_typeof(payload->'description') IS DISTINCT FROM 'string' OR jsonb_typeof(payload->'specifications') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CONTENT_INVALID';END IF;
 SELECT fields INTO profile FROM ${s}.catalog_content_profiles WHERE code=payload->>'profile';IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_INVALID';END IF;
 IF length(payload->>'description')>2000 OR length(payload->>'slug')>120 OR(payload->>'slug'<>'' AND(payload->>'slug')!~'^[a-z0-9]+(-[a-z0-9]+)*$') OR (payload->>'description') ~ '[[:cntrl:]]' AND (payload->>'description') ~ '[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]' THEN RAISE EXCEPTION 'CONTENT_INVALID';END IF;
 FOR entry IN SELECT * FROM jsonb_each(payload->'specifications') LOOP
 rule:=profile->entry.key;IF rule IS NULL OR jsonb_typeof(entry.value)<>'string' THEN RAISE EXCEPTION 'CONTENT_INVALID';END IF;value_text:=entry.value#>>'{}';
 IF length(value_text)>coalesce((rule->>'max')::integer,40) OR value_text ~ '[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]' THEN RAISE EXCEPTION 'CONTENT_INVALID';END IF;
 IF value_text<>'' AND ((rule->>'kind'='choice' AND NOT(rule->'options'?value_text)) OR(rule->>'kind'='decimal' AND value_text!~'^(0|[1-9][0-9]{0,3})(\\.[0-9]{1,2})?$')) THEN RAISE EXCEPTION 'CONTENT_INVALID';END IF;
 END LOOP;
 next_state:='draft';
 INSERT INTO ${s}.catalog_product_content(product_id,profile_code,slug,description,specifications,state,version,edited_by) VALUES(product_uuid,payload->>'profile',payload->>'slug',payload->>'description',payload->'specifications',next_state,revision,actor) ON CONFLICT(product_id) DO UPDATE SET profile_code=EXCLUDED.profile_code,slug=EXCLUDED.slug,description=EXCLUDED.description,specifications=EXCLUDED.specifications,state=EXCLUDED.state,version=EXCLUDED.version,edited_by=actor,submitted_by=NULL,submitted_snapshot=NULL,fingerprint=NULL,updated_at=now();
 ELSE
 IF prior.product_id IS NULL THEN RAISE EXCEPTION 'CONTENT_STATE';END IF;
 IF operation='submit' THEN
 IF payload?'reason' OR prior.state NOT IN('draft','changes_requested') THEN RAISE EXCEPTION 'CONTENT_STATE';END IF;
 ELSE
 IF jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string' OR coalesce(length(btrim(payload->>'reason')),0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'CONTENT_INVALID';END IF;reason_text:=btrim(payload->>'reason');
 IF prior.state<>'in_review' THEN RAISE EXCEPTION 'CONTENT_STATE';END IF;
 END IF;
 PERFORM 1 FROM ${s}.catalog_categories WHERE id=p.category_id FOR SHARE;
 PERFORM 1 FROM ${s}.catalog_variants WHERE product_id=product_uuid ORDER BY id FOR SHARE;
 PERFORM 1 FROM ${s}.catalog_product_photos WHERE product_id=product_uuid ORDER BY id FOR SHARE;
 snapshot:=${s}.catalog_content_snapshot(product_uuid);fingerprint_text:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');
 IF operation IN('submit','approve') AND cardinality(${s}.catalog_content_issues(product_uuid))>0 THEN RAISE EXCEPTION 'CONTENT_INCOMPLETE';END IF;
 IF operation='approve' THEN
 IF fingerprint_text IS DISTINCT FROM prior.fingerprint THEN RAISE EXCEPTION 'CONTENT_CHANGED';END IF;
 self_review:=actor IN(prior.edited_by,prior.submitted_by);
 IF self_review AND NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.roles role ON role.id=a.role_id WHERE a.staff_id=actor AND a.location_id IS NULL AND role.code='owner') THEN RAISE EXCEPTION 'CONTENT_SELF_REVIEW';END IF;
 END IF;
 next_state:=CASE operation WHEN 'submit' THEN 'in_review' WHEN 'approve' THEN 'approved' WHEN 'request_changes' THEN 'changes_requested' ELSE 'draft' END;
 UPDATE ${s}.catalog_product_content SET state=next_state,version=revision,submitted_by=CASE WHEN operation='submit' THEN actor ELSE submitted_by END,submitted_snapshot=CASE WHEN operation='submit' THEN snapshot ELSE submitted_snapshot END,fingerprint=CASE WHEN operation='submit' THEN fingerprint_text ELSE fingerprint END,updated_at=now() WHERE product_id=product_uuid;
 END IF;
 snapshot:=${s}.catalog_content_snapshot(product_uuid);fingerprint_text:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');
 INSERT INTO ${s}.catalog_content_events(product_id,version,state,action,actor_id,reason,snapshot,fingerprint) VALUES(product_uuid,revision,next_state,operation,actor,reason_text,snapshot,fingerprint_text);
 INSERT INTO ${s}.audit_events(actor_id,action,request_id,metadata) VALUES(actor,'catalog.content_'||operation,request_id,jsonb_build_object('entityId',product_uuid,'version',revision,'state',next_state,'ownerSelfReview',self_review));
 response:=jsonb_build_object('productId',product_uuid,'version',revision,'state',next_state);
 INSERT INTO ${s}.catalog_content_requests(key,actor_id,product_id,request_hash,response) VALUES(save_key,actor,product_uuid,hash,response);RETURN response;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN RAISE EXCEPTION 'CONTENT_INVALID';END;$f$;
 REVOKE ALL ON FUNCTION ${s}.catalog_content_snapshot(uuid),${s}.catalog_content_issues(uuid),${s}.catalog_content_post(uuid,uuid,uuid,jsonb) FROM PUBLIC;
 UPDATE app_schema_version SET version=14 WHERE singleton;
 `);
    for (const profile of contentProfilesV1)
      await r.query(
        'INSERT INTO catalog_content_profiles(code,label,fields) VALUES($1,$2,$3::jsonb)',
        [profile.code, profile.label, JSON.stringify(profile.fields)],
      );
  }
  async down(r: QueryRunner) {
    if ((await r.query('SELECT 1 FROM catalog_content_events LIMIT 1')).length)
      throw Error('Cannot discard product content review history');
    await r.query(
      "DROP FUNCTION catalog_content_post(uuid,uuid,uuid,jsonb),catalog_content_issues(uuid),catalog_content_snapshot(uuid);DROP TABLE catalog_content_requests,catalog_content_events,catalog_product_content,catalog_content_profiles;DELETE FROM role_permissions WHERE permission_code IN('catalog.content.manage','catalog.content.review');DELETE FROM permissions WHERE code IN('catalog.content.manage','catalog.content.review');UPDATE app_schema_version SET version=13 WHERE singleton",
    );
  }
}
