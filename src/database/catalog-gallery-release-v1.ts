// Schema 25 extends publication with explicitly reviewed mixed-media snapshots.
export function galleryReleaseV1(s: string) {
  return `
CREATE TABLE ${s}.catalog_gallery_reviews(product_id uuid PRIMARY KEY REFERENCES ${s}.catalog_products(id),version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),state text NOT NULL CHECK(state IN('approved','revoked')),draft_version integer NOT NULL,items jsonb NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items) BETWEEN 1 AND 40),basis_hash text NOT NULL CHECK(basis_hash~'^[a-f0-9]{64}$'),snapshot jsonb NOT NULL);
CREATE TABLE ${s}.catalog_gallery_review_events(product_id uuid NOT NULL REFERENCES ${s}.catalog_products(id),version integer NOT NULL,actor_id uuid NOT NULL REFERENCES ${s}.staff_users(id),action text NOT NULL CHECK(action IN('approve','revoke')),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(product_id,version));
CREATE TABLE ${s}.catalog_gallery_review_requests(key uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES ${s}.staff_users(id),request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),response jsonb NOT NULL);
CREATE FUNCTION ${s}.catalog_gallery_selection(pid uuid,items jsonb) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 WITH source AS(SELECT ${s}.catalog_gallery_basis(pid) AS b),ordered AS(
 SELECT i.item,i.n,(SELECT p FROM jsonb_array_elements(b->'photos') p WHERE p->>'id'=i.item->>'id') AS photo,(SELECT v FROM jsonb_array_elements(b->'videos') v WHERE v->>'id'=i.item->>'id') AS video FROM source CROSS JOIN LATERAL jsonb_array_elements(items) WITH ORDINALITY i(item,n)),
 facts AS(SELECT *,CASE WHEN item->>'kind'='photo' THEN coalesce(photo->>'reviewState'='approved' AND photo->>'imageHash'=photo->>'hash' AND length(btrim(photo->>'alt'))>0,false)
 ELSE coalesce(video->>'state'='ready' AND video->>'reviewState'='approved' AND length(btrim(video->>'description'))>0 AND video->'manifest'->'hasAudio'='false'::jsonb AND (video->'variantId'='null'::jsonb OR (video->>'variantActive')::boolean),false) END AS ready FROM ordered),
 agg AS(SELECT coalesce(jsonb_agg(jsonb_build_object('item',item,'data',CASE WHEN item->>'kind'='photo' THEN photo ELSE video END) ORDER BY n),'[]'::jsonb) AS records,
 count(*)>0 AND coalesce(bool_and(ready),false) AND coalesce(bool_and(n<>1 OR(item->>'kind'='photo' AND (photo->>'primary')::boolean)),false) AS ready,
 coalesce(jsonb_agg(CASE WHEN item->>'kind'='photo' THEN jsonb_build_object('kind','photo','id',item->>'id','label',photo->>'alt','width',photo->'width','height',photo->'height','primary',photo->'primary') ELSE jsonb_build_object('kind','video','id',item->>'id','label',video->>'description','width',video->'manifest'->'width','height',video->'manifest'->'height','durationSeconds',video->'manifest'->'durationSeconds','hasAudio',video->'manifest'->'hasAudio','variantId',video->'variantId') END ORDER BY n),'[]'::jsonb) AS media FROM facts)
 SELECT jsonb_build_object('ready',ready,'basis',encode(sha256(convert_to(records::text,'UTF8')),'hex'),'media',media) FROM agg;
$f$;
CREATE FUNCTION ${s}.catalog_gallery_review_post(k uuid,actor uuid,req uuid,b jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE pid uuid;op text:=b->>'action';h text;cached ${s}.catalog_gallery_review_requests%ROWTYPE;r ${s}.catalog_gallery_reviews%ROWTYPE;d ${s}.catalog_gallery_drafts%ROWTYPE;sel jsonb;rev integer;safe jsonb;result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ${s}.staff_users u WHERE u.id=actor AND u.is_active AND NOT u.must_change_password AND EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE a.staff_id=u.id AND a.location_id IS NULL AND p.permission_code='catalog.media.review') AND EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE a.staff_id=u.id AND a.location_id IS NULL AND p.permission_code='catalog.read')) THEN RAISE EXCEPTION 'GALLERY_REVIEW_PERMISSION';END IF;
 IF k IS NULL OR req IS NULL OR jsonb_typeof(b) IS DISTINCT FROM 'object' OR op IS NULL OR op NOT IN('approve','revoke') OR octet_length(b::text)>4000 OR EXISTS(SELECT 1 FROM jsonb_object_keys(b) x WHERE x NOT IN('action','productId','expectedVersion','expectedDraftVersion','expectedBasis','verifiedBasis','rightsConfirmed','reason')) OR jsonb_typeof(b->'reason') IS DISTINCT FROM 'string' OR length(btrim(b->>'reason')) NOT BETWEEN 1 AND 500 OR b->>'reason'~'[[:cntrl:]]' OR jsonb_typeof(b->'expectedVersion') IS DISTINCT FROM 'number' OR coalesce(b->>'expectedVersion','')!~'^(0|[1-9][0-9]{0,9})$' THEN RAISE EXCEPTION 'GALLERY_REVIEW_INVALID';END IF;
 pid:=(b->>'productId')::uuid;h:=encode(sha256(convert_to((b-'verifiedBasis')::text,'UTF8')),'hex');PERFORM pg_advisory_xact_lock(hashtextextended('gallery-review:'||k::text,25));SELECT * INTO cached FROM ${s}.catalog_gallery_review_requests WHERE key=k;
 IF FOUND THEN IF cached.actor_id<>actor OR cached.request_hash<>h THEN RAISE EXCEPTION 'GALLERY_REVIEW_IDEMPOTENCY';END IF;RETURN cached.response;END IF;
 PERFORM 1 FROM ${s}.catalog_products WHERE id=pid FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'GALLERY_REVIEW_NOT_FOUND';END IF;
 PERFORM 1 FROM ${s}.catalog_product_photos WHERE product_id=pid ORDER BY id FOR SHARE;PERFORM 1 FROM ${s}.catalog_product_videos WHERE product_id=pid ORDER BY id FOR SHARE;PERFORM 1 FROM ${s}.catalog_variants WHERE product_id=pid ORDER BY id FOR SHARE;
 SELECT * INTO r FROM ${s}.catalog_gallery_reviews WHERE product_id=pid;IF coalesce(r.version,0)<>(b->>'expectedVersion')::integer THEN RAISE EXCEPTION 'GALLERY_REVIEW_STALE';END IF;rev:=coalesce(r.version,0)+1;
 IF op='approve' THEN
 SELECT * INTO d FROM ${s}.catalog_gallery_drafts WHERE product_id=pid;
 IF d.product_id IS NULL OR jsonb_array_length(d.items)=0 THEN RAISE EXCEPTION 'GALLERY_REVIEW_INCOMPLETE';END IF;
 sel:=${s}.catalog_gallery_selection(pid,d.items);
 IF d.version IS DISTINCT FROM (b->>'expectedDraftVersion')::integer OR sel->>'basis' IS DISTINCT FROM b->>'expectedBasis' THEN RAISE EXCEPTION 'GALLERY_REVIEW_STALE';END IF;
 IF NOT (sel->>'ready')::boolean OR b->'rightsConfirmed' IS DISTINCT FROM 'true'::jsonb OR b->>'verifiedBasis' IS DISTINCT FROM sel->>'basis' THEN RAISE EXCEPTION 'GALLERY_REVIEW_INCOMPLETE';END IF;
 INSERT INTO ${s}.catalog_gallery_reviews VALUES(pid,rev,'approved',d.version,d.items,sel->>'basis',sel->'media') ON CONFLICT(product_id) DO UPDATE SET version=EXCLUDED.version,state=EXCLUDED.state,draft_version=EXCLUDED.draft_version,items=EXCLUDED.items,basis_hash=EXCLUDED.basis_hash,snapshot=EXCLUDED.snapshot;
 ELSE
 IF r.product_id IS NULL OR r.state<>'approved' THEN RAISE EXCEPTION 'GALLERY_REVIEW_STATE';END IF;UPDATE ${s}.catalog_gallery_reviews SET version=rev,state='revoked' WHERE product_id=pid;
 END IF;
 SELECT jsonb_build_object('state',state,'draftVersion',draft_version,'items',snapshot,'rightsConfirmed',op='approve') INTO safe FROM ${s}.catalog_gallery_reviews WHERE product_id=pid;
 INSERT INTO ${s}.catalog_gallery_review_events VALUES(pid,rev,actor,op,btrim(b->>'reason'),safe,clock_timestamp());INSERT INTO ${s}.audit_events(actor_id,action,request_id,metadata) VALUES(actor,'catalog.gallery_'||op,req,jsonb_build_object('productId',pid,'version',rev,'reason',btrim(b->>'reason')));
 result:=jsonb_build_object('productId',pid,'version',rev,'action',op);INSERT INTO ${s}.catalog_gallery_review_requests VALUES(k,actor,h,result);RETURN result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation OR not_null_violation THEN RAISE EXCEPTION 'GALLERY_REVIEW_INVALID';END;$f$;
ALTER FUNCTION ${s}.catalog_release_eligible(uuid) RENAME TO catalog_release_eligible_v24;
CREATE FUNCTION ${s}.catalog_release_eligible(pid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT coalesce(${s}.catalog_release_eligible_v24(pid) AND (NOT(r.snapshot?'gallery') OR EXISTS(SELECT 1 FROM ${s}.catalog_gallery_reviews g CROSS JOIN LATERAL ${s}.catalog_gallery_selection(pid,g.items) sel WHERE g.product_id=pid AND g.state='approved' AND g.version=(r.snapshot->'gallery'->>'reviewVersion')::integer AND (sel->>'ready')::boolean AND g.basis_hash=sel->>'basis' AND g.snapshot=r.snapshot->'gallery'->'items')),false) FROM ${s}.catalog_releases r WHERE r.product_id=pid;
$f$;
ALTER FUNCTION ${s}.catalog_publication_post(uuid,uuid,uuid,jsonb) RENAME TO catalog_publication_post_v24;
CREATE FUNCTION ${s}.catalog_publication_post(k uuid,actor uuid,req uuid,b jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE cached boolean;result jsonb;pid uuid;r ${s}.catalog_gallery_reviews%ROWTYPE;sel jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('publication:'||k::text,19));SELECT EXISTS(SELECT 1 FROM ${s}.catalog_publication_requests WHERE key=k) INTO cached;
 result:=${s}.catalog_publication_post_v24(k,actor,req,b-'galleryBasis');
 IF NOT cached AND b->>'action'='publish' THEN
 pid:=(b->>'productId')::uuid;SELECT * INTO r FROM ${s}.catalog_gallery_reviews WHERE product_id=pid;
 IF r.state='approved' THEN
 sel:=${s}.catalog_gallery_selection(pid,r.items);
 IF NOT(sel->>'ready')::boolean OR r.basis_hash IS DISTINCT FROM sel->>'basis' OR b->>'galleryBasis' IS DISTINCT FROM r.basis_hash THEN RAISE EXCEPTION 'PUBLICATION_GALLERY_INCOMPLETE';END IF;
 UPDATE ${s}.catalog_releases SET snapshot=snapshot||jsonb_build_object('gallery',jsonb_build_object('reviewVersion',r.version,'items',r.snapshot)) WHERE product_id=pid;
 UPDATE ${s}.catalog_publication_events SET snapshot=(SELECT snapshot FROM ${s}.catalog_releases WHERE product_id=pid) WHERE kind='release' AND entity_id=pid AND version=(result->>'version')::integer;
 END IF;
 END IF;RETURN result;
END;$f$;
REVOKE ALL ON FUNCTION ${s}.catalog_gallery_selection(uuid,jsonb),${s}.catalog_gallery_review_post(uuid,uuid,uuid,jsonb),${s}.catalog_release_eligible(uuid),${s}.catalog_publication_post(uuid,uuid,uuid,jsonb) FROM PUBLIC;
CREATE TRIGGER staff_live_change AFTER INSERT OR UPDATE ON ${s}.catalog_gallery_reviews FOR EACH ROW EXECUTE FUNCTION ${s}.notify_staff_change('catalog');
UPDATE ${s}.app_schema_version SET version=25 WHERE singleton;
`;
}
