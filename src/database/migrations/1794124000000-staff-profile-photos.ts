import type { MigrationInterface, QueryRunner } from 'typeorm';
export class StaffProfilePhotos1794124000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    if ((await r.query('SELECT version FROM app_schema_version'))[0]?.version !== 25)
      throw Error('Schema 25 required');
    const schema = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw Error('Unsupported schema');
    const s = '"' + schema + '"';
    await r.query(`
CREATE TABLE ${s}.staff_profile_photos(staff_id uuid PRIMARY KEY REFERENCES ${s}.staff_users(id),version integer NOT NULL CHECK(version>0),image bytea CHECK(image IS NULL OR octet_length(image) BETWEEN 1 AND 262144),updated_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION ${s}.staff_profile_photo_read(a uuid,sid uuid,include_image boolean) RETURNS TABLE(version integer,has_photo boolean,image bytea) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ${s}.staff_sessions se JOIN ${s}.staff_users u ON u.id=se.staff_id WHERE se.id=sid AND u.id=a AND u.is_active AND se.revoked_at IS NULL AND se.expires_at>now() AND se.last_seen_at>now()-interval '30 minutes') THEN RAISE EXCEPTION 'PROFILE_SESSION';END IF;
 RETURN QUERY SELECT p.version,p.image IS NOT NULL,CASE WHEN include_image THEN p.image ELSE NULL END FROM ${s}.staff_profile_photos p WHERE p.staff_id=a;
END $fn$;
CREATE FUNCTION ${s}.staff_profile_photo_write(a uuid,sid uuid,rid uuid,expected integer,bytes bytea) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v integer;
BEGIN
 PERFORM 1 FROM ${s}.staff_users WHERE id=a AND is_active AND NOT must_change_password FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_SESSION'; END IF;
 PERFORM 1 FROM ${s}.staff_sessions WHERE id=sid AND staff_id=a AND revoked_at IS NULL AND expires_at>clock_timestamp() AND last_seen_at>clock_timestamp()-interval '30 minutes' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_SESSION'; END IF;
 SELECT p.version INTO v FROM ${s}.staff_profile_photos p WHERE p.staff_id=a;
 IF expected IS NULL OR expected<0 OR expected<>coalesce(v,0) THEN RAISE EXCEPTION 'PROFILE_PHOTO_STALE';END IF;
 INSERT INTO ${s}.staff_profile_photos(staff_id,version,image) VALUES(a,coalesce(v,0)+1,bytes) ON CONFLICT(staff_id) DO UPDATE SET version=excluded.version,image=excluded.image,updated_at=now();
 INSERT INTO ${s}.audit_events(actor_id,action,request_id,metadata) VALUES(a,CASE WHEN bytes IS NULL THEN 'staff.photo_removed' ELSE 'staff.photo_updated' END,rid,jsonb_build_object('version',coalesce(v,0)+1));
 RETURN coalesce(v,0)+1;
END $fn$;
REVOKE ALL ON FUNCTION ${s}.staff_profile_photo_read(uuid,uuid,boolean),${s}.staff_profile_photo_write(uuid,uuid,uuid,integer,bytea) FROM PUBLIC;
UPDATE ${s}.app_schema_version SET version=26 WHERE singleton;
`);
  }
  async down(r: QueryRunner) {
    if ((await r.query('SELECT 1 FROM staff_profile_photos LIMIT 1')).length)
      throw Error('Cannot discard profile photo history');
    await r.query(
      'DROP FUNCTION staff_profile_photo_read(uuid,uuid,boolean),staff_profile_photo_write(uuid,uuid,uuid,integer,bytea); DROP TABLE staff_profile_photos; UPDATE app_schema_version SET version=25 WHERE singleton',
    );
  }
}
