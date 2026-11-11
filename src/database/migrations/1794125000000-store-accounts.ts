import type { MigrationInterface, QueryRunner } from 'typeorm';
export class StoreAccounts1794125000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    if ((await r.query('SELECT version FROM app_schema_version'))[0]?.version !== 26)
      throw Error('Schema 26 required');
    const schema = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw Error('Unsupported schema');
    const ownerSchema = '"' + schema + '"';
    await r.query(`
 CREATE TABLE store_customer_accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text NOT NULL UNIQUE CHECK(email=lower(email) AND length(email) BETWEEN 3 AND 254),display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),password_hash text NOT NULL,is_active boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE store_customer_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES store_customer_accounts(id),token_hash text NOT NULL UNIQUE CHECK(token_hash~'^[a-f0-9]{64}$'),csrf_token text NOT NULL CHECK(csrf_token~'^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT now(),last_seen_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '8 hours',revoked_at timestamptz,CHECK(expires_at>created_at));
 CREATE INDEX store_customer_sessions_account ON store_customer_sessions(account_id);
 CREATE TABLE store_customer_login_limits(bucket_hash text PRIMARY KEY CHECK(bucket_hash~'^[a-f0-9]{64}$'),attempts integer NOT NULL CHECK(attempts>0),window_start timestamptz NOT NULL DEFAULT now());
 CREATE TABLE store_customer_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid REFERENCES store_customer_accounts(id),action text NOT NULL CHECK(action IN('login','login_failed','logout')),request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE INDEX store_customer_events_account_time ON store_customer_events(account_id,created_at);
 CREATE FUNCTION ${ownerSchema}.store_customer_session_create(a uuid,expected text,hash text,csrf text,rid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 DECLARE current_hash text;
 BEGIN
 SELECT u.password_hash INTO current_hash FROM ${ownerSchema}.store_customer_accounts u WHERE u.id=a AND u.is_active FOR UPDATE;
 IF NOT FOUND OR current_hash<>expected THEN RAISE EXCEPTION 'CUSTOMER_INVALID_CREDENTIALS';END IF;
 INSERT INTO ${ownerSchema}.store_customer_sessions(account_id,token_hash,csrf_token)VALUES(a,hash,csrf);
 INSERT INTO ${ownerSchema}.store_customer_events(account_id,action,request_id)VALUES(a,'login',rid);
 END $fn$;
 REVOKE ALL ON FUNCTION ${ownerSchema}.store_customer_session_create(uuid,text,text,text,uuid) FROM PUBLIC;
 UPDATE app_schema_version SET version=27 WHERE singleton;
 `);
  }
  async down(r: QueryRunner) {
    for (const table of [
      'store_customer_accounts',
      'store_customer_sessions',
      'store_customer_login_limits',
      'store_customer_events',
    ])
      if ((await r.query('SELECT 1 FROM ' + table + ' LIMIT 1')).length)
        throw Error('Cannot discard customer identity history');
    await r.query(
      'DROP FUNCTION store_customer_session_create(uuid,text,text,text,uuid);DROP TABLE store_customer_events,store_customer_sessions,store_customer_login_limits,store_customer_accounts;UPDATE app_schema_version SET version=26 WHERE singleton',
    );
  }
}
