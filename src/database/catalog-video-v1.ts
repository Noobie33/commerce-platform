// Schema 23 definitions are immutable once released.
export function catalogVideoV1(s: string) {
  return `
CREATE TABLE ${s}.catalog_video_policy(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),max_per_product integer NOT NULL CHECK(max_per_product BETWEEN 1 AND 20),max_pending integer NOT NULL CHECK(max_pending BETWEEN 1 AND 100));
INSERT INTO ${s}.catalog_video_policy VALUES(true,8,24);
CREATE TABLE ${s}.catalog_product_videos(
 id uuid PRIMARY KEY,product_id uuid NOT NULL REFERENCES ${s}.catalog_products(id),uploader_id uuid NOT NULL REFERENCES ${s}.staff_users(id),
 source_type text NOT NULL CHECK(source_type IN('video/mp4','video/quicktime')),source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),source_bytes bigint NOT NULL CHECK(source_bytes BETWEEN 32 AND 209715200),
 version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 2147483646),state text NOT NULL CHECK(state IN('queued','processing','ready','failed','cancelled','removed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),available_at timestamptz NOT NULL DEFAULT now(),lease_token uuid,lease_until timestamptz,artifact_id uuid UNIQUE,manifest jsonb,
 description text NOT NULL DEFAULT '' CHECK(length(description)<=240 AND description!~'[[:cntrl:]]'),variant_id uuid REFERENCES ${s}.catalog_variants(id),position integer NOT NULL DEFAULT 0 CHECK(position BETWEEN 0 AND 99999),
 review_state text NOT NULL DEFAULT 'not_reviewed' CHECK(review_state IN('not_reviewed','approved','revoked')),error_code text CHECK(error_code IN('invalid_video','processing_failed','tools_unavailable','worker_interrupted')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((lease_token IS NULL)=(lease_until IS NULL)),CHECK((state='processing')=(lease_token IS NOT NULL)),CHECK((artifact_id IS NULL)=(manifest IS NULL)),CHECK(state<>'ready' OR artifact_id IS NOT NULL),CHECK(state IN('ready','removed') OR artifact_id IS NULL),CHECK(review_state='not_reviewed' OR state IN('ready','removed')));
CREATE INDEX catalog_video_queue_idx ON ${s}.catalog_product_videos(state,available_at,created_at);
CREATE INDEX catalog_video_product_idx ON ${s}.catalog_product_videos(product_id,position,created_at,id);
CREATE TABLE ${s}.catalog_video_events(video_id uuid NOT NULL REFERENCES ${s}.catalog_product_videos(id),version integer NOT NULL,actor_id uuid NOT NULL REFERENCES ${s}.staff_users(id),action text NOT NULL,reason text NOT NULL,snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(video_id,version));
CREATE TABLE ${s}.catalog_video_requests(key uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES ${s}.staff_users(id),request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),response jsonb NOT NULL);
CREATE FUNCTION ${s}.catalog_video_log(vid uuid,actor uuid,req uuid,op text,why text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE v ${s}.catalog_product_videos%ROWTYPE;safe jsonb;BEGIN SELECT * INTO STRICT v FROM ${s}.catalog_product_videos WHERE id=vid;
 safe:=jsonb_build_object('performedBy',CASE WHEN op IN('processing','ready','failed','interrupted') THEN 'video_worker' ELSE 'staff' END,'state',v.state,'attempts',v.attempts,'description',v.description,'variantId',v.variant_id,'position',v.position,'reviewState',v.review_state,'errorCode',v.error_code);
 INSERT INTO ${s}.catalog_video_events VALUES(vid,v.version,actor,op,why,safe,clock_timestamp());
 INSERT INTO ${s}.audit_events(actor_id,action,request_id,metadata) VALUES(actor,'catalog.video_'||op,req,jsonb_build_object('performedBy',CASE WHEN op IN('processing','ready','failed','interrupted') THEN 'video_worker' ELSE 'staff' END,'productId',v.product_id,'videoId',vid,'version',v.version,'reason',why,'state',v.state));END;$f$;
CREATE FUNCTION ${s}.catalog_video_post(k uuid,actor uuid,req uuid,b jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE op text:=b->>'action';perm text;pid uuid;vid uuid;h text;cached ${s}.catalog_video_requests%ROWTYPE;v ${s}.catalog_product_videos%ROWTYPE;pver integer;result jsonb;pol ${s}.catalog_video_policy%ROWTYPE;
BEGIN
 perm:=CASE WHEN op IN('approve','revoke') THEN 'catalog.media.review' ELSE 'catalog.manage' END;
 IF NOT EXISTS(SELECT 1 FROM ${s}.staff_users u WHERE u.id=actor AND u.is_active AND NOT u.must_change_password AND EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE a.staff_id=u.id AND a.location_id IS NULL AND p.permission_code=perm) AND EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE a.staff_id=u.id AND a.location_id IS NULL AND p.permission_code='catalog.read')) THEN RAISE EXCEPTION 'VIDEO_PERMISSION';END IF;
 IF k IS NULL OR req IS NULL OR jsonb_typeof(b) IS DISTINCT FROM 'object' OR op IS NULL OR op NOT IN('upload','metadata','retry','cancel','remove','approve','revoke') OR octet_length(b::text)>5000 THEN RAISE EXCEPTION 'VIDEO_INVALID';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(b) x WHERE x NOT IN('action','id','productId','expectedVersion','expectedProductVersion','sourceType','sourceHash','sourceBytes','description','variantId','position','reason','verifiedPlaybackHash','verifiedPosterHash','rightsConfirmed')) THEN RAISE EXCEPTION 'VIDEO_INVALID';END IF;
 h:=encode(sha256(convert_to((CASE WHEN op='upload' THEN b-'id' ELSE b END)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('video-request:'||k::text,23));
 SELECT * INTO cached FROM ${s}.catalog_video_requests WHERE key=k;
 IF FOUND THEN IF cached.actor_id<>actor OR cached.request_hash<>h THEN RAISE EXCEPTION 'VIDEO_IDEMPOTENCY';END IF;RETURN cached.response;END IF;
 vid:=(b->>'id')::uuid;
 IF op='upload' THEN
  pid:=(b->>'productId')::uuid;SELECT version INTO pver FROM ${s}.catalog_products WHERE id=pid AND status<>'archived' FOR UPDATE;
  IF pver IS NULL THEN RAISE EXCEPTION 'VIDEO_NOT_FOUND';END IF;
  IF pver<>(b->>'expectedProductVersion')::integer THEN RAISE EXCEPTION 'VIDEO_STALE';END IF;
  IF jsonb_typeof(b->'sourceType') IS DISTINCT FROM 'string' OR b->>'sourceType' NOT IN('video/mp4','video/quicktime') OR coalesce(b->>'sourceHash','')!~'^[a-f0-9]{64}$' OR coalesce(b->>'sourceBytes','')!~'^[1-9][0-9]{0,8}$' OR (b->>'sourceBytes')::bigint NOT BETWEEN 32 AND 209715200 THEN RAISE EXCEPTION 'VIDEO_INVALID';END IF;
  SELECT * INTO pol FROM ${s}.catalog_video_policy WHERE singleton FOR UPDATE;
  IF (SELECT count(*) FROM ${s}.catalog_product_videos WHERE product_id=pid AND state<>'removed')>=pol.max_per_product OR (SELECT count(*) FROM ${s}.catalog_product_videos WHERE state IN('queued','processing'))>=pol.max_pending THEN RAISE EXCEPTION 'VIDEO_LIMIT';END IF;
  INSERT INTO ${s}.catalog_product_videos(id,product_id,uploader_id,source_type,source_hash,source_bytes,state) VALUES(vid,pid,actor,b->>'sourceType',b->>'sourceHash',(b->>'sourceBytes')::bigint,'queued');
 ELSE
  SELECT product_id INTO pid FROM ${s}.catalog_product_videos WHERE id=vid;IF pid IS NULL THEN RAISE EXCEPTION 'VIDEO_NOT_FOUND';END IF;
  PERFORM 1 FROM ${s}.catalog_products WHERE id=pid FOR UPDATE;
  SELECT * INTO v FROM ${s}.catalog_product_videos WHERE id=vid FOR UPDATE;
  IF coalesce(b->>'expectedVersion','')!~'^[1-9][0-9]{0,9}$' OR v.version<>(b->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'VIDEO_STALE';END IF;
  IF v.state='removed' THEN RAISE EXCEPTION 'VIDEO_STATE';END IF;
  IF jsonb_typeof(b->'reason') IS DISTINCT FROM 'string' OR length(btrim(b->>'reason')) NOT BETWEEN 1 AND 500 OR b->>'reason'~'[[:cntrl:]]' THEN RAISE EXCEPTION 'VIDEO_INVALID';END IF;
  IF op='metadata' THEN
   IF jsonb_typeof(b->'description') IS DISTINCT FROM 'string' OR length(b->>'description')>240 OR b->>'description'~'[[:cntrl:]]' OR coalesce(b->>'position','')!~'^(0|[1-9][0-9]{0,4})$' OR NOT(b?'variantId') THEN RAISE EXCEPTION 'VIDEO_INVALID';END IF;
   IF b->>'variantId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ${s}.catalog_variants WHERE id=(b->>'variantId')::uuid AND product_id=pid AND is_active) THEN RAISE EXCEPTION 'VIDEO_INVALID';END IF;
   UPDATE ${s}.catalog_product_videos SET description=b->>'description',variant_id=(b->>'variantId')::uuid,position=(b->>'position')::integer,review_state='not_reviewed' WHERE id=vid;
  ELSIF op='retry' THEN
   IF v.state NOT IN('failed','cancelled') OR v.attempts>=3 THEN RAISE EXCEPTION 'VIDEO_STATE';END IF;
   PERFORM 1 FROM ${s}.catalog_video_policy WHERE singleton FOR UPDATE;
   IF (SELECT count(*) FROM ${s}.catalog_product_videos WHERE state IN('queued','processing'))>=(SELECT max_pending FROM ${s}.catalog_video_policy WHERE singleton) THEN RAISE EXCEPTION 'VIDEO_LIMIT';END IF;
   UPDATE ${s}.catalog_product_videos SET state='queued',available_at=clock_timestamp(),error_code=NULL WHERE id=vid;
  ELSIF op IN('cancel','remove') THEN
   IF op='cancel' AND v.state NOT IN('queued','processing') THEN RAISE EXCEPTION 'VIDEO_STATE';END IF;
   UPDATE ${s}.catalog_product_videos SET state=CASE WHEN op='remove' THEN 'removed' ELSE 'cancelled' END,lease_token=NULL,lease_until=NULL WHERE id=vid;
  ELSE
   IF v.state<>'ready' THEN RAISE EXCEPTION 'VIDEO_STATE';END IF;
   IF op='approve' AND (length(btrim(v.description))=0 OR b->'rightsConfirmed' IS DISTINCT FROM 'true'::jsonb OR b->>'verifiedPlaybackHash' IS DISTINCT FROM v.manifest->>'playbackHash' OR b->>'verifiedPosterHash' IS DISTINCT FROM v.manifest->>'posterHash') THEN RAISE EXCEPTION 'VIDEO_INVALID';END IF;
   UPDATE ${s}.catalog_product_videos SET review_state=CASE WHEN op='approve' THEN 'approved' ELSE 'revoked' END WHERE id=vid;
  END IF;
  UPDATE ${s}.catalog_product_videos SET version=version+1,updated_at=clock_timestamp() WHERE id=vid;
 END IF;
 PERFORM ${s}.catalog_video_log(vid,actor,req,op,coalesce(b->>'reason','Private video received for background validation'));
 SELECT jsonb_build_object('id',id,'version',version,'state',state) INTO result FROM ${s}.catalog_product_videos WHERE id=vid;
 INSERT INTO ${s}.catalog_video_requests VALUES(k,actor,h,result);RETURN result;END;$f$;
CREATE FUNCTION ${s}.catalog_video_claim(token uuid,req uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE v ${s}.catalog_product_videos%ROWTYPE;BEGIN
 IF token IS NULL OR req IS NULL THEN RAISE EXCEPTION 'VIDEO_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('catalog-video-worker',23));
 FOR v IN SELECT * FROM ${s}.catalog_product_videos WHERE state='processing' AND lease_until<=clock_timestamp() FOR UPDATE LOOP
  UPDATE ${s}.catalog_product_videos SET state=CASE WHEN attempts<3 THEN 'queued' ELSE 'failed' END,available_at=clock_timestamp()+interval '5 seconds',lease_token=NULL,lease_until=NULL,error_code='worker_interrupted',version=version+1,updated_at=clock_timestamp() WHERE id=v.id;
  PERFORM ${s}.catalog_video_log(v.id,v.uploader_id,req,'interrupted','An expired worker lease was recovered');
 END LOOP;
 IF EXISTS(SELECT 1 FROM ${s}.catalog_product_videos WHERE state='processing') THEN RETURN NULL;END IF;
 SELECT * INTO v FROM ${s}.catalog_product_videos WHERE state='queued' AND available_at<=clock_timestamp() AND attempts<3 ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 UPDATE ${s}.catalog_product_videos SET state='processing',attempts=attempts+1,lease_token=token,lease_until=clock_timestamp()+interval '60 seconds',error_code=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=v.id;
 PERFORM ${s}.catalog_video_log(v.id,v.uploader_id,req,'processing','Background video processing started');
 RETURN jsonb_build_object('id',v.id,'sourceType',v.source_type,'sourceHash',v.source_hash,'sourceBytes',v.source_bytes);END;$f$;
CREATE FUNCTION ${s}.catalog_video_heartbeat(vid uuid,token uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $f$
 WITH changed AS(UPDATE ${s}.catalog_product_videos SET lease_until=clock_timestamp()+interval '60 seconds' WHERE id=vid AND state='processing' AND lease_token=token AND lease_until>clock_timestamp() RETURNING 1) SELECT EXISTS(SELECT 1 FROM changed);$f$;
CREATE FUNCTION ${s}.catalog_video_finish(vid uuid,token uuid,req uuid,data jsonb,err text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE v ${s}.catalog_product_videos%ROWTYPE;BEGIN
 SELECT * INTO v FROM ${s}.catalog_product_videos WHERE id=vid FOR UPDATE;
 IF NOT FOUND OR v.state<>'processing' OR v.lease_token IS DISTINCT FROM token OR v.lease_until<=clock_timestamp() THEN RETURN false;END IF;
 IF req IS NULL OR(err IS NOT NULL AND err NOT IN('invalid_video','processing_failed','tools_unavailable')) THEN RAISE EXCEPTION 'VIDEO_INVALID';END IF;
 IF err IS NULL THEN
  IF jsonb_typeof(data) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(data) k WHERE k NOT IN('originalHash','playbackHash','posterHash','width','height','durationSeconds','hasAudio','posterWidth','posterHeight','playbackBytes','posterBytes')) OR data->>'originalHash' IS DISTINCT FROM v.source_hash OR coalesce(data->>'playbackHash','')!~'^[a-f0-9]{64}$' OR coalesce(data->>'posterHash','')!~'^[a-f0-9]{64}$' OR jsonb_typeof(data->'hasAudio') IS DISTINCT FROM 'boolean' OR coalesce(data->>'width','')!~'^[1-9][0-9]{0,3}$' OR coalesce(data->>'height','')!~'^[1-9][0-9]{0,3}$' OR (data->>'width')::integer>1920 OR(data->>'height')::integer>1920 OR coalesce(data->>'durationSeconds','')!~'^[0-9]+(\.[0-9]+)?$' OR (data->>'durationSeconds')::numeric NOT BETWEEN 0.1 AND 301 OR coalesce(data->>'playbackBytes','')!~'^[1-9][0-9]{0,8}$' OR (data->>'playbackBytes')::bigint>83886080 OR coalesce(data->>'posterBytes','')!~'^[1-9][0-9]{0,6}$' OR (data->>'posterBytes')::bigint>1048576 OR coalesce(data->>'posterWidth','')!~'^[1-9][0-9]{0,2}$' OR coalesce(data->>'posterHeight','')!~'^[1-9][0-9]{0,2}$' OR (data->>'posterWidth')::int>640 OR (data->>'posterHeight')::int>640 THEN RAISE EXCEPTION 'VIDEO_INVALID';END IF;
  UPDATE ${s}.catalog_product_videos SET state='ready',artifact_id=token,manifest=data,error_code=NULL,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=vid;
 ELSE
  IF data IS NOT NULL THEN RAISE EXCEPTION 'VIDEO_INVALID';END IF;
  UPDATE ${s}.catalog_product_videos SET state=CASE WHEN err<>'invalid_video' AND attempts<3 THEN 'queued' ELSE 'failed' END,available_at=clock_timestamp()+interval '15 seconds',error_code=err,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=vid;
 END IF;
 PERFORM ${s}.catalog_video_log(vid,v.uploader_id,req,CASE WHEN err IS NULL THEN 'ready' ELSE 'failed' END,coalesce(err,'Private playback and poster prepared; review remains required'));RETURN true;END;$f$;
CREATE FUNCTION ${s}.catalog_video_storage_refs() RETURNS TABLE(id uuid,artifact_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $f$ SELECT id,artifact_id FROM ${s}.catalog_product_videos;$f$;
REVOKE ALL ON FUNCTION ${s}.catalog_video_storage_refs() FROM PUBLIC;
CREATE TRIGGER staff_live_change AFTER INSERT OR UPDATE OF version ON ${s}.catalog_product_videos FOR EACH ROW WHEN (pg_trigger_depth()=0) EXECUTE FUNCTION ${s}.notify_staff_change('catalog');
REVOKE ALL ON FUNCTION ${s}.catalog_video_log(uuid,uuid,uuid,text,text),${s}.catalog_video_post(uuid,uuid,uuid,jsonb),${s}.catalog_video_claim(uuid,uuid),${s}.catalog_video_heartbeat(uuid,uuid),${s}.catalog_video_finish(uuid,uuid,uuid,jsonb,text) FROM PUBLIC;
UPDATE ${s}.app_schema_version SET version=23 WHERE singleton;
`;
}
