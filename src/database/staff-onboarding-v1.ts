// Migration 21 definitions are immutable once released.
export function onboardingV1(s: string) {
  return `
CREATE TABLE ${s}.staff_onboarding(staff_id uuid PRIMARY KEY REFERENCES ${s}.staff_users(id),version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),invite_id uuid NOT NULL UNIQUE,code_hash text UNIQUE CHECK(code_hash ~ '^[a-f0-9]{64}$'),state text NOT NULL CHECK(state IN('pending','accepted','revoked')),expires_at timestamptz NOT NULL,activated_at timestamptz,
 CHECK((state='pending' AND code_hash IS NOT NULL AND activated_at IS NULL) OR(state='accepted' AND code_hash IS NULL AND activated_at IS NOT NULL) OR(state='revoked' AND code_hash IS NULL AND activated_at IS NULL)));
CREATE TABLE ${s}.staff_onboarding_events(staff_id uuid NOT NULL REFERENCES ${s}.staff_users(id),version integer NOT NULL,actor_id uuid NOT NULL REFERENCES ${s}.staff_users(id),action text NOT NULL CHECK(action IN('created','reissued','revoked','activated','account_disabled')),reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),invite_id uuid NOT NULL,state text NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(staff_id,version));
CREATE TABLE ${s}.staff_onboarding_requests(key uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES ${s}.staff_users(id),request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),response jsonb NOT NULL);
CREATE FUNCTION ${s}.staff_onboarding_log(subject uuid,actor uuid,request_id uuid,action_text text,reason_text text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 INSERT INTO ${s}.staff_onboarding_events(staff_id,version,actor_id,action,reason,invite_id,state,expires_at) SELECT staff_id,version,actor,action_text,reason_text,invite_id,state,expires_at FROM ${s}.staff_onboarding WHERE staff_id=subject;
 INSERT INTO ${s}.audit_events(actor_id,action,request_id,metadata) SELECT actor,'staff.onboarding_'||action_text,request_id,jsonb_build_object('entityId',subject,'version',version) FROM ${s}.staff_onboarding WHERE staff_id=subject;
END;$f$;
CREATE FUNCTION ${s}.staff_onboarding_owner_post(save_key uuid,actor uuid,session_uuid uuid,request_id uuid,verified_hash text,new_code_hash text,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE cached ${s}.staff_onboarding_requests%ROWTYPE;prior ${s}.staff_onboarding%ROWTYPE;u ${s}.staff_users%ROWTYPE;subject uuid;op text;hash text;result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('staff-access',20));
 PERFORM 1 FROM ${s}.staff_users WHERE id=actor AND is_active AND NOT must_change_password AND password_hash=verified_hash FOR SHARE;
 IF NOT FOUND OR NOT ${s}.staff_access_owner(actor) OR NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE a.staff_id=actor AND a.location_id IS NULL AND p.permission_code='staff.manage') THEN RAISE EXCEPTION 'ENROLLMENT_PERMISSION';END IF;
 PERFORM 1 FROM ${s}.staff_sessions WHERE id=session_uuid AND staff_id=actor AND revoked_at IS NULL AND expires_at>clock_timestamp() AND last_seen_at>clock_timestamp()-interval '30 minutes' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ENROLLMENT_PERMISSION';END IF;
 op:=payload->>'action';
 IF save_key IS NULL OR request_id IS NULL OR jsonb_typeof(payload) IS DISTINCT FROM 'object' OR op IS NULL OR op NOT IN('create','reissue','revoke') OR octet_length(payload::text)>5000 OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN('action','id','expectedVersion','username','displayName','reason')) OR coalesce(payload->>'expectedVersion','')!~'^(0|[1-9][0-9]{0,9})$' OR jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string' OR length(btrim(payload->>'reason')) NOT BETWEEN 1 AND 500 OR(payload->>'reason')~'[[:cntrl:]]' THEN RAISE EXCEPTION 'ENROLLMENT_INVALID';END IF;
 subject:=(payload->>'id')::uuid;hash:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');SELECT * INTO cached FROM ${s}.staff_onboarding_requests WHERE key=save_key;
 IF FOUND THEN IF cached.actor_id<>actor OR cached.request_hash<>hash THEN RAISE EXCEPTION 'ENROLLMENT_IDEMPOTENCY';END IF;RETURN cached.response||jsonb_build_object('issued',false,'replayed',true);END IF;
 IF op<>'revoke' AND coalesce(new_code_hash,'')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'ENROLLMENT_INVALID';END IF;
 IF op='create' THEN
 IF (payload->>'expectedVersion')::integer<>0 OR jsonb_typeof(payload->'username') IS DISTINCT FROM 'string' OR(payload->>'username')!~'^[a-z0-9._-]{3,64}$' OR jsonb_typeof(payload->'displayName') IS DISTINCT FROM 'string' OR length(btrim(payload->>'displayName')) NOT BETWEEN 1 AND 120 OR(payload->>'displayName')~'[[:cntrl:]]' THEN RAISE EXCEPTION 'ENROLLMENT_INVALID';END IF;
 INSERT INTO ${s}.staff_users(id,username,display_name,password_hash,is_active,must_change_password) VALUES(subject,payload->>'username',btrim(payload->>'displayName'),'!pending-enrollment',true,true);
 INSERT INTO ${s}.staff_onboarding VALUES(subject,1,gen_random_uuid(),new_code_hash,'pending',clock_timestamp()+interval '24 hours',NULL);
 ELSE
 IF payload?'username' OR payload?'displayName' THEN RAISE EXCEPTION 'ENROLLMENT_INVALID';END IF;
 SELECT * INTO u FROM ${s}.staff_users WHERE id=subject FOR UPDATE;SELECT * INTO prior FROM ${s}.staff_onboarding WHERE staff_id=subject FOR UPDATE;
 IF u.id IS NULL OR prior.staff_id IS NULL THEN RAISE EXCEPTION 'ENROLLMENT_NOT_FOUND';END IF;
 IF prior.version<>(payload->>'expectedVersion')::integer THEN RAISE EXCEPTION 'ENROLLMENT_STALE';END IF;
 IF prior.state='accepted' OR u.password_hash<>'!pending-enrollment' OR NOT u.must_change_password OR EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.roles r ON r.id=a.role_id WHERE a.staff_id=subject AND r.code='owner') THEN RAISE EXCEPTION 'ENROLLMENT_STATE';END IF;
 IF op='reissue' THEN IF NOT u.is_active THEN RAISE EXCEPTION 'ENROLLMENT_DISABLED';END IF;UPDATE ${s}.staff_onboarding SET version=version+1,invite_id=gen_random_uuid(),code_hash=new_code_hash,state='pending',expires_at=clock_timestamp()+interval '24 hours' WHERE staff_id=subject;
 ELSE IF prior.state<>'pending' THEN RAISE EXCEPTION 'ENROLLMENT_STATE';END IF;UPDATE ${s}.staff_onboarding SET version=version+1,code_hash=NULL,state='revoked' WHERE staff_id=subject;END IF;
 END IF;
 PERFORM ${s}.staff_onboarding_log(subject,actor,request_id,CASE op WHEN 'create' THEN 'created' WHEN 'reissue' THEN 'reissued' ELSE 'revoked' END,btrim(payload->>'reason'));
 SELECT jsonb_build_object('staffId',staff_id,'version',version,'state',state,'expiresAt',expires_at) INTO result FROM ${s}.staff_onboarding WHERE staff_id=subject;
 INSERT INTO ${s}.staff_onboarding_requests VALUES(save_key,actor,hash,result);RETURN result||jsonb_build_object('issued',op<>'revoke','replayed',false);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation OR not_null_violation OR foreign_key_violation THEN RAISE EXCEPTION 'ENROLLMENT_INVALID';END;$f$;
CREATE FUNCTION ${s}.staff_onboarding_activate(username_text text,token_hash text,new_hash text,request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE subject uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('staff-access',20));
 IF request_id IS NULL OR coalesce(token_hash,'')!~'^[a-f0-9]{64}$' OR coalesce(new_hash,'')!~'^scrypt[$]32768[$]8[$]3[$][A-Za-z0-9_-]{22}[$][A-Za-z0-9_-]{43}$' THEN RAISE EXCEPTION 'ENROLLMENT_ACTIVATION_INVALID';END IF;
 SELECT u.id INTO subject FROM ${s}.staff_users u JOIN ${s}.staff_onboarding o ON o.staff_id=u.id WHERE u.username=username_text AND u.is_active AND u.must_change_password AND u.password_hash='!pending-enrollment' AND o.state='pending' AND o.code_hash=token_hash AND o.expires_at>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.roles r ON r.id=a.role_id WHERE a.staff_id=u.id AND r.code='owner') FOR UPDATE OF u,o;
 IF NOT FOUND THEN RAISE EXCEPTION 'ENROLLMENT_ACTIVATION_INVALID';END IF;
 UPDATE ${s}.staff_users SET password_hash=new_hash,must_change_password=false WHERE id=subject;
 UPDATE ${s}.staff_onboarding SET version=version+1,state='accepted',code_hash=NULL,activated_at=clock_timestamp() WHERE staff_id=subject;
 UPDATE ${s}.staff_sessions SET revoked_at=now() WHERE staff_id=subject AND revoked_at IS NULL;
 PERFORM ${s}.staff_onboarding_log(subject,subject,request_id,'activated','Employee completed initial activation');
 RETURN jsonb_build_object('activated',true,'loginRequired',true);
END;$f$;
ALTER FUNCTION ${s}.staff_access_post(uuid,uuid,uuid,jsonb) RENAME TO staff_access_post_v20;
CREATE FUNCTION ${s}.staff_access_post(save_key uuid,actor uuid,request_id uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE cached boolean;result jsonb;subject uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('staff-access',20));SELECT EXISTS(SELECT 1 FROM ${s}.staff_access_requests WHERE key=save_key) INTO cached;
 result:=${s}.staff_access_post_v20(save_key,actor,request_id,payload);
 IF NOT cached AND payload->>'kind'='staff' AND NOT(payload->>'active')::boolean THEN
 subject:=(payload->>'id')::uuid;
 UPDATE ${s}.staff_onboarding SET version=version+1,state='revoked',code_hash=NULL WHERE staff_id=subject AND state='pending';
 IF FOUND THEN PERFORM ${s}.staff_onboarding_log(subject,actor,request_id,'account_disabled','Pending activation revoked when staff account was disabled');END IF;
 END IF;RETURN result;
END;$f$;
REVOKE ALL ON FUNCTION ${s}.staff_onboarding_log(uuid,uuid,uuid,text,text),${s}.staff_onboarding_owner_post(uuid,uuid,uuid,uuid,text,text,jsonb),${s}.staff_onboarding_activate(text,text,text,uuid),${s}.staff_access_post(uuid,uuid,uuid,jsonb) FROM PUBLIC;
CREATE TRIGGER staff_live_change AFTER INSERT OR UPDATE OR DELETE ON ${s}.staff_onboarding FOR EACH ROW EXECUTE FUNCTION ${s}.notify_staff_change('access');
UPDATE ${s}.app_schema_version SET version=21 WHERE singleton;
`;
}
