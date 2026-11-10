// Migration 20 is immutable once released.
export function staffAccessV1(s: string) {
  return `
CREATE TABLE ${s}.access_permission_policy(code text PRIMARY KEY REFERENCES ${s}.permissions(code),location_scope boolean NOT NULL);
INSERT INTO ${s}.access_permission_policy SELECT code,code IN('locations.read','inventory.read','inventory.receive','inventory.adjust','inventory.transfer','purchasing.receive','purchasing.reverse_receipt','sales.reserve') FROM ${s}.permissions WHERE code NOT IN('staff.manage','roles.manage','customers.credit.manage','sales.price_override');
CREATE TABLE ${s}.staff_access_versions(staff_id uuid PRIMARY KEY REFERENCES ${s}.staff_users(id),version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646));
CREATE TABLE ${s}.role_access_profiles(role_id uuid PRIMARY KEY REFERENCES ${s}.roles(id),version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 120),active boolean NOT NULL);
CREATE TABLE ${s}.staff_access_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN('staff','role')),entity_id uuid NOT NULL,version integer NOT NULL,actor_id uuid NOT NULL REFERENCES ${s}.staff_users(id),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),before_snapshot jsonb,snapshot jsonb NOT NULL,revoked_sessions integer NOT NULL CHECK(revoked_sessions>=0),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(kind,entity_id,version));
CREATE INDEX staff_access_history_idx ON ${s}.staff_access_events(kind,entity_id,version DESC);
CREATE TABLE ${s}.staff_access_requests(key uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES ${s}.staff_users(id),request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),response jsonb NOT NULL);
CREATE FUNCTION ${s}.staff_access_owner(actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT EXISTS(SELECT 1 FROM ${s}.staff_users u JOIN ${s}.staff_role_assignments a ON a.staff_id=u.id JOIN ${s}.roles r ON r.id=a.role_id WHERE u.id=actor AND u.is_active AND NOT u.must_change_password AND r.code='owner' AND a.location_id IS NULL);
$f$;
CREATE FUNCTION ${s}.staff_access_snapshot(kind text,entity uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT CASE WHEN kind='staff' THEN(SELECT jsonb_build_object('id',u.id,'username',u.username,'displayName',u.display_name,'active',u.is_active,'version',coalesce(v.version,0),'assignments',coalesce((SELECT jsonb_agg(jsonb_build_object('roleId',a.role_id,'locationId',a.location_id) ORDER BY a.role_id,a.location_id NULLS FIRST) FROM ${s}.staff_role_assignments a WHERE a.staff_id=u.id),'[]'::jsonb)) FROM ${s}.staff_users u LEFT JOIN ${s}.staff_access_versions v ON v.staff_id=u.id WHERE u.id=entity)
 ELSE(SELECT jsonb_build_object('id',r.id,'code',r.code,'label',coalesce(p.label,r.code),'active',coalesce(p.active,true),'version',coalesce(p.version,0),'permissions',coalesce((SELECT jsonb_agg(permission_code ORDER BY permission_code) FROM ${s}.role_permissions WHERE role_id=r.id),'[]'::jsonb)) FROM ${s}.roles r LEFT JOIN ${s}.role_access_profiles p ON p.role_id=r.id WHERE r.id=entity) END;
$f$;
CREATE FUNCTION ${s}.staff_access_post(save_key uuid,actor uuid,request_id uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE kind text;entity uuid;prior jsonb;after jsonb;hash text;cached ${s}.staff_access_requests%ROWTYPE;rev integer;revoked integer:=0;item jsonb;role_uuid uuid;loc uuid;result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('staff-access',20));
 IF NOT ${s}.staff_access_owner(actor) THEN RAISE EXCEPTION 'ACCESS_PERMISSION';END IF;
 kind:=payload->>'kind';
 IF NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE a.staff_id=actor AND a.location_id IS NULL AND p.permission_code=CASE WHEN kind='role' THEN 'roles.manage' ELSE 'staff.manage' END) THEN RAISE EXCEPTION 'ACCESS_PERMISSION';END IF;
 IF save_key IS NULL OR request_id IS NULL OR jsonb_typeof(payload) IS DISTINCT FROM 'object' OR kind IS NULL OR kind NOT IN('staff','role') OR octet_length(payload::text)>12000 OR coalesce(payload->>'expectedVersion','')!~'^(0|[1-9][0-9]{0,9})$' OR jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string' OR length(btrim(payload->>'reason')) NOT BETWEEN 1 AND 500 OR(payload->>'reason')~'[[:cntrl:]]' OR jsonb_typeof(payload->'active') IS DISTINCT FROM 'boolean' OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN('kind','id','expectedVersion','reason','active','displayName','assignments','code','label','permissions')) THEN RAISE EXCEPTION 'ACCESS_INVALID';END IF;
 entity:=(payload->>'id')::uuid;hash:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');SELECT * INTO cached FROM ${s}.staff_access_requests WHERE key=save_key;IF FOUND THEN IF cached.actor_id<>actor OR cached.request_hash<>hash THEN RAISE EXCEPTION 'ACCESS_IDEMPOTENCY';END IF;RETURN cached.response;END IF;
 prior:=${s}.staff_access_snapshot(kind,entity);IF coalesce((prior->>'version')::integer,0)<>(payload->>'expectedVersion')::integer THEN RAISE EXCEPTION 'ACCESS_STALE';END IF;rev:=coalesce((prior->>'version')::integer,0)+1;
 IF kind='role' THEN
 IF jsonb_typeof(payload->'code') IS DISTINCT FROM 'string' OR(payload->>'code')!~'^[a-z][a-z0-9_-]{2,63}$' OR jsonb_typeof(payload->'label') IS DISTINCT FROM 'string' OR length(btrim(payload->>'label')) NOT BETWEEN 1 AND 120 OR(payload->>'label')~'[[:cntrl:]]' OR jsonb_typeof(payload->'permissions') IS DISTINCT FROM 'array' OR jsonb_array_length(payload->'permissions')>64 OR payload?'displayName' OR payload?'assignments' THEN RAISE EXCEPTION 'ACCESS_INVALID';END IF;
 IF payload->>'code'='owner' OR prior->>'code'='owner' OR EXISTS(SELECT 1 FROM ${s}.role_permissions rp WHERE rp.role_id=entity AND NOT EXISTS(SELECT 1 FROM ${s}.access_permission_policy p WHERE p.code=rp.permission_code)) THEN RAISE EXCEPTION 'ACCESS_PROTECTED';END IF;
 IF prior IS NOT NULL AND payload->>'code' IS DISTINCT FROM prior->>'code' THEN RAISE EXCEPTION 'ACCESS_INVALID';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'permissions') p WHERE jsonb_typeof(p)<>'string' OR NOT EXISTS(SELECT 1 FROM ${s}.access_permission_policy ap WHERE ap.code=p#>>'{}')) OR (SELECT count(*) FROM jsonb_array_elements(payload->'permissions'))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements(payload->'permissions')) THEN RAISE EXCEPTION 'ACCESS_INVALID';END IF;
 IF NOT(payload->>'active')::boolean AND EXISTS(SELECT 1 FROM ${s}.staff_role_assignments WHERE role_id=entity) THEN RAISE EXCEPTION 'ACCESS_ROLE_IN_USE';END IF;
 IF NOT(payload->>'active')::boolean AND jsonb_array_length(payload->'permissions')<>0 THEN RAISE EXCEPTION 'ACCESS_INVALID';END IF;
 IF EXISTS(SELECT 1 FROM ${s}.staff_role_assignments WHERE role_id=entity AND location_id IS NOT NULL) AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(payload->'permissions') p JOIN ${s}.access_permission_policy ap ON ap.code=p WHERE NOT ap.location_scope) THEN RAISE EXCEPTION 'ACCESS_SCOPE';END IF;
 INSERT INTO ${s}.roles(id,code) VALUES(entity,payload->>'code') ON CONFLICT(id) DO NOTHING;
 INSERT INTO ${s}.role_access_profiles VALUES(entity,rev,btrim(payload->>'label'),(payload->>'active')::boolean) ON CONFLICT(role_id) DO UPDATE SET version=EXCLUDED.version,label=EXCLUDED.label,active=EXCLUDED.active;
 DELETE FROM ${s}.role_permissions WHERE role_id=entity;INSERT INTO ${s}.role_permissions(role_id,permission_code) SELECT entity,value FROM jsonb_array_elements_text(payload->'permissions');
 after:=${s}.staff_access_snapshot(kind,entity);
 IF prior->'permissions' IS DISTINCT FROM after->'permissions' THEN UPDATE ${s}.staff_sessions ss SET revoked_at=now() WHERE revoked_at IS NULL AND EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a WHERE a.staff_id=ss.staff_id AND a.role_id=entity) AND NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.roles r ON r.id=a.role_id WHERE a.staff_id=ss.staff_id AND r.code='owner');GET DIAGNOSTICS revoked=ROW_COUNT;END IF;
 ELSE
 IF prior IS NULL THEN RAISE EXCEPTION 'ACCESS_NOT_FOUND';END IF;
 IF EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.roles r ON r.id=a.role_id WHERE a.staff_id=entity AND r.code='owner') THEN RAISE EXCEPTION 'ACCESS_PROTECTED';END IF;
 IF jsonb_typeof(payload->'displayName') IS DISTINCT FROM 'string' OR length(btrim(payload->>'displayName')) NOT BETWEEN 1 AND 120 OR(payload->>'displayName')~'[[:cntrl:]]' OR jsonb_typeof(payload->'assignments') IS DISTINCT FROM 'array' OR jsonb_array_length(payload->'assignments')>20 OR payload?'code' OR payload?'label' OR payload?'permissions' THEN RAISE EXCEPTION 'ACCESS_INVALID';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(payload->'assignments'))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements(payload->'assignments')) THEN RAISE EXCEPTION 'ACCESS_INVALID';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(payload->'assignments') LOOP
 IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT(item?'locationId') OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN('roleId','locationId')) THEN RAISE EXCEPTION 'ACCESS_INVALID';END IF;
 role_uuid:=(item->>'roleId')::uuid;loc:=(item->>'locationId')::uuid;
 IF NOT EXISTS(SELECT 1 FROM ${s}.roles r LEFT JOIN ${s}.role_access_profiles p ON p.role_id=r.id WHERE r.id=role_uuid AND r.code<>'owner' AND coalesce(p.active,true)) OR EXISTS(SELECT 1 FROM ${s}.role_permissions rp WHERE rp.role_id=role_uuid AND NOT EXISTS(SELECT 1 FROM ${s}.access_permission_policy p WHERE p.code=rp.permission_code)) THEN RAISE EXCEPTION 'ACCESS_PROTECTED';END IF;
 IF loc IS NOT NULL AND(NOT EXISTS(SELECT 1 FROM ${s}.locations WHERE id=loc AND is_active) OR EXISTS(SELECT 1 FROM ${s}.role_permissions rp JOIN ${s}.access_permission_policy p ON p.code=rp.permission_code WHERE rp.role_id=role_uuid AND NOT p.location_scope)) THEN RAISE EXCEPTION 'ACCESS_SCOPE';END IF;
 END LOOP;
 PERFORM 1 FROM ${s}.staff_users WHERE id=entity FOR UPDATE;
 UPDATE ${s}.staff_users SET display_name=btrim(payload->>'displayName'),is_active=(payload->>'active')::boolean WHERE id=entity;
 DELETE FROM ${s}.staff_role_assignments WHERE staff_id=entity;INSERT INTO ${s}.staff_role_assignments(staff_id,role_id,location_id) SELECT entity,(x->>'roleId')::uuid,(x->>'locationId')::uuid FROM jsonb_array_elements(payload->'assignments') x;
 INSERT INTO ${s}.staff_access_versions VALUES(entity,rev) ON CONFLICT(staff_id) DO UPDATE SET version=EXCLUDED.version;
 after:=${s}.staff_access_snapshot(kind,entity);
 IF prior->'assignments' IS DISTINCT FROM after->'assignments' OR prior->'active' IS DISTINCT FROM after->'active' THEN UPDATE ${s}.staff_sessions SET revoked_at=now() WHERE staff_id=entity AND revoked_at IS NULL;GET DIAGNOSTICS revoked=ROW_COUNT;END IF;
 END IF;
 INSERT INTO ${s}.staff_access_events(kind,entity_id,version,actor_id,reason,before_snapshot,snapshot,revoked_sessions) VALUES(kind,entity,rev,actor,btrim(payload->>'reason'),prior,after,revoked);
 INSERT INTO ${s}.audit_events(actor_id,action,request_id,metadata) VALUES(actor,'access.'||kind||'_saved',request_id,jsonb_build_object('entityId',entity,'version',rev,'revokedSessions',revoked));result:=jsonb_build_object('id',entity,'version',rev,'revokedSessions',revoked);INSERT INTO ${s}.staff_access_requests VALUES(save_key,actor,hash,result);RETURN result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation OR not_null_violation OR foreign_key_violation THEN RAISE EXCEPTION 'ACCESS_INVALID';END;$f$;
REVOKE ALL ON FUNCTION ${s}.staff_access_owner(uuid),${s}.staff_access_snapshot(text,uuid),${s}.staff_access_post(uuid,uuid,uuid,jsonb) FROM PUBLIC;
CREATE TRIGGER staff_live_change AFTER INSERT OR UPDATE OR DELETE ON ${s}.role_access_profiles FOR EACH ROW EXECUTE FUNCTION ${s}.notify_staff_change('access');
CREATE TRIGGER staff_live_change AFTER INSERT OR UPDATE OR DELETE ON ${s}.staff_access_versions FOR EACH ROW EXECUTE FUNCTION ${s}.notify_staff_change('access');
UPDATE ${s}.app_schema_version SET version=20 WHERE singleton;
`;
}
