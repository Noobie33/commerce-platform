// Migration 19 definitions are immutable once released.
export function publicationV1(s: string) {
  return `
CREATE TABLE ${s}.catalog_media_reviews(
 photo_id uuid PRIMARY KEY REFERENCES ${s}.catalog_product_photos(id),version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 state text NOT NULL CHECK(state IN('approved','revoked')),image_hash text NOT NULL CHECK(image_hash ~ '^[a-f0-9]{64}$'),thumbnail_hash text NOT NULL CHECK(thumbnail_hash ~ '^[a-f0-9]{64}$'),
 alt text NOT NULL CHECK(length(btrim(alt)) BETWEEN 1 AND 240 AND alt !~ '[[:cntrl:]]'));
CREATE TABLE ${s}.catalog_releases(
 product_id uuid PRIMARY KEY REFERENCES ${s}.catalog_products(id),version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),state text NOT NULL CHECK(state IN('published','unpublished')),
 content_version integer,content_hash text,category_hash text,media_hash text,snapshot jsonb,
 CHECK(state<>'published' OR(content_version IS NOT NULL AND content_hash IS NOT NULL AND category_hash IS NOT NULL AND media_hash IS NOT NULL AND snapshot IS NOT NULL AND jsonb_typeof(snapshot)='object')));
CREATE TABLE ${s}.catalog_publication_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_id uuid NOT NULL REFERENCES ${s}.catalog_products(id),kind text NOT NULL CHECK(kind IN('media','release')),entity_id uuid NOT NULL,
 version integer NOT NULL,action text NOT NULL CHECK(action IN('approve','revoke','publish','unpublish')),actor_id uuid NOT NULL REFERENCES ${s}.staff_users(id),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(kind,entity_id,version));
CREATE TABLE ${s}.catalog_publication_requests(key uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES ${s}.staff_users(id),request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),response jsonb NOT NULL);

CREATE INDEX catalog_releases_slug_idx ON ${s}.catalog_releases((snapshot->>'slug')) WHERE state='published';
CREATE INDEX catalog_publication_history_idx ON ${s}.catalog_publication_events(product_id,created_at DESC,id DESC);
CREATE FUNCTION ${s}.catalog_release_basis(product_uuid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 WITH RECURSIVE path AS(
 SELECT c.id,c.name,c.parent_id,c.is_active,p.slug,1 AS depth FROM ${s}.catalog_products pr JOIN ${s}.catalog_categories c ON c.id=pr.category_id LEFT JOIN ${s}.catalog_category_presentation p ON p.category_id=c.id WHERE pr.id=product_uuid
 UNION ALL SELECT c.id,c.name,c.parent_id,c.is_active,p.slug,x.depth+1 FROM path x JOIN ${s}.catalog_categories c ON c.id=x.parent_id LEFT JOIN ${s}.catalog_category_presentation p ON p.category_id=c.id WHERE x.depth<12),
 cats AS(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'slug',slug,'active',is_active) ORDER BY depth DESC),'[]'::jsonb) AS data,coalesce(bool_and(is_active AND slug IS NOT NULL),false) AS ready FROM path),
 photos AS(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'hash',p.content_hash,'thumbnailHash',r.thumbnail_hash,'alt',r.alt,'reviewVersion',r.version,'reviewState',r.state,'width',p.width,'height',p.height,'primary',p.is_primary) ORDER BY p.is_primary DESC,p.created_at,p.id),'[]'::jsonb) AS data,
 count(*)>0 AND count(*) FILTER(WHERE p.is_primary)=1 AND coalesce(bool_and(coalesce(r.state='approved' AND r.image_hash=p.content_hash,false)),false) AS ready
 FROM ${s}.catalog_product_photos p LEFT JOIN ${s}.catalog_media_reviews r ON r.photo_id=p.id WHERE p.product_id=product_uuid AND p.is_active)
 SELECT jsonb_build_object('content',${s}.catalog_content_snapshot(product_uuid),'contentVersion',c.version,'contentHash',c.fingerprint,
 'contentReady',coalesce(c.state='approved' AND c.fingerprint=encode(sha256(convert_to(${s}.catalog_content_snapshot(product_uuid)::text,'UTF8')),'hex') AND cardinality(${s}.catalog_content_issues(product_uuid))=0,false),
 'categoryReady',cats.ready,'categoryPath',cats.data,'categoryHash',encode(sha256(convert_to(cats.data::text,'UTF8')),'hex'),
 'mediaReady',photos.ready,'photos',photos.data,'mediaHash',encode(sha256(convert_to(photos.data::text,'UTF8')),'hex'))
 FROM cats CROSS JOIN photos LEFT JOIN ${s}.catalog_product_content c ON c.product_id=product_uuid;
$f$;
CREATE FUNCTION ${s}.catalog_release_eligible(product_uuid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT coalesce(r.state='published' AND (b->>'contentReady')::boolean AND (b->>'categoryReady')::boolean AND (b->>'mediaReady')::boolean
 AND r.content_version=(b->>'contentVersion')::integer AND r.content_hash=b->>'contentHash' AND r.category_hash=b->>'categoryHash' AND r.media_hash=b->>'mediaHash',false)
 FROM ${s}.catalog_releases r CROSS JOIN LATERAL ${s}.catalog_release_basis(r.product_id) b WHERE r.product_id=product_uuid;
$f$;
CREATE FUNCTION ${s}.catalog_publication_post(save_key uuid,actor uuid,request_id uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE op text;perm text;pid uuid;entity uuid;hash text;cached ${s}.catalog_publication_requests%ROWTYPE;review ${s}.catalog_media_reviews%ROWTYPE;release ${s}.catalog_releases%ROWTYPE;photo ${s}.catalog_product_photos%ROWTYPE;basis jsonb;content jsonb;safe jsonb;rev integer;result jsonb;
BEGIN
 op:=payload->>'action';perm:=CASE WHEN op IN('approve','revoke') THEN 'catalog.media.review' ELSE 'catalog.publish' END;
 IF NOT EXISTS(SELECT 1 FROM ${s}.staff_users u JOIN ${s}.staff_role_assignments a ON a.staff_id=u.id JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE u.id=actor AND u.is_active AND NOT u.must_change_password AND a.location_id IS NULL AND p.permission_code=perm)
 OR NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE a.staff_id=actor AND a.location_id IS NULL AND p.permission_code='catalog.read') THEN RAISE EXCEPTION 'PUBLICATION_PERMISSION';END IF;
 IF save_key IS NULL OR request_id IS NULL OR jsonb_typeof(payload) IS DISTINCT FROM 'object' OR op NOT IN('approve','revoke','publish','unpublish') OR op IS NULL OR octet_length(payload::text)>5000 OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN('action','productId','photoId','expectedVersion','expectedProductVersion','expectedContentVersion','reason','alt','imageHash','thumbnailHash')) OR jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string' OR length(btrim(payload->>'reason')) NOT BETWEEN 1 AND 500 OR (payload->>'reason')~'[[:cntrl:]]' OR coalesce(payload->>'expectedVersion','') !~ '^(0|[1-9][0-9]{0,9})$' THEN RAISE EXCEPTION 'PUBLICATION_INVALID';END IF;
 pid:=(payload->>'productId')::uuid;hash:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('publication:'||save_key::text,19));SELECT * INTO cached FROM ${s}.catalog_publication_requests WHERE key=save_key;
 IF FOUND THEN IF cached.actor_id<>actor OR cached.request_hash<>hash THEN RAISE EXCEPTION 'PUBLICATION_IDEMPOTENCY';END IF;RETURN cached.response;END IF;
 PERFORM 1 FROM ${s}.catalog_products WHERE id=pid FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'PUBLICATION_NOT_FOUND';END IF;
 IF op IN('approve','revoke') THEN
 entity:=(payload->>'photoId')::uuid;SELECT * INTO photo FROM ${s}.catalog_product_photos WHERE id=entity AND product_id=pid AND is_active FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'PUBLICATION_NOT_FOUND';END IF;
 SELECT * INTO review FROM ${s}.catalog_media_reviews WHERE photo_id=entity;
 IF coalesce(review.version,0)<>(payload->>'expectedVersion')::integer THEN RAISE EXCEPTION 'PUBLICATION_STALE';END IF;rev:=coalesce(review.version,0)+1;
 IF op='approve' THEN
 IF jsonb_typeof(payload->'alt') IS DISTINCT FROM 'string' OR length(btrim(payload->>'alt')) NOT BETWEEN 1 AND 240 OR (payload->>'alt')~'[[:cntrl:]]' OR payload->>'imageHash' IS DISTINCT FROM photo.content_hash OR coalesce(payload->>'thumbnailHash','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'PUBLICATION_INVALID';END IF;
 INSERT INTO ${s}.catalog_media_reviews VALUES(entity,rev,'approved',photo.content_hash,payload->>'thumbnailHash',btrim(payload->>'alt')) ON CONFLICT(photo_id) DO UPDATE SET version=EXCLUDED.version,state=EXCLUDED.state,image_hash=EXCLUDED.image_hash,thumbnail_hash=EXCLUDED.thumbnail_hash,alt=EXCLUDED.alt;
 ELSE
 IF review.photo_id IS NULL THEN RAISE EXCEPTION 'PUBLICATION_STATE';END IF;
 UPDATE ${s}.catalog_media_reviews SET version=rev,state='revoked' WHERE photo_id=entity;
 END IF;
 SELECT to_jsonb(r) INTO safe FROM ${s}.catalog_media_reviews r WHERE photo_id=entity;
 ELSE
 entity:=pid;PERFORM pg_advisory_xact_lock(hashtextextended('catalog-taxonomy',18));
 SELECT * INTO release FROM ${s}.catalog_releases WHERE product_id=pid;
 IF coalesce(release.version,0)<>(payload->>'expectedVersion')::integer THEN RAISE EXCEPTION 'PUBLICATION_STALE';END IF;rev:=coalesce(release.version,0)+1;
 IF op='publish' THEN
 PERFORM 1 FROM ${s}.catalog_product_content WHERE product_id=pid FOR SHARE;
 PERFORM 1 FROM ${s}.catalog_variants WHERE product_id=pid ORDER BY id FOR SHARE;
 PERFORM 1 FROM ${s}.catalog_product_photos WHERE product_id=pid ORDER BY id FOR SHARE;
 basis:=${s}.catalog_release_basis(pid);
 IF coalesce(payload->>'expectedContentVersion','') !~ '^[1-9][0-9]{0,9}$' OR coalesce(payload->>'expectedProductVersion','') !~ '^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'PUBLICATION_INVALID';END IF;
 IF (payload->>'expectedContentVersion')::integer<>(basis->>'contentVersion')::integer OR(payload->>'expectedProductVersion')::integer<>(basis->'content'->>'productVersion')::integer THEN RAISE EXCEPTION 'PUBLICATION_STALE';END IF;
 IF NOT((basis->>'contentReady')::boolean AND(basis->>'categoryReady')::boolean AND(basis->>'mediaReady')::boolean) THEN RAISE EXCEPTION 'PUBLICATION_INCOMPLETE';END IF;
 content:=basis->'content';safe:=jsonb_build_object('productId',pid,'name',content->'name','styleCode',content->'styleCode','slug',content->'slug','currency',content->'currency','description',content->'description','profile',content->'profile','specifications',content->'specifications','variants',content->'variants','seo',coalesce(content->'seo','{}'::jsonb),'merchandising',coalesce(content->'merchandising','{}'::jsonb),'categoryPath',basis->'categoryPath','photos',(SELECT jsonb_agg(x-'hash'-'thumbnailHash'-'reviewVersion'-'reviewState') FROM jsonb_array_elements(basis->'photos') x));
 INSERT INTO ${s}.catalog_releases VALUES(pid,rev,'published',(basis->>'contentVersion')::integer,basis->>'contentHash',basis->>'categoryHash',basis->>'mediaHash',safe) ON CONFLICT(product_id) DO UPDATE SET version=EXCLUDED.version,state=EXCLUDED.state,content_version=EXCLUDED.content_version,content_hash=EXCLUDED.content_hash,category_hash=EXCLUDED.category_hash,media_hash=EXCLUDED.media_hash,snapshot=EXCLUDED.snapshot;
 ELSE
 IF release.product_id IS NULL OR release.state<>'published' THEN RAISE EXCEPTION 'PUBLICATION_STATE';END IF;
 UPDATE ${s}.catalog_releases SET version=rev,state='unpublished' WHERE product_id=pid;safe:=jsonb_build_object('state','unpublished');
 END IF;
 END IF;
 INSERT INTO ${s}.catalog_publication_events(product_id,kind,entity_id,version,action,actor_id,reason,snapshot) VALUES(pid,CASE WHEN op IN('approve','revoke') THEN 'media' ELSE 'release' END,entity,rev,op,actor,btrim(payload->>'reason'),safe);
 INSERT INTO ${s}.audit_events(actor_id,action,request_id,metadata) VALUES(actor,'catalog.'||op,request_id,jsonb_build_object('entityId',entity,'productId',pid,'version',rev));
 result:=jsonb_build_object('productId',pid,'entityId',entity,'version',rev,'action',op);INSERT INTO ${s}.catalog_publication_requests VALUES(save_key,actor,hash,result);RETURN result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation OR not_null_violation THEN RAISE EXCEPTION 'PUBLICATION_INVALID';END;$f$;
REVOKE ALL ON FUNCTION ${s}.catalog_release_basis(uuid),${s}.catalog_release_eligible(uuid),${s}.catalog_publication_post(uuid,uuid,uuid,jsonb) FROM PUBLIC;
INSERT INTO ${s}.permissions(code) VALUES('catalog.media.review'),('catalog.publish');INSERT INTO ${s}.role_permissions(role_id,permission_code) SELECT id,p.code FROM ${s}.roles CROSS JOIN(VALUES('catalog.media.review'),('catalog.publish')) p(code) WHERE roles.code='owner';
CREATE TRIGGER staff_live_change AFTER INSERT OR UPDATE OR DELETE ON ${s}.catalog_media_reviews FOR EACH ROW EXECUTE FUNCTION ${s}.notify_staff_change('catalog');
CREATE TRIGGER staff_live_change AFTER INSERT OR UPDATE OR DELETE ON ${s}.catalog_releases FOR EACH ROW EXECUTE FUNCTION ${s}.notify_staff_change('catalog');
UPDATE ${s}.app_schema_version SET version=19 WHERE singleton;
`;
}
