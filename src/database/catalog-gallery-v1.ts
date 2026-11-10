// Schema 24: private ordered gallery drafts, independent of public releases.
export function catalogGalleryV1(s: string) {
  return `
CREATE TABLE ${s}.catalog_gallery_drafts(product_id uuid PRIMARY KEY REFERENCES ${s}.catalog_products(id),version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),items jsonb NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items)<=40));
CREATE TABLE ${s}.catalog_gallery_events(product_id uuid NOT NULL REFERENCES ${s}.catalog_products(id),version integer NOT NULL,actor_id uuid NOT NULL REFERENCES ${s}.staff_users(id),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),items jsonb NOT NULL,basis_hash text NOT NULL CHECK(basis_hash~'^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(product_id,version));
CREATE TABLE ${s}.catalog_gallery_requests(key uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES ${s}.staff_users(id),request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),response jsonb NOT NULL);
CREATE FUNCTION ${s}.catalog_gallery_basis(pid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('productVersion',p.version,'photos',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'width',x.width,'height',x.height,'primary',x.is_primary,'hash',x.content_hash,'alt',coalesce(r.alt,''),'reviewState',coalesce(r.state,'not_reviewed'),'reviewVersion',coalesce(r.version,0),'imageHash',r.image_hash,'thumbnailHash',r.thumbnail_hash) ORDER BY x.is_primary DESC,x.created_at,x.id) FROM ${s}.catalog_product_photos x LEFT JOIN ${s}.catalog_media_reviews r ON r.photo_id=x.id WHERE x.product_id=p.id AND x.is_active),'[]'::jsonb),
 'videos',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'version',v.version,'state',v.state,'description',v.description,'variantId',v.variant_id,'variantSku',k.sku,'variantActive',coalesce(k.is_active,false),'position',v.position,'reviewState',v.review_state,'manifest',v.manifest) ORDER BY v.position,v.created_at,v.id) FROM ${s}.catalog_product_videos v LEFT JOIN ${s}.catalog_variants k ON k.id=v.variant_id WHERE v.product_id=p.id AND v.state<>'removed'),'[]'::jsonb)) FROM ${s}.catalog_products p WHERE p.id=pid;
$f$;
CREATE FUNCTION ${s}.catalog_gallery_post(k uuid,actor uuid,req uuid,b jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE pid uuid;h text;basis jsonb;bh text;cached ${s}.catalog_gallery_requests%ROWTYPE;draft ${s}.catalog_gallery_drafts%ROWTYPE;item jsonb;vid uuid;rev integer;result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ${s}.staff_users u WHERE u.id=actor AND u.is_active AND NOT u.must_change_password AND EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE a.staff_id=u.id AND a.location_id IS NULL AND p.permission_code='catalog.manage') AND EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE a.staff_id=u.id AND a.location_id IS NULL AND p.permission_code='catalog.read')) THEN RAISE EXCEPTION 'GALLERY_PERMISSION';END IF;
 IF k IS NULL OR req IS NULL OR jsonb_typeof(b) IS DISTINCT FROM 'object' OR b->>'action' IS DISTINCT FROM 'save' OR octet_length(b::text)>10000 OR EXISTS(SELECT 1 FROM jsonb_object_keys(b) x WHERE x NOT IN('action','productId','expectedVersion','expectedBasis','reason','items')) OR jsonb_typeof(b->'reason') IS DISTINCT FROM 'string' OR length(btrim(b->>'reason')) NOT BETWEEN 1 AND 500 OR b->>'reason'~'[[:cntrl:]]' OR jsonb_typeof(b->'expectedVersion') IS DISTINCT FROM 'number' OR coalesce(b->>'expectedVersion','')!~'^(0|[1-9][0-9]{0,9})$' OR coalesce(b->>'expectedBasis','')!~'^[a-f0-9]{64}$' OR jsonb_typeof(b->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'GALLERY_INVALID';END IF;
 IF jsonb_array_length(b->'items')>40 THEN RAISE EXCEPTION 'GALLERY_INVALID';END IF;
 pid:=(b->>'productId')::uuid;h:=encode(sha256(convert_to(b::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('gallery-request:'||k::text,24));SELECT * INTO cached FROM ${s}.catalog_gallery_requests WHERE key=k;
 IF FOUND THEN IF cached.actor_id<>actor OR cached.request_hash<>h THEN RAISE EXCEPTION 'GALLERY_IDEMPOTENCY';END IF;RETURN cached.response;END IF;
 PERFORM 1 FROM ${s}.catalog_products WHERE id=pid AND status<>'archived' FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'GALLERY_NOT_FOUND';END IF;
 PERFORM 1 FROM ${s}.catalog_product_photos WHERE product_id=pid ORDER BY id FOR SHARE;
 PERFORM 1 FROM ${s}.catalog_product_videos WHERE product_id=pid ORDER BY id FOR SHARE;
 PERFORM 1 FROM ${s}.catalog_variants WHERE product_id=pid ORDER BY id FOR SHARE;
 SELECT * INTO draft FROM ${s}.catalog_gallery_drafts WHERE product_id=pid;
 basis:=${s}.catalog_gallery_basis(pid);bh:=encode(sha256(convert_to(basis::text,'UTF8')),'hex');
 IF coalesce(draft.version,0)<>(b->>'expectedVersion')::integer OR bh<>b->>'expectedBasis' THEN RAISE EXCEPTION 'GALLERY_STALE';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(b->'items') x GROUP BY x->>'kind',x->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'GALLERY_INVALID';END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(b->'items') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) x WHERE x NOT IN('kind','id')) OR item->>'kind' IS NULL OR item->>'kind' NOT IN('photo','video') OR coalesce(item->>'id','')!~'^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$' THEN RAISE EXCEPTION 'GALLERY_INVALID';END IF;
  vid:=(item->>'id')::uuid;
  IF item->>'kind'='photo' THEN
   IF NOT EXISTS(SELECT 1 FROM ${s}.catalog_product_photos WHERE id=vid AND product_id=pid AND is_active) THEN RAISE EXCEPTION 'GALLERY_MEDIA_CHANGED';END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM ${s}.catalog_product_videos v LEFT JOIN ${s}.catalog_variants x ON x.id=v.variant_id WHERE v.id=vid AND v.product_id=pid AND v.state='ready' AND (v.variant_id IS NULL OR x.is_active)) THEN RAISE EXCEPTION 'GALLERY_MEDIA_CHANGED';END IF;
  END IF;
 END LOOP;
 rev:=coalesce(draft.version,0)+1;
 INSERT INTO ${s}.catalog_gallery_drafts VALUES(pid,rev,b->'items') ON CONFLICT(product_id) DO UPDATE SET version=EXCLUDED.version,items=EXCLUDED.items;
 INSERT INTO ${s}.catalog_gallery_events(product_id,version,actor_id,reason,items,basis_hash) VALUES(pid,rev,actor,btrim(b->>'reason'),b->'items',bh);
 INSERT INTO ${s}.audit_events(actor_id,action,request_id,metadata) VALUES(actor,'catalog.gallery_save',req,jsonb_build_object('productId',pid,'version',rev,'itemCount',jsonb_array_length(b->'items'),'reason',btrim(b->>'reason')));
 result:=jsonb_build_object('productId',pid,'version',rev);INSERT INTO ${s}.catalog_gallery_requests VALUES(k,actor,h,result);RETURN result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation OR not_null_violation THEN RAISE EXCEPTION 'GALLERY_INVALID';END;$f$;
REVOKE ALL ON FUNCTION ${s}.catalog_gallery_basis(uuid),${s}.catalog_gallery_post(uuid,uuid,uuid,jsonb) FROM PUBLIC;
CREATE TRIGGER staff_live_change AFTER INSERT OR UPDATE OR DELETE ON ${s}.catalog_gallery_drafts FOR EACH ROW EXECUTE FUNCTION ${s}.notify_staff_change('catalog');
UPDATE ${s}.app_schema_version SET version=24 WHERE singleton;
`;
}
